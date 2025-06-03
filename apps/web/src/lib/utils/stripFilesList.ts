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
  // - Allows optional whitespace around "### files changed" and digits.
  // - Allows any characters on the header line after the count (e.g., extra titles).
  // - Matches one or more lines starting with '*' or '-' (bullet points), possibly indented.
  // - Non-greedy match for the list items.
  // - Multiline and case-insensitive for "### files changed".
  const filesListRegex =
    /^###\s*files changed\s*\(\d+\)[^\r\n]*[\r\n]+(?:^[\t ]*[-*]\s+.*\s*[\r\n]*)+/gim;
  return text.replace(filesListRegex, "").trim();
}