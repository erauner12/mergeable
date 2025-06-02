import {
  StatusState,
  PullRequestReviewState,
  type CheckRun,
  type StatusContext,
  type PullRequestReviewDecision, // Added
} from "../../../generated/gql/graphql";

// Export the Actor type
export type Actor =
  | {
      __typename: "Bot" | "Mannequin" | "User" | "EnterpriseUserAccount";
      id: string;
      login: string;
      avatarUrl: string;
    }
  | { __typename: "Organization" }
  | undefined
  | null;

// New PullRequestNode interface
export interface PullRequestNode {
  __typename: "PullRequest";
  id: string;
  number: number;
  title: string;
  body?: string | null;
  bodyHTML?: string | null;
  bodyText?: string | null;
  url: string;
  isDraft: boolean;
  merged: boolean;
  closed: boolean;
  locked?: boolean | null;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  additions?: number | null;
  deletions?: number | null;

  repository: { __typename?: "Repository", owner: { __typename?: "User" | "Organization", login: string }, name: string };
  author?: Actor | null;

  comments?: { __typename?: "IssueCommentConnection", nodes?: ({ __typename?: "IssueComment", id: string; author?: Actor | null; createdAt: string; bodyText: string; isResolved?: boolean; url: string } | null)[] } | null;

  latestOpinionatedReviews?: { __typename?: "PullRequestReviewConnection", nodes?: ({ __typename?: "PullRequestReview", state: PullRequestReviewState; author?: Actor | null; authorCanPushToRepository: boolean; createdAt: string; submittedAt?: string | null } | null)[] } | null;

  mergeQueueEntry?: { __typename?: "MergeQueueEntry", state?: string | null, createdAt: string; enqueuedAt?: string | null; commit?: { __typename?: "Commit", author?: Actor | null } | null } | null;

  statusCheckRollup?: { __typename?: "StatusCheckRollup", state?: StatusState | null; contexts?: { __typename?: "StatusCheckRollupContextConnection", nodes?: (CheckRun | StatusContext | null)[] } | null } | null;

  reviewRequests?: { __typename?: "ReviewRequestConnection", nodes?: ({ __typename?: "ReviewRequest", requestedReviewer?: Actor | null } | null)[] } | null;

  files?: { __typename?: "PullRequestChangedFileConnection", nodes?: ({ __typename?: "PullRequestChangedFile", path: string } | null)[] } | null;

  headRefName?: string | null;

  labels?: { __typename?: "LabelConnection", nodes?: ({ __typename?: "Label", name: string } | null)[] } | null;
  reviewDecision?: PullRequestReviewDecision | null;
}

// New isPullRequestNode type guard
export function isPullRequestNode(n: unknown): n is PullRequestNode {
  return !!n && typeof n === "object" && (n as any).__typename === "PullRequest";
}

/** Whether a PullRequest node contains merge-queue data */
export function hasMergeQueueEntry(
  n: unknown,
): n is { mergeQueueEntry: { commit?: { author?: Actor }; createdAt: unknown; enqueuedAt?: unknown } } {
  return typeof n === "object" && n !== null && "mergeQueueEntry" in n;
}

export function hasStatusCheckRollup(
  n: unknown,
): n is {
  statusCheckRollup: {
    state?: StatusState | null;
    contexts?: { nodes?: (CheckRun | StatusContext | null)[] };
  };
} {
  return typeof n === "object" && n !== null && "statusCheckRollup" in n;
}

export function hasLatestOpinionatedReviews(
  n: unknown,
): n is {
  latestOpinionatedReviews: {
    nodes?: {
      state: PullRequestReviewState;
      author: Actor;
      authorCanPushToRepository: boolean;
      // Add createdAt and submittedAt to match PullRequestNode definition
      createdAt: string;
      submittedAt?: string;
    }[];
  };
} {
  return typeof n === "object" && n !== null && "latestOpinionatedReviews" in n;
}

// New helper type guards
export function hasComments(n: unknown): n is { comments: { nodes?: unknown[] } } {
  return !!n && typeof n === "object" && "comments" in n && typeof (n as any).comments === "object" && (n as any).comments !== null && "nodes" in (n as any).comments;
}

export function hasFiles(n: unknown): n is { files: { nodes?: { path: string }[] } } {
  return !!n && typeof n === "object" && "files" in n && typeof (n as any).files === "object" && (n as any).files !== null && "nodes" in (n as any).files;
}