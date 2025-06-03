/**
 * Canonical separator between logical Markdown blocks.
 * Keep this **one source of truth** so tests and prod code can import it.
 */
export const SECTION_SEPARATOR = "\n\n";

/**
 * Joins an array of strings with the canonical separator.
 * Empty or whitespace-only items are dropped.
 *
 * @param parts  Ordered list of blocks (expected to be already appropriately trimmed or handled by consuming functions)
 */
export function joinBlocks(parts: string[]): string {
  return parts.filter(part => part && part.trim()).join(SECTION_SEPARATOR);
}