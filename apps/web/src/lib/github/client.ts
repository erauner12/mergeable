import { throttling } from "@octokit/plugin-throttling";
import type { Endpoints } from "@octokit/types";
import { Octokit } from "octokit";
import { isNonNull, isNonNullish } from "remeda";
// import { // This block is duplicated and will be removed
//   CheckConclusionState,
//   PullRequestReviewDecision,
//   PullRequestReviewState,
// } from "../../../generated/gql/graphql";
import {
  CheckConclusionState,
  PullRequestReviewDecision,
  PullRequestReviewState,
  StatusState,
  type CheckRun,
  type StatusContext,
  type SearchQuery,
  type SearchFullQuery,
} from "../../../generated/gql/graphql";
import { SearchDocument, SearchFullDocument } from "../../../generated/gql/graphql";
import { prepareQuery } from "./search";
import type {
  Check,
  CheckState,
  Discussion,
  Participant,
  Profile,
  PullProps,
  Team,
  User,
} from "./types";
import type { Actor } from "./type-guards";
import type { CommentBlockInput } from "../repoprompt";
const MyOctokit = Octokit.plugin(throttling);

export type PullRequestCommit = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"]["response"]["data"][number];

export type Endpoint = {
  auth: string;
  baseUrl: string;
};

export interface GitHubClient {
  getViewer(endpoint: Endpoint): Promise<Profile>;
  searchPulls(
    endpoint: Endpoint,
    search: string,
    orgs: string[],
    limit: number,
  ): Promise<PullProps[]>;
  fetchPullComments(
    endpoint: Endpoint,
    owner: string,
    repo: string,
    number: number,
  ): Promise<CommentBlockInput[]>;
}

/** Narrow Octokit response when `mediaType.format === 'diff'` */
type DiffStringResponse = { data: string };

/** Minimal shape for pull-request metadata we access. */
interface PullHeadResponse {
  data: { head: { ref: string } };
}

export async function getPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<string> {
  const octokit = token ? new Octokit({ auth: token }) : new Octokit(); // unauth → still fine for public repos
  const { data } = (await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: number,
      mediaType: { format: "diff" },
    },
  )) as unknown as DiffStringResponse;
  // The Octokit types might return the diff data as `unknown` when mediaType.format is 'diff'
  // already typed => no cast needed
  return data; // `data` is already the diff string
}

export class DefaultGitHubClient implements GitHubClient {
  private octokits: Record<string, Octokit> = {};
  private commentCache: Map<string, Promise<CommentBlockInput[]>> = new Map();

  private getOctokit(endpoint: Endpoint): Octokit {
    if (!this.octokits[endpoint.auth]) {
      this.octokits[endpoint.auth] = new MyOctokit({
        auth: endpoint.auth,
        baseUrl: endpoint.baseUrl,
      });
    }
    return this.octokits[endpoint.auth];
  }

  async getViewer(endpoint: Endpoint): Promise<Profile> {
    const octokit = this.getOctokit(endpoint);
    const userResponse = await octokit.rest.users.getAuthenticated();
    const user: User = {
      id: userResponse.data.node_id,
      name: userResponse.data.login,
      avatarUrl: userResponse.data.avatar_url,
      bot: false, // Assuming authenticated user is not a bot
    };
    const teamsResponse = await octokit.paginate("GET /user/teams", {
      per_page: 100,
    });
    const teams: Team[] = teamsResponse.map((obj: Endpoints["GET /user/teams"]["response"]["data"][number]) => ({
      id: obj.node_id,
      name: `${obj.organization.login}/${obj.slug}`,
    }));
    return { user, teams };
  }

  async searchPulls(
    endpoint: Endpoint,
    search: string,
    orgs: string[],
    limit: number,
  ): Promise<PullProps[]> {
    const q = prepareQuery(search, orgs);
    const useFull = Boolean(import.meta.env.MERGEABLE_EXTENDED_SEARCH);
    const query = useFull
      ? (SearchFullDocument.toString() as string)
      : (SearchDocument.toString() as string);

    const octokit = this.getOctokit(endpoint);
    const data = await octokit.graphql<SearchQuery | SearchFullQuery>(query, {
      q,
      limit,
    });
    // OLD code:
    // return (
    //   data.search.edges
    //     ?.filter(isNonNull)
    //     .map((edge) => this.makePull(edge.node as PullNode))
    //     .filter(isNonNull) ?? []
    // );
    // NEW code:
    const edges = data.search.edges?.filter(isNonNull) ?? [];
    const pulls = edges
        .filter((e): e is NonNullable<typeof e> & { node: PullRequestNode } => isPullRequestNode(e.node))
        .map(e => this.makePull(e.node));
    return pulls;
  }

