import {
  StatusState,
  PullRequestReviewState,
  type CheckRun,
  type StatusContext,
} from "../../../generated/gql/graphql";

type Actor =
  | {
      __typename: "Bot" | "Mannequin" | "User" | "EnterpriseUserAccount";
      id: string;
      login: string;
      avatarUrl: string;
    }
  | { __typename: "Organization" }
  | undefined
  | null;

/** Whether a PullRequest node contains merge-queue data */
export function hasMergeQueueEntry(
  n: unknown,
): n is { mergeQueueEntry: { enqueuedAt: unknown } } {
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
    }[];
  };
} {
  return typeof n === "object" && n !== null && "latestOpinionatedReviews" in n;
}