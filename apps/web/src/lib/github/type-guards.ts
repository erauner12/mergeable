import type {
  PullRequest_mergeQueueEntry,
  PullRequest_statusCheckRollup,
  PullRequest_latestOpinionatedReviews,
} from "../../../generated/gql/graphql";

/** Whether a PullRequest node contains merge-queue data */
export function hasMergeQueueEntry(
  n: unknown,
): n is { mergeQueueEntry: PullRequest_mergeQueueEntry } {
  return typeof n === "object" && n !== null && "mergeQueueEntry" in n;
}

export function hasStatusCheckRollup(
  n: unknown,
): n is { statusCheckRollup: PullRequest_statusCheckRollup } {
  return typeof n === "object" && n !== null && "statusCheckRollup" in n;
}

export function hasLatestOpinionatedReviews(
  n: unknown,
): n is { latestOpinionatedReviews: PullRequest_latestOpinionatedReviews } {
  return typeof n === "object" && n !== null && "latestOpinionatedReviews" in n;
}
