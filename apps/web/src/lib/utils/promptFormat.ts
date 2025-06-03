/**
 * Canonical separator between logical Markdown blocks.
 * Keep this **one source of truth** so tests and prod code can import it.
 */
export const SECTION_SEPARATOR = "\n\n";

/**
 * Joins an array of strings with the canonical separator.
 *
 * Behavior regarding whitespace:
 * 1. Parts that are empty or consist only of whitespace (e.g., `" "`, `"\\n\\n"`) are entirely dropped.
 *    This effectively collapses such "blank" parts. Note that because `trim()` is used to check for emptiness,
 *    both leading and trailing blank lines *within* such parts contribute to them being considered "blank" and thus removed.
 * 2. For all other (non-blank) parts, trailing whitespace (including newlines) is removed
 *    (akin to `String.prototype.trimEnd()`). Leading whitespace within these parts is preserved.
 *
 * The remaining, processed parts are then joined by `SECTION_SEPARATOR`, ensuring exactly one
 * separator is placed between non-empty content blocks.
 *
 * @param parts  Ordered list of blocks.
 */
export function joinBlocks(parts: string[]): string {
  return parts
    .filter(part => part && part.trim())
    .map(part => part.trimEnd()) // NEW: Strip trailing whitespace/newlines from each part
    .join(SECTION_SEPARATOR);
}