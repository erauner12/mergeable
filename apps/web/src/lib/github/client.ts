import { throttling } from "@octokit/plugin-throttling";
import type { Endpoints } from "@octokit/types";
import { Octokit } from "octokit";
import { isNonNull, isNonNullish } from "remeda";
import {
  CheckConclusionState,
  PullRequestReviewDecision,
  PullRequestReviewState,
} from "../../../generated/gql/graphql";
import {
  CheckConclusionState,
  PullRequestReviewDecision,
  PullRequestReviewState,
  StatusState, // ADDED
  type CheckRun, // ADDED
  type StatusContext, // ADDED
  type SearchQuery, // ADDED
  type SearchFullQuery, // ADDED
} from "../../../generated/gql/graphql";
import { SearchDocument, SearchFullDocument } from "../../../generated/gql/graphql"; // ADDED
import { prepareQuery } from "./search";
import {
  hasLatestOpinionatedReviews,
  hasMergeQueueEntry,
  hasStatusCheckRollup,
} from "./type-guards";
import type {
  Check,
  CheckState,
  Discussion,
  // Endpoint, // Removed Endpoint type import from here, it's defined locally
  Participant,
  Profile,
  PullProps,
  Team,
  User,
} from "./types";
import type { Actor } from "./type-guards";
import type { CommentBlockInput } from "../repoprompt";

// Type aliases for Octokit responses
type IssueComment = Endpoints["GET /repos/{owner}/{repo}/issues/{issue_number}/comments"]["response"]["data"][number];
type IssueComment = Endpoints["GET /repos/{owner}/{repo}/issues/{issue_number}/comments"]["response"]["data"][number];
type PullReview = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"]["response"]["data"][number];
type PullReviewComment = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"]["response"]["data"][number];
type UserTeam = Endpoints["GET /user/teams"]["response"]["data"][number];

// ADDED: Define PullNode based on the expected structure from SearchQuery/SearchFullQuery
type PullNode = Extract<NonNullable<SearchQuery["search"]["edges"]>[number], { node: any }>["node"];