  async fetchPullComments(
    endpoint: Endpoint,
    owner: string,
    repo: string,
    number: number,
  ): Promise<CommentBlockInput[]> {
    const cacheKey = `${endpoint.auth}:${owner}/${repo}/${number}`;
    if (this.commentCache.has(cacheKey)) {
      return this.commentCache.get(cacheKey)!;
    }

    const promise = this._fetchPullCommentsLogic(endpoint, owner, repo, number);
    this.commentCache.set(cacheKey, promise);
    promise.catch(() => this.commentCache.delete(cacheKey));
    return promise;
  }

  private async _fetchPullCommentsLogic(
    endpoint: Endpoint,
    owner: string,
    repo: string,
    number: number,
  ): Promise<CommentBlockInput[]> {
    const octokit = this.getOctokit(endpoint);

    // Fetch issue comments
    const issueComments = await octokit.paginate(
      octokit.rest.issues.listComments,
      {
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      }
    );

    // Fetch pull request reviews
    const reviews = await octokit.paginate(
      octokit.rest.pulls.listReviews,
      {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      }
    );

    // Fetch pull request review comments
    const reviewComments = await octokit.paginate(
      octokit.rest.pulls.listReviewComments,
      {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      }
    );

    // Normalize all comments into CommentBlockInput[]
    const commentBlocks: CommentBlockInput[] = [];

    // Issue comments
    for (const c of issueComments) {
      commentBlocks.push({
        id: c.id.toString(),
        author: {
          id: c.user?.node_id ?? "",
          name: c.user?.login ?? "",
          avatarUrl: c.user?.avatar_url ?? "",
          bot: !!c.user?.type && c.user.type === "Bot",
        },
        createdAt: c.created_at,
        body: c.body ?? "",
        url: c.html_url,
        type: "ISSUE_COMMENT",
      });
    }

    // Review comments (top-level)
    for (const rc of reviewComments) {
      commentBlocks.push({
        id: rc.id.toString(),
        author: {
          id: rc.user?.node_id ?? "",
          name: rc.user?.login ?? "",
          avatarUrl: rc.user?.avatar_url ?? "",
          bot: !!rc.user?.type && rc.user.type === "Bot",
        },
        createdAt: rc.created_at,
        body: rc.body ?? "",
        url: rc.html_url,
        type: "REVIEW_COMMENT",
      });
    }

    // Reviews (summary, not inline comments)
    for (const r of reviews) {
      if (r.body) {
        commentBlocks.push({
          id: r.id.toString(),
          author: {
            id: r.user?.node_id ?? "",
            name: r.user?.login ?? "",
            avatarUrl: r.user?.avatar_url ?? "",
            bot: !!r.user?.type && r.user.type === "Bot",
          },
          createdAt: r.submitted_at ?? r.submitted_at ?? r.commit_id ?? "",
          body: r.body,
          url: r.html_url,
          type: "REVIEW",
        });
      }
    }

    // Sort by createdAt ascending
    commentBlocks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return commentBlocks;
  }

