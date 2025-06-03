// Helper to normalise whitespace for snapshot testing or string comparisons.
// It trims leading/trailing whitespace, replaces multiple spaces/tabs with a single space,
// and normalises newline characters and consecutive blank lines.
export function normaliseWS(str: string): string {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/\r\n/g, "\n")       // Normalise CRLF to LF
    .replace(/\n{3,}/g, "\n\n")   // Collapse 3 or more newlines to 2 (a single blank line)
    .replace(/[ \t]+/g, " ")      // Replace multiple spaces/tabs with a single space
    .trim();                      // Trim leading/trailing whitespace
}

// Other testing utilities can be added here.