// single commit item returned by pulls.listCommits
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
  private commentCache: Map<string, Promise<CommentBlockInput[]>> = new Map(); // Add commentCache definition

  private getOctokit(endpoint: Endpoint): Octokit { // ADDED METHOD
    if (!this.octokits[endpoint.auth]) {
      this.octokits[endpoint.auth] = new MyOctokit({ // Use MyOctokit to include throttling
        auth: endpoint.auth,
        baseUrl: endpoint.baseUrl,
        // throttle options will be taken from MyOctokit defaults
      });
    }
    return this.octokits[endpoint.auth];
  }

  async getViewer(endpoint: Endpoint): Promise<Profile> {
    const octokit = this.getOctokit(endpoint); // MODIFIED: use helper
    const userResponse = await octokit.rest.users.getAuthenticated();
    const user: User = {
      id: userResponse.data.node_id,
      name: userResponse.data.login,
      avatarUrl: userResponse.data.avatar_url,
    bot: false,
  };
  const teamsResponse = await octokit.paginate("GET /user/teams", { // octokit is already from getOctokit
    per_page: 100,
  });
  const teams: Team[] = teamsResponse.map((obj: Endpoints["GET /user/teams"]["response"]["data"][number]) => ({ // MODIFIED: added type for obj
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

  const octokit = this.getOctokit(endpoint); // MODIFIED: use helper
  const data = await octokit.graphql<SearchQuery | SearchFullQuery>(query, { // MODIFIED: Add explicit generic
    q,
    limit,
  });
  return (
    data.search.edges
      ?.filter(isNonNull)
      .map((n) => this.makePull(n.node as PullNode)) // MODIFIED: Cast n.node to PullNode or similar from GQL types
      .filter(isNonNull) ?? []
  );
}

  // New method: fetchPullComments
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
    // Clear cache entry if promise rejects to allow retries
    promise.catch(() => this.commentCache.delete(cacheKey));
    return promise;
  }

  private async _fetchPullCommentsLogic(
    endpoint: Endpoint,
    owner: string,
    repo: string,
    number: number,
  ): Promise<CommentBlockInput[]> {
    const octokit = this.getOctokit(endpoint); // MODIFIED: use helper
    const results: CommentBlockInput[] = [];
  
    // 1. Fetch issue comments (general comments on the PR)
    try {
      const issueComments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      });
      issueComments.forEach((comment: IssueComment) => { // MODIFIED: Use non-prefixed type
        if (comment.body) { // Ensure there's a body
          results.push({
            id: `issuecomment-${comment.id}`,
            kind: "comment",
            header: `### ISSUE COMMENT by @${comment.user?.login || "unknown"}`,
            commentBody: comment.body_text || comment.body || "",
            author: comment.user?.login || "unknown",
            authorAvatarUrl: comment.user?.avatar_url,
            timestamp: comment.created_at,
          });
        }
      });
    } catch (error) {
      console.error("Failed to fetch issue comments:", error);
    }

    // 2. Fetch pull request reviews (review summaries)
    try {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      });
      reviews.forEach((review: PullReview) => { // MODIFIED: Use non-prefixed type
        // Only include reviews that have a body and are not just pending
        if (review.body && review.state !== "PENDING") {
          results.push({
            id: `review-${review.id}`,
            kind: "comment",
            header: `### REVIEW by @${review.user?.login || "unknown"} (${review.state})`,
            commentBody: review.body_text || review.body || "",
            author: review.user?.login || "unknown",
            authorAvatarUrl: review.user?.avatar_url,
            timestamp: review.submitted_at || new Date().toISOString(), // submitted_at can be null for pending
          });
        }
      });
    } catch (error) {
      console.error("Failed to fetch PR reviews:", error);
    }

    // 3. Fetch review comments (comments on specific lines in the diff, forming threads)
    try {
      const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      });

      // Group comments by path and original_line to form threads
      const threads: Record<string, PullReviewComment[]> = {};
      reviewComments.forEach((comment: PullReviewComment) => { // MODIFIED: Use non-prefixed type
        if (!comment.path || typeof comment.original_line === 'undefined' || comment.original_line === null) return; // Skip comments not tied to a specific line/path
        const threadKey = `${comment.path}:${comment.original_line}`;
        if (!threads[threadKey]) {
          threads[threadKey] = [];
        }
        threads[threadKey].push(comment);
      });

      for (const threadKey in threads) {
        const commentsInThread = threads[threadKey].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        if (commentsInThread.length > 0) {
          const firstComment = commentsInThread[0];
          const threadBody = commentsInThread
            .map(c => `> _@${c.user?.login || "unknown"} · ${new Date(c.created_at).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}_\n\n${c.body_text || c.body || ""}`)
            .join("\n\n---\n");

          results.push({
            id: `thread-${firstComment.path}-${firstComment.original_line}-${firstComment.id}`,
            kind: "comment",
            header: `### THREAD ON ${firstComment.path}:${firstComment.original_line}`,
            commentBody: threadBody,
            author: firstComment.user?.login || "unknown", // Author of the first comment in thread
            authorAvatarUrl: firstComment.user?.avatar_url,
            timestamp: firstComment.created_at,
            filePath: firstComment.path,
            line: firstComment.original_line,
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch review comments (threads):", error);
    }
    
    // Sort all collected blocks by timestamp
    results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return results;
  }

  private makePull(prNode: any): PullProps { // TODO: Replace 'any' with the correct GraphQL PullRequest type from SearchQuery/SearchFullQuery
    const discussions: Discussion[] = []; // This now uses the updated Discussion type from types.ts
    const participants: Participant[] = [];

    for (const node of prNode.comments?.nodes ?? []) {
      if (!node) continue;
      this.addOrUpdateParticipant(participants, node.author, node.createdAt);
      discussions.push({ // This object structure should now match the new Discussion type
        id: node.id,
        author: this.makeUser(node.author),
        createdAt: this.toDate(node.createdAt),
        body: node.bodyText,
        isResolved: node.isResolved ?? false,
        url: node.url,
      });
    }

    if (hasLatestOpinionatedReviews(prNode)) {
      for (const node of prNode.latestOpinionatedReviews.nodes ?? []) {
        if (!node) continue;
        this.addOrUpdateParticipant(participants, node.author, node.createdAt);
      }
    }

    if (hasMergeQueueEntry(prNode)) {
      const mergeQueueEntry = prNode.mergeQueueEntry;
      if (mergeQueueEntry?.commit?.author) {
        this.addOrUpdateParticipant(
          participants,
          mergeQueueEntry.commit.author,
          mergeQueueEntry.createdAt,
        );
      }
    }

    return {
      id: prNode.id,
      repo: `${prNode.repository.owner.login}/${prNode.repository.name}`, // Construct repo string
      number: prNode.number,
      title: prNode.title,
      body: prNode.bodyHTML || prNode.bodyText || prNode.body, // Handle different body fields
      state: this.toPullState(prNode), // Use helper to map state
      checkState: this.toCheckStateFromRollup(prNode.statusCheckRollup), // Use helper for check state
      queueState: hasMergeQueueEntry(prNode) && prNode.mergeQueueEntry?.mergeableState === "MERGEABLE" ? "mergeable" :
                  hasMergeQueueEntry(prNode) && prNode.mergeQueueEntry?.mergeableState === "UNMERGEABLE" ? "unmergeable" :
                  "pending", // Map queue state
      createdAt: this.toDate(prNode.createdAt),
      updatedAt: this.toDate(prNode.updatedAt),
      enqueuedAt: hasMergeQueueEntry(prNode) ? this.toDate(prNode.mergeQueueEntry.enqueuedAt) : undefined,
      mergedAt: this.toDate(prNode.mergedAt),
      closedAt: this.toDate(prNode.closedAt),
      locked: prNode.locked ?? false,
      url: prNode.url,
      labels:
        prNode.labels?.nodes
          ?.filter(isNonNull)
          .map((n: { name: string }) => n.name) ?? [],
      additions: prNode.additions ?? 0,
      deletions: prNode.deletions ?? 0,
      author: this.makeUser(prNode.author),
      requestedReviewers: prNode.reviewRequests?.nodes?.map((req: any) => this.makeUser(req.requestedReviewer)).filter(isNonNull) ?? [],
      requestedTeams: prNode.reviewRequests?.nodes?.map((req: any) => this.makeTeam(req.requestedReviewer)).filter(isNonNull) ?? [],
      reviews: hasLatestOpinionatedReviews(prNode)
        ? (() => {
            const reviews = prNode.latestOpinionatedReviews.nodes?.filter(
              isNonNull,
            );
            return (
              reviews
                ?.filter(
                  (n: any) => // TODO: type 'n' correctly from GQL
                    n.state !== PullRequestReviewState.Pending,
                )
                .map((n: any) => ({ // TODO: type 'n' correctly from GQL
                  author: this.makeUser(n.author),
                  collaborator: n.authorCanPushToRepository,
                  approved: n.state === PullRequestReviewState.Approved,
                })) ?? []
            );
          })()
        : [],
      checks: hasStatusCheckRollup(prNode)
        ? (() => {
            // Buffer as unknown[], then narrow → (CheckRun | StatusContext)[]
            const rawContexts: unknown[] =
              prNode.statusCheckRollup?.contexts?.nodes ?? [];

            const nodes = rawContexts
              .filter(isNonNullish)
              .map((c) => c as CheckRun | StatusContext);

            return nodes.map((c) => this.makeCheck(c));
          })()
        : [],
      discussions,
      // Add new fields here
      branch: prNode.headRefName ?? "", // Provide a fallback if headRefName might be undefined
      files:
        prNode.files?.nodes
          ?.filter(isNonNullish)
          .map((f: { path: string }) => f.path) ?? [],
      participants, // ADDED
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
      // No user provided, or unsupported type.
      return null;
    }
  }

  private makeTeam(obj: Actor): Team | null { // ADDED helper
    if (obj?.__typename === "Team") {
      return {
        id: obj.id,
        name: obj.name ?? obj.slug, // Use name or slug
      };
    }
    return null;
  }

  private toPullState(prNode: any): PullProps["state"] { // ADDED helper
    if (prNode.isDraft) return "draft";
    if (prNode.merged) return "merged";
    if (prNode.closed) return "closed";
    if (hasMergeQueueEntry(prNode) && prNode.mergeQueueEntry) return "enqueued";
    if (prNode.reviewDecision === PullRequestReviewDecision.Approved) return "approved";
    return "pending";
  }

  private toCheckStateFromRollup(rollup: any): CheckState { // ADDED helper
    if (!rollup || !rollup.state) return "pending";
    switch (rollup.state) {
      case "SUCCESS": return "success";
      case "ERROR": return "error";
      case "FAILURE": return "failure";
      default: return "pending";
    }
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
      // No user provided, or unsupported type.
      return null;
    }
  }

  private makeCheck(obj: CheckRun | StatusContext): Check {
    if ("name" in obj) {
      return {
        name: obj.name,
        state:
          obj.conclusion === CheckConclusionState.Success
            ? "success"
            : "pending",
        description: obj.title ?? obj.name,
        url: obj.url ? String(obj.url) : null,
      };
    } else {
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
    } else {
      return String(v);
    }
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