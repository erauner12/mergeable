/**
 * Removes a markdown section starting with "### files changed (N)"
 * and continuing until the next blank line or end of string.
 * This is used to prevent duplication if the PR body itself contains
 * such a list, as the `{{FILES_LIST}}` slot will provide the canonical one.
 *
 * @param text The text to process (e.g., a PR body).
 * @returns The text with the "files changed" section removed, if found.
 */
export function stripFilesListSection(text: string): string {
  if (!text) {
    return "";
  }
  // Regex to find "### files changed (digits)" and capture everything
  // until a double newline (blank line) or end of string.
  // It handles optional leading/trailing whitespace on the header line.
  // It's multiline and non-greedy for the content.
  const filesListRegex = /^\s*### files changed\s*\(\d+\)\s*$[\r\n]+([\s\S]*?)(?=(\r?\n\s*){2,}|$)/gm;
  return text.replace(filesListRegex, "").trim();
}
