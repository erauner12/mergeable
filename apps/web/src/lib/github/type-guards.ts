/** Whether a PullRequest node contains merge-queue data */
export function hasMergeQueueEntry(
  n: unknown,
): n is { mergeQueueEntry: { enqueuedAt: unknown } } {
  return typeof n === "object" && n !== null && "mergeQueueEntry" in n;
}

export function hasStatusCheckRollup(n: unknown): n is {
  statusCheckRollup: { state?: unknown; contexts?: { nodes?: unknown[] } };
} {
  return typeof n === "object" && n !== null && "statusCheckRollup" in n;
}

export function hasLatestOpinionatedReviews(
  n: unknown,
): n is { latestOpinionatedReviews: { nodes?: unknown[] } } {
  return typeof n === "object" && n !== null && "latestOpinionatedReviews" in n;
}
