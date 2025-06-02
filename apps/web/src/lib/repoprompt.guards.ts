import type { PromptBlock, DiffBlockInput, CommentBlockInput } from "./repoprompt";

export function isDiffBlock(b: PromptBlock): b is DiffBlockInput {
  return b.kind === "diff";
}

export function isCommentBlock(b: PromptBlock): b is CommentBlockInput {
  return b.kind === "comment";
}