  private makePull(prNode: PullRequestNode): PullProps {
    const discussions: Discussion[] = [];
    const participants: Participant[] = [];

    // Use hasComments guard for safe access to comments
    if (hasComments(prNode) && prNode.comments?.nodes) {
      for (const node of prNode.comments.nodes) {
        if (!node) continue;
        this.addOrUpdateParticipant(participants, node.author, node.createdAt);
        discussions.push({
          id: node.id,
          author: this.makeUser(node.author),
          createdAt: this.toDate(node.createdAt),
          body: node.bodyText,
          isResolved: node.isResolved ?? false,
          url: node.url,
        });
      }
    }

    // Use hasLatestOpinionatedReviews guard for reviews
    if (hasLatestOpinionatedReviews(prNode) && prNode.latestOpinionatedReviews?.nodes) {
      for (const node of prNode.latestOpinionatedReviews.nodes) {
        if (!node) continue;
        // Use submittedAt if available, otherwise createdAt for participant activity
        this.addOrUpdateParticipant(participants, node.author, node.submittedAt ?? node.createdAt);
      }
    }

    // Use hasMergeQueueEntry guard for merge queue participants
    if (guardHasMergeQueueEntry(prNode)) {
      const mergeQueueEntry = prNode.mergeQueueEntry;
      if (mergeQueueEntry?.commit?.author) {
        this.addOrUpdateParticipant(
          participants,
          mergeQueueEntry.commit.author,
          mergeQueueEntry.createdAt,
        );
      }
    }

    const mqState = guardHasMergeQueueEntry(prNode) ? prNode.mergeQueueEntry?.state : undefined;

    return {
      id: prNode.id,
      repo: `${prNode.repository.owner.login}/${prNode.repository.name}`,
      number: prNode.number,
      title: prNode.title,
      body: prNode.bodyHTML || prNode.bodyText || prNode.body || "",
      state: this.toPullState(prNode),
      checkState: this.toCheckStateFromRollup(prNode.statusCheckRollup),
      queueState:
        guardHasMergeQueueEntry(prNode) && mqState === "MERGEABLE"
          ? "mergeable"
          : guardHasMergeQueueEntry(prNode) && mqState === "UNMERGEABLE"
            ? "unmergeable"
            : "pending",
      createdAt: this.toDate(prNode.createdAt),
      updatedAt: this.toDate(prNode.updatedAt),
      enqueuedAt: guardHasMergeQueueEntry(prNode) ? this.toDate(prNode.mergeQueueEntry?.enqueuedAt) : undefined,
      mergedAt: this.toDate(prNode.mergedAt),
      closedAt: this.toDate(prNode.closedAt),
      locked: prNode.locked ?? false,
      url: prNode.url,
      labels:
        prNode.labels?.nodes
          ?.filter((n: { name?: string } | null): n is { name: string } => isNonNull(n))
          .map((n: { name: string }) => n.name) ?? [],
      additions: prNode.additions ?? 0,
      deletions: prNode.deletions ?? 0,
      author: this.makeUser(prNode.author),
      requestedReviewers: prNode.reviewRequests?.nodes?.map(
        (req: { requestedReviewer: Actor | null } | null) =>
          req ? this.makeUser(req.requestedReviewer) : null
      ).filter((u: User | null): u is User => isNonNull(u)) ?? [],
      requestedTeams: prNode.reviewRequests?.nodes?.map(
        (req: { requestedReviewer: Actor | null } | null) =>
          req ? this.makeTeam(req.requestedReviewer) : null
      ).filter((t: Team | null): t is Team => isNonNull(t)) ?? [],
      reviews: hasLatestOpinionatedReviews(prNode) && prNode.latestOpinionatedReviews?.nodes
        ? (() => {
            const reviews = prNode.latestOpinionatedReviews.nodes?.filter(
              (n: any): n is typeof n => isNonNull(n)
            );
            return (
              reviews
                ?.filter(
                  (n: { state: PullRequestReviewState }) =>
                    n.state !== PullRequestReviewState.Pending
                )
                .map((n: { author: Actor; authorCanPushToRepository: boolean; state: PullRequestReviewState }) => ({
                  author: this.makeUser(n.author),
                  collaborator: n.authorCanPushToRepository,
                  approved: n.state === PullRequestReviewState.Approved,
                })) ?? []
            );
          })()
        : [],
      checks: hasStatusCheckRollup(prNode) && prNode.statusCheckRollup?.contexts?.nodes
        ? (() => {
            const nodes = (prNode.statusCheckRollup.contexts.nodes ?? [])
              .filter((c: CheckRun | StatusContext | null | undefined): c is CheckRun | StatusContext => isNonNullish(c))
              .map((c: CheckRun | StatusContext) => c);
            return nodes.map((c: CheckRun | StatusContext) => this.makeCheck(c));
          })()
        : [],
      discussions,
      branch: prNode.headRefName ?? "",
      files:
        hasFiles(prNode) && prNode.files?.nodes
          ? prNode.files.nodes.filter(
              (f: { path?: string } | null | undefined): f is { path: string } => isNonNullish(f)
            ).map((f: { path: string }) => f.path)
          : [],
      participants,
    };
  }

  private makeUser(obj: Actor): User | null {
    if (
      obj?.__typename === "Bot" ||
      obj?.__typename === "Mannequin" ||
      obj?.__typename === "User" ||
      obj?.__typename === "EnterpriseUserAccount"
    ) {
      return {
        id: obj.id,
        name: obj.login,
        avatarUrl: `${obj.avatarUrl}`,
        bot: obj.__typename === "Bot",
      };
    } else {
      return null;
    }
  }

  private makeTeam(obj: Actor): Team | null {
    // Apply cast as Actor type in type-guards.ts cannot be updated (file not provided)
    if ((obj as any)?.__typename === "Team") {
      const team = obj as { __typename: "Team"; id: string; name?: string; slug?: string };
      return {
        id: team.id,
        name: team.name ?? team.slug ?? "",
      };
    }
    return null;
  }

  private toPullState(prNode: PullRequestNode): PullProps["state"] {
    if (prNode.isDraft) return "draft";
    if (prNode.merged) return "merged";
    if (prNode.closed) return "closed";
    if (hasMergeQueueEntry(prNode) && prNode.mergeQueueEntry) return "enqueued";
    if (prNode.reviewDecision === PullRequestReviewDecision.Approved) return "approved";
    return "pending";
  }

