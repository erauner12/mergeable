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
  SearchDocument,
  SearchFullDocument,
  StatusState,
  type CheckRun,
  type SearchFullQuery,
  type SearchQuery,
  type StatusContext,
} from "../../../generated/gql/graphql";
import type { CommentBlockInput } from "../repoprompt";
import { makeThreadBlock, type IndividualCommentData } from "./commentThreads"; // ADDED IMPORT
import { prepareQuery } from "./search";
import type { Actor, PullRequestNode } from "./type-guards";
import {
  hasComments,
  hasFiles,
  hasLatestOpinionatedReviews,
  hasMergeQueueEntry,
  hasStatusCheckRollup,
  isPullRequestNode,
} from "./type-guards";
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
const MyOctokit = Octokit.plugin(throttling);

export type PullRequestCommit =
  Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"]["response"]["data"][number];

// Type for individual review comments from the list endpoint
type ReviewCommentItem =
  Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"]["response"]["data"][number];

// Extended type for the response of fetching a single pull request comment, including 'is_resolved'
type PullRequestCommentSingleWithResolution =
  Endpoints["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}"]["response"]["data"] & {
    is_resolved?: boolean;
  };

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
  baseUrl?: string, // New parameter
): Promise<string> {
  const octokit = token
    ? new Octokit({ auth: token, baseUrl: baseUrl ?? "https://api.github.com" }) // Updated Octokit instantiation
    : new Octokit({ baseUrl: baseUrl ?? "https://api.github.com" }); // Also handle unauthenticated case with baseUrl
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
  private threadResolutionCache: Map<string, Promise<boolean>> = new Map(); // ADDED cache for thread resolution

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
    const teams: Team[] = teamsResponse.map(
      (obj: Endpoints["GET /user/teams"]["response"]["data"][number]) => ({
        id: obj.node_id,
        name: `${obj.organization.login}/${obj.slug}`,
      }),
    );
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
    const pullsResult: PullProps[] = [];
    if (data.search.edges) {
      for (const edge of data.search.edges) {
        if (!edge) {
          continue; // Skip null edges
        }
        const node = edge.node;
        // The node itself can be null or not a PullRequest
        if (isPullRequestNode(node)) {
          pullsResult.push(this.makePull(node));
        }
      }
    }
    return pullsResult;
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
    const issueCommentsResponse = await octokit.paginate(
      // Renamed for clarity
      octokit.rest.issues.listComments,
      {
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      },
    );

    // Fetch pull request reviews
    const reviewsResponse = await octokit.paginate(
      octokit.rest.pulls.listReviews,
      {
        // Renamed for clarity
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      },
    );

    // Fetch pull request review comments
    const reviewCommentsResponse = await octokit.paginate(
      // Renamed for clarity
      octokit.rest.pulls.listReviewComments,
      {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      },
    );

    // Normalize all comments into CommentBlockInput[]
    const allCommentBlocks: CommentBlockInput[] = [];

    // 1. Issue comments (top-level PR comments)
    for (const c of issueCommentsResponse) {
      allCommentBlocks.push({
        id: `issue-${c.id.toString()}`, // Ensure unique ID namespace
        kind: "comment",
        header: `### ISSUE COMMENT by @${c.user?.login ?? "unknown"}`,
        commentBody: c.body ?? "",
        author: c.user?.login ?? "unknown",
        authorAvatarUrl: c.user?.avatar_url,
        timestamp: c.created_at,
        // threadId, diffHunk, filePath, line are undefined for plain issue comments
      });
    }

    // 2. Reviews (summary comments)
    for (const r of reviewsResponse) {
      if (r.body && r.submitted_at) {
        // Only include reviews that have a body text and a submission timestamp
        allCommentBlocks.push({
          id: `review-${r.id.toString()}`, // Ensure unique ID namespace
          kind: "comment",
          header: `### REVIEW by @${r.user?.login ?? "unknown"} (${r.state})`,
          commentBody: r.body,
          author: r.user?.login ?? "unknown",
          authorAvatarUrl: r.user?.avatar_url, // Corrected from c.user to r.user
          timestamp: r.submitted_at, // Now guaranteed to be a string, no incorrect fallback
          // threadId, diffHunk, filePath, line are undefined for review summaries
        });
      }
    }

    // 3. Pull request review comments (comments on diffs / threads)
    // Group review comments by thread and fetch/cached resolution status

    // Helper: groupBy function
    function groupBy<T, K extends string | number>(
      arr: T[],
      keyFn: (item: T) => K,
    ): Record<K, T[]> {
      const result = {} as Record<K, T[]>;
      for (const item of arr) {
        const key = keyFn(item);
        if (!result[key]) result[key] = [];
        result[key].push(item);
      }
      return result;
    }

    // Helper: derive a stable key representing a single conversation thread
    // This new keying logic ensures that comments are grouped by their actual conversation root,
    // using `in_reply_to_id` if available, or the comment's own `id` if it's a new thread root.
    // GitHub comment IDs are unique within a repository, so the rootId is sufficient.
    // This works for both comments within a formal review and standalone inline comment threads.
    function getThreadKey(rc: ReviewCommentItem): string {
      // Root of the conversation: either the comment we reply to, or ourselves.
      // GitHub comment IDs are unique within the repository.
      const rootId = rc.in_reply_to_id ?? rc.id;
      return String(rootId);
    }
    
    // Only include comments with a user (should always be true)
    const validReviewComments = reviewCommentsResponse.filter(
      (rc) => !!rc.user,
    );

    const groupedByThreadKey = groupBy(validReviewComments, getThreadKey);

    for (const threadKey in groupedByThreadKey) {
      const commentsInThreadGroup = groupedByThreadKey[threadKey];
      if (!commentsInThreadGroup || commentsInThreadGroup.length === 0) {
        continue;
      }

      // Sort comments chronologically within the thread
      commentsInThreadGroup.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      const rootComment = commentsInThreadGroup[0]; // The first comment chronologically establishes path, line, hunk for the thread display
      const lastComment =
        commentsInThreadGroup[commentsInThreadGroup.length - 1]; // Get the last comment

      const path = rootComment.path;
      // Use line in diff, fallback to original_line in commit, then 0
      const line = rootComment.line ?? rootComment.original_line ?? 0;
      const diffHunk = rootComment.diff_hunk ?? undefined;

      // Fetch resolution status for the thread
      // Note: Standard GitHub REST API for a single comment does not provide 'is_resolved'.
      // This implementation follows the user's plan, assuming this call yields resolution status.
      // Use the **latest** comment's metadata because GitHub updates
      // `is_resolved` on every comment in a thread once it is resolved,
      // or at least the latest comment should reflect the current status.
      let resolved = false; // Default to unresolved
      const commentIdForThreadMeta = lastComment.id; // Use ID of the last comment in the thread

      // Use threadKey for caching resolution as it represents the group.
      const cacheKeyForResolution = threadKey;

      if (this.threadResolutionCache.has(cacheKeyForResolution)) {
        resolved = await this.threadResolutionCache.get(cacheKeyForResolution)!;
      } else {
        const resolutionPromise = octokit
          .request("GET /repos/{owner}/{repo}/pulls/comments/{comment_id}", {
            owner,
            repo,
            comment_id: commentIdForThreadMeta, // Use the ID of the last comment in the thread
          })
          .then((response) => {
            // Assuming 'is_resolved' is available on response.data as per plan.
            // Standard Octokit types do not include this for this endpoint.
            return (
              (response.data as PullRequestCommentSingleWithResolution)
                ?.is_resolved === true
            );
          })
          .catch((err) => {
            console.warn(
              `Failed to fetch thread metadata for threadKey ${threadKey} (comment ${commentIdForThreadMeta}):`,
              err,
            );
            return false; // Default to unresolved on error
          });
        this.threadResolutionCache.set(
          cacheKeyForResolution,
          resolutionPromise,
        );
        // Ensure cache is cleaned up if the promise itself rejects, not just its chained .then/.catch
        resolutionPromise.catch(() => {
          if (
            this.threadResolutionCache.get(cacheKeyForResolution) ===
            resolutionPromise
          ) {
            this.threadResolutionCache.delete(cacheKeyForResolution);
          }
        });
        resolved = await resolutionPromise;
      }

      const individualCommentsData: IndividualCommentData[] =
        commentsInThreadGroup.map((rc) => ({
          id: rc.id.toString(),
          commentBody: rc.body ?? "",
          // rc.user is guaranteed to be non-null here due to the filter above
          author: rc.user.login,
          authorAvatarUrl: rc.user.avatar_url,
          timestamp: rc.created_at,
        }));

      const threadBlock = makeThreadBlock(
        threadKey, // The key used for grouping (e.g., path:diff_hunk)
        path,
        line,
        diffHunk,
        individualCommentsData, // Sorted
        resolved, // Pass resolved status
      );
      allCommentBlocks.push(threadBlock);
    }

    // Sort all blocks (issue comments, review summaries, thread blocks) by their primary timestamp
    allCommentBlocks.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return allCommentBlocks;
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
    if (
      hasLatestOpinionatedReviews(prNode) &&
      prNode.latestOpinionatedReviews?.nodes
    ) {
      for (const node of prNode.latestOpinionatedReviews.nodes) {
        if (!node) continue;
        // Use submittedAt if available, otherwise createdAt for participant activity
        this.addOrUpdateParticipant(
          participants,
          node.author,
          node.submittedAt ?? node.createdAt,
        );
      }
    }

    // Use hasMergeQueueEntry guard for merge queue participants
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

    const mqState = hasMergeQueueEntry(prNode)
      ? prNode.mergeQueueEntry?.state
      : undefined;

    return {
      id: prNode.id,
      repo: `${prNode.repository.owner.login}/${prNode.repository.name}`,
      number: prNode.number,
      title: prNode.title,
      body: prNode.bodyHTML || prNode.bodyText || prNode.body || "",
      state: this.toPullState(prNode),
      checkState: this.toCheckStateFromRollup(prNode.statusCheckRollup),
      queueState:
        hasMergeQueueEntry(prNode) && mqState === "MERGEABLE"
          ? "mergeable"
          : hasMergeQueueEntry(prNode) && mqState === "UNMERGEABLE"
            ? "unmergeable"
            : "pending",
      createdAt: this.toDate(prNode.createdAt),
      updatedAt: this.toDate(prNode.updatedAt),
      enqueuedAt: hasMergeQueueEntry(prNode)
        ? this.toDate(prNode.mergeQueueEntry?.enqueuedAt)
        : undefined,
      mergedAt: this.toDate(prNode.mergedAt),
      closedAt: this.toDate(prNode.closedAt),
      locked: prNode.locked ?? false,
      url: prNode.url,
      labels:
        prNode.labels?.nodes
          ?.filter((n: { name?: string } | null): n is { name: string } =>
            isNonNull(n),
          )
          .map((n: { name: string }) => n.name) ?? [],
      additions: prNode.additions ?? 0,
      deletions: prNode.deletions ?? 0,
      author: this.makeUser(prNode.author),
      requestedReviewers:
        prNode.reviewRequests?.nodes
          ?.map((req) => this.makeUser(req?.requestedReviewer ?? null))
          .filter(isNonNull) ?? [],
      requestedTeams:
        prNode.reviewRequests?.nodes
          ?.map((req) => this.makeTeam(req?.requestedReviewer ?? null))
          .filter(isNonNull) ?? [],
      reviews:
        hasLatestOpinionatedReviews(prNode) &&
        prNode.latestOpinionatedReviews?.nodes
          ? (() => {
              const reviews =
                prNode.latestOpinionatedReviews.nodes?.filter(
                  (
                    n,
                  ): n is NonNullable<
                    (typeof prNode.latestOpinionatedReviews.nodes)[number]
                  > => isNonNull(n),
                ) ?? [];
              return (
                reviews
                  ?.filter((n) => n.state !== PullRequestReviewState.Pending)
                  .map((n) => ({
                    author: this.makeUser(n.author),
                    collaborator: n.authorCanPushToRepository,
                    approved: n.state === PullRequestReviewState.Approved,
                  })) ?? []
              );
            })()
          : [],
      checks:
        hasStatusCheckRollup(prNode) &&
        prNode.statusCheckRollup?.contexts?.nodes
          ? (() => {
              const nodes = (prNode.statusCheckRollup.contexts.nodes ?? [])
                .filter(
                  (
                    c: CheckRun | StatusContext | null | undefined,
                  ): c is CheckRun | StatusContext => isNonNullish(c),
                )
                .map((c: CheckRun | StatusContext) => c);
              return nodes.map((c: CheckRun | StatusContext) =>
                this.makeCheck(c),
              );
            })()
          : [],
      discussions,
      branch: prNode.headRefName ?? "",
      files:
        hasFiles(prNode) && prNode.files?.nodes
          ? prNode.files.nodes
              .filter(
                (
                  f: { path?: string } | null | undefined,
                ): f is { path: string } => isNonNullish(f),
              )
              .map((f: { path: string }) => f.path)
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
    if (obj?.__typename === "Team") {
      // Cast obj to the expected shape for a Team actor
      const team = obj as {
        __typename: "Team";
        id: string;
        name?: string;
        slug?: string /* other team properties if available */;
      };
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
    if (prNode.reviewDecision === PullRequestReviewDecision.Approved)
      return "approved";
    return "pending";
  }

  private toCheckStateFromRollup(
    rollup: PullRequestNode["statusCheckRollup"],
  ): CheckState {
    if (!rollup || !rollup.state) return "pending";
    switch (rollup.state) {
      case StatusState.Success:
        return "success";
      case StatusState.Error:
        return "error";
      case StatusState.Failure:
        return "failure";
      case StatusState.Pending:
        return "pending";
      default:
        return "pending";
    }
  }

  private makeCheck(obj: CheckRun | StatusContext): Check {
    if ("name" in obj) {
      // CheckRun
      return {
        name: obj.name,
        state:
          obj.conclusion === CheckConclusionState.Success
            ? "success"
            : // Map other CheckConclusionState to CheckState if needed
              obj.conclusion === CheckConclusionState.Failure ||
                obj.conclusion === CheckConclusionState.Cancelled ||
                obj.conclusion === CheckConclusionState.TimedOut ||
                obj.conclusion === CheckConclusionState.ActionRequired ||
                obj.conclusion === CheckConclusionState.Stale ||
                obj.conclusion === CheckConclusionState.Skipped
              ? "failure"
              : "pending",
        description: obj.title ?? obj.name,
        url: obj.url ? String(obj.url) : null,
      };
    } else {
      // StatusContext
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
export const fetchPullComments =
  gitHubClient.fetchPullComments.bind(gitHubClient);

export async function getPullRequestMeta(
  owner: string,
  repo: string,
  number: number,
  token?: string,
  baseUrl?: string, // New parameter
): Promise<{ branch: string; files: string[] }> {
  const octokit = token
    ? new Octokit({ auth: token, baseUrl: baseUrl ?? "https://api.github.com" }) // Updated Octokit instantiation
    : new Octokit({ baseUrl: baseUrl ?? "https://api.github.com" }); // Also handle unauthenticated case with baseUrl

  // branch name
  const { data: pr } = (await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    { owner, repo, pull_number: number },
  )) as PullHeadResponse;
  const branch = pr.head.ref; // now typed

  // changed files (may be paginated)
  const filesResp = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });
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
  baseUrl?: string, // New parameter
): Promise<PullRequestCommit[]> {
  // TODO: Use proper Octokit commit type: Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"]["response"]["data"]
  const octokit = token
    ? new Octokit({ auth: token, baseUrl: baseUrl ?? "https://api.github.com" }) // Updated Octokit instantiation
    : new Octokit({ baseUrl: baseUrl ?? "https://api.github.com" }); // Also handle unauthenticated case with baseUrl
  const commits = (await octokit.paginate(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number,
    per_page: 100,
  })) as unknown as PullRequestCommit[];
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
  baseUrl?: string, // New parameter
): Promise<string> {
  const octokit = token
    ? new Octokit({ auth: token, baseUrl: baseUrl ?? "https://api.github.com" }) // Updated Octokit instantiation
    : new Octokit({ baseUrl: baseUrl ?? "https://api.github.com" }); // Also handle unauthenticated case with baseUrl
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