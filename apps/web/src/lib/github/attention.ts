import { firstBy, prop } from "remeda";
import type { Attention, PullProps, Profile, Discussion } from "./types";

// A pull request is in the attention set if:
// - The user is the author, and the pull request is approved
// - The user is the author, and there is a failing CI check
// - The user is the author, and there is an unread comment in an unresolved discussion
// - The user is the author, the pull request is not approved with unresolved discussions
// - The user is the author, the pull request is enqueued but cannot be merged
// - The user is a reviewer, and there is an unread comment in an unresolved discussion that he participated in
// - The user is a reviewer, and the pull request is not approved with no unresolved discussions
// - The user is a requested reviewer, and the pull request is not approved
export function isInAttentionSet(viewer: Profile, pull: PullProps): Attention {
  if (
    pull.state === "draft" ||
    pull.state === "merged" ||
    pull.state === "closed"
  ) {
    // Draft, merged or closed pull requests are never in the attention set.
    return { set: false };
  }
  const isAuthor = pull.author?.id === viewer.user.id;
  const viewerTeams = new Set(viewer.teams.map((t) => t.id));
  const isReviewer = pull.reviews.some(
    (r) => r.collaborator && r.author?.id === viewer.user.id,
  );
  const isRequestedReviewer =
    pull.requestedReviewers.some((r) => r.id === viewer.user.id) ||
    pull.requestedTeams.some((t) => viewerTeams.has(t.id));

  if (!isAuthor && !isReviewer && !isRequestedReviewer) {
    // Only authors and reviewers can be in the attention set.
    return { set: false };
  }

  if (pull.state === "enqueued") {
    // Enqueued pull requests are in the attention set only if they cannot be merged.
    if (isAuthor && pull.queueState === "unmergeable") {
      return { set: true, reason: "Pull request is unmergeable" };
    } else {
      return { set: false };
    }
  }

  function isCodeThread(d: Discussion): d is Discussion & { filePath: string } {
    return typeof d.filePath === 'string' && d.filePath.length > 0;
  }

  let unreadDiscussions = 0;
  let unresolvedDiscussions = 0;
  for (const discussion of pull.discussions) {
    if (discussion.isResolved) {
      // Resolved discussions are ignored.
      continue;
    }
    if (!isCodeThread(discussion)) {
      // Top-level discussion is ignored, since it tends to be a giant catch-all thread.
      continue;
    }
    // The user plan mentions: "Replace participant traversal with stub: const actors = pull.participants;"
    // However, the original loop iterates `pull.discussions` and then accesses `discussion.participants`.
    // The new `Discussion` type in `types.ts` does not have a `participants` field.
    // `pull.participants` is a list of all participants in the PR, not specific to a discussion.
    // Assuming the intent is to check if the viewer participated in *this specific discussion thread*.
    // This requires a different approach if `Discussion` itself doesn't hold its participants.
    // For now, I will proceed with the assumption that the logic needs to be adapted based on available fields on `Discussion` or `PullProps`.
    // The provided `Discussion` type has `author`. If a discussion is a thread of comments, this might be more complex.
    // The plan's `Discussion` type in `types.ts` is:
    // export type Discussion = { id: string; author: User | null; createdAt: string; body: string; isResolved: boolean; url: string; filePath?: string; line?: number; };
    // It does not have `participants` or `lastActiveAt`.
    // The `pull.participants` field on `PullProps` is: `participants: Participant[];` where `Participant = { user: User; numComments: number; lastActiveAt: string; }`
    // This seems to be a global list of participants for the PR.

    // The original logic for `unreadDiscussions` relied on `discussion.participants` and `lastActiveAt`.
    // This logic needs to be re-evaluated based on the new data model.
    // For now, I will simplify this part based on the available `Discussion` fields and `pull.participants`.
    // This is a placeholder and might need further refinement based on the exact desired behavior.

    unresolvedDiscussions++; // Count all unresolved code threads.

    // Simplified logic for unread: check if the last comment (approximated by PR participants) is not by the viewer.
    // This is a significant simplification and might not match the original intent perfectly.
    const prParticipants = pull.participants;
    const lastActorInPr = prParticipants.length > 0 ? firstBy(prParticipants, [prop("lastActiveAt"), "desc"]) : null;

    if (lastActorInPr && lastActorInPr.user.id !== viewer.user.id) {
        // This is a very broad check. If any participant (not necessarily in this specific discussion)
        // was active more recently than the viewer, consider it "unread" for the author.
        // For a reviewer, it's harder to determine if they participated in *this* discussion without more info on Discussion.
        if (isAuthor) {
            unreadDiscussions++;
        } else if (isReviewer) {
            // A more accurate check would be if (discussion.author.id !== viewer.user.id && viewer_participated_in_this_thread)
            // This part is difficult with the current Discussion type.
            // For now, let's assume if the PR has recent activity not by the reviewer, it's an unread discussion for them too.
            // This is a simplification.
            const viewerParticipatedInPr = prParticipants.some(p => p.user.id === viewer.user.id);
            if (viewerParticipatedInPr) {
                 unreadDiscussions++;
            }
        }
    }
  }
  if (unreadDiscussions > 0) {
    // There have been some relevant new comments that bring the user inside the attention set.
    // Give priority to this reason for being in the attention set over all others, to encourage
    // users to have a look at comments and reply to them.
    return {
      set: true,
      reason: `${unreadDiscussions} unread discussion${unreadDiscussions > 1 ? "s" : ""}`,
    };
  } else if ((isAuthor || isReviewer) && unresolvedDiscussions > 0) {
    return {
      set: true,
      reason: `${unresolvedDiscussions} unresolved discussion${unresolvedDiscussions > 1 ? "s" : ""}`,
    };
  } else if (
    isAuthor &&
    (pull.checkState === "error" || pull.checkState == "failure")
  ) {
    return { set: true, reason: "CI is failing" };
  } else if (isAuthor && pull.state === "approved") {
    return { set: true, reason: "Pull request is approved" };
  } else if (
    isReviewer &&
    pull.state !== "approved" &&
    unresolvedDiscussions === 0
  ) {
    return { set: true, reason: "Pull request is not approved" };
  } else if (isRequestedReviewer && pull.state !== "approved") {
    return { set: true, reason: "Review is requested" };
  } else {
    return { set: false };
  }
}