  private toCheckStateFromRollup(rollup: PullRequestNode["statusCheckRollup"]): CheckState {
    if (!rollup || !rollup.state) return "pending";
    switch (rollup.state) {
      case StatusState.Success: return "success";
      case StatusState.Error: return "error";
      case StatusState.Failure: return "failure";
      case StatusState.Pending: return "pending";
      default: return "pending";
    }
  }
  
  private makeCheck(obj: CheckRun | StatusContext): Check {
    if ("name" in obj) { // CheckRun
      return {
        name: obj.name,
        state:
          obj.conclusion === CheckConclusionState.Success
            ? "success"
            // Map other CheckConclusionState to CheckState if needed
            : obj.conclusion === CheckConclusionState.Failure || obj.conclusion === CheckConclusionState.Cancelled || obj.conclusion === CheckConclusionState.TimedOut || obj.conclusion === CheckConclusionState.ActionRequired || obj.conclusion === CheckConclusionState.Stale || obj.conclusion === CheckConclusionState.Skipped
            ? "failure"
            : "pending",
        description: obj.title ?? obj.name,
        url: obj.url ? String(obj.url) : null,
      };
    } else { // StatusContext
      return {
        name: obj.context,
        state: this.toCheckState(obj.state),
        description: obj.description ?? obj.context,
        url: obj.targetUrl ? String(obj.targetUrl) : null,
      };
    }
  }

  private toDate(v: unknown): string {
    if (typeof v === "number") {
      return new Date(v).toISOString();
    } else if (v instanceof Date) {
      return v.toISOString();
    } else if (typeof v === "string") {
        return v;
    }
    return String(v);
  }

  private maxDate(a: string, b: string) {
    const da = new Date(a);
    const db = new Date(b);
    return da > db ? a : b;
  }

  private toCheckState(v: StatusState | null | undefined): CheckState {
    return v == StatusState.Error
      ? "error"
      : v == StatusState.Failure
        ? "failure"
        : v == StatusState.Success
          ? "success"
          : "pending";
  }

  private addOrUpdateParticipant(
    participants: Participant[],
    actor: Actor,
    activeAt: unknown,
  ) {
    const user = this.makeUser(actor);
    if (user) {
      const participant = participants.find((p) => p.user.id === user.id);
      if (participant) {
        participant.numComments += 1;
        participant.lastActiveAt = this.maxDate(
          participant.lastActiveAt,
          this.toDate(activeAt),
        );
      } else {
        participants.push({
          user,
          numComments: 1,
          lastActiveAt: this.toDate(activeAt),
        });
      }
    }
  }
}

export const gitHubClient = new DefaultGitHubClient();
export const fetchPullComments = gitHubClient.fetchPullComments.bind(gitHubClient);

export async function getPullRequestMeta(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<{ branch: string; files: string[] }> {
  const octokit = token ? new Octokit({ auth: token }) : new Octokit();

  // branch name
  const { data: pr } = (await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    { owner, repo, pull_number: number },
  )) as PullHeadResponse;
  const branch = pr.head.ref; // now typed

  // changed files (may be paginated)
  const filesResp = await octokit.paginate(
    octokit.rest.pulls.listFiles,
    { owner, repo, pull_number: number, per_page: 100 },
  );
  const files = filesResp.map((f) => f.filename);

  return { branch, files };
}

// New helper functions:

/**
 * Lists commits for a pull request.
 * @returns A promise that resolves to an array of commit objects, newest `limit` commits.
 * Octokit's pulls.listCommits returns commits in chronological order (oldest to newest).
 * This function returns the newest `limit` commits from that list.
 */
export async function listPrCommits(
  owner: string,
  repo: string,
  pull_number: number,
  limit = 250, // Default to fetching up to 250 newest commits
  token?: string,
): Promise<PullRequestCommit[]> {
  // TODO: Use proper Octokit commit type: Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"]["response"]["data"]
  const octokit = token ? new Octokit({ auth: token }) : new Octokit();
  const commits = (await octokit.paginate(
    octokit.rest.pulls.listCommits,
    {
      owner,
      repo,
      pull_number,
      per_page: 100,
    },
  )) as unknown as PullRequestCommit[];
  // .slice(-limit) gets the last 'limit' elements, which are the newest ones.
  return commits.slice(-limit);
}

/**
 * Fetches the diff for a specific commit.
 * @returns A promise that resolves to the diff string.
 */
export async function getCommitDiff(
  owner: string,
  repo: string,
  sha: string,
  token?: string,
): Promise<string> {
  const octokit = token ? new Octokit({ auth: token }) : new Octokit();
  const { data } = (await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{commit_sha}",
    {
      owner,
      repo,
      commit_sha: sha,
      mediaType: { format: "diff" },
    },
  )) as unknown as DiffStringResponse;
  // The Octokit types might return the diff data as `unknown`
  return data; // safe
}