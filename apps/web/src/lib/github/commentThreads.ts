import type { CommentBlockInput } from "../repoprompt";

// This is the structure for individual comments passed to makeThreadBlock
export interface IndividualCommentData {
  id: string; // original comment ID
  commentBody: string;
  author: string;
  authorAvatarUrl?: string;
  timestamp: string;
}

export function formatSingleComment(comment: IndividualCommentData): string {
  const date = new Date(comment.timestamp);
  // Consistent with formatDateUtcShort but includes time and uses full month name.
  // Example: "Jan 01, 2024 00:00 UTC"
  const months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"];
  // const day = String(date.getUTCDate()).padStart(2, "0"); // Old
  // const hours = String(date.getUTCHours()).padStart(2, "0"); // Old
  // const minutes = String(date.getUTCMinutes()).padStart(2, "0"); // Old
  
  // const dateString = `${months[date.getUTCMonth()]} ${day}, ${date.getUTCFullYear()} ${hours}:${minutes} UTC`; // Old

  // New format: YYYY-Mon-DD
  const dateString = `${date.getUTCFullYear()}-${months[date.getUTCMonth()]}-${String(date.getUTCDate()).padStart(2, "0")}`;

  return `> _@${comment.author} · ${dateString}_\n\n${comment.commentBody.trim()}`;
}

export function makeThreadBlock(
  threadKey: string, // The original key used for grouping (e.g., review_id or comment-id)
  path: string,
  line: number,
  hunk: string | undefined,
  comments: IndividualCommentData[] // Sorted individual comments
): CommentBlockInput {
  if (comments.length === 0) {
    // This case should ideally be prevented by the caller
    // For robustness, return a minimal block or throw error
    console.warn(`makeThreadBlock called with no comments for threadKey: ${threadKey}`);
    // Fallback to a generic representation or handle as an error
    // For now, let's assume comments array is never empty if called correctly.
    // If it can be, a more robust fallback is needed.
    // Throwing an error might be too disruptive if the API occasionally yields empty threads.
    // Let's proceed assuming comments is non-empty based on typical usage.
    // If this assumption is wrong, the caller (`_fetchPullCommentsLogic`) should filter out empty comment lists.
    const now = new Date().toISOString();
    return {
        id: `emptythread-${threadKey}-${now}`,
        kind: "comment",
        header: `### EMPTY THREAD ON ${path}#L${line}`,
        commentBody: "_No comments in this thread._",
        author: "unknown",
        timestamp: now,
        threadId: threadKey,
        diffHunk: hunk,
        filePath: path,
        line: line,
    };
  }

  const firstComment = comments[0];
  const lastComment = comments[comments.length - 1];

  return {
    // ID needs to be unique. Combining threadKey and first comment's ID should suffice.
    id: `thread-${threadKey}-${firstComment.id}`,
    kind: "comment",
    header: `### THREAD ON ${path}#L${line} (${comments.length} comment${comments.length > 1 ? 's' : ''})`,
    commentBody: comments.map(formatSingleComment).join("\n\n"), // Use double newline as separator
    author: lastComment.author, // Author of the last comment for block metadata
    authorAvatarUrl: lastComment.authorAvatarUrl,
    timestamp: lastComment.timestamp, // Timestamp of the last comment for sorting
    threadId: threadKey, // Store the original thread identifier (e.g., pull_request_review_id)
    diffHunk: hunk,
    filePath: path,
    line: line,
  };
}