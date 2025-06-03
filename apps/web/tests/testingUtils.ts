/**
 * Normalizes whitespace in a string:
 * - Replaces all occurrences of one or more whitespace characters (space, tab, newline, etc.) with a single space.
 * - Trims leading and trailing whitespace.
 * @param str The string to normalize.
 * @returns The normalized string.
 */
export function normaliseWS(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}