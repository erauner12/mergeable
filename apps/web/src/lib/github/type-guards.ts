import {
  StatusState,
  PullRequestReviewState,
  type CheckRun,
  type StatusContext,
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

/** Whether a PullRequest node contains merge-queue data */
export function hasMergeQueueEntry(
  n: unknown,
): n is { mergeQueueEntry: { commit?: { author?: Actor }; createdAt: unknown; enqueuedAt?: unknown } } {
  return typeof n === "object" && n !== null && "mergeQueueEntry" in n;
}

export function hasStatusCheckRollup(