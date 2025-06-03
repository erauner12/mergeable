export function renderTemplate(tpl: string, slots: Record<string, string>): string {
  let out = tpl;

  for (const [key, val] of Object.entries(slots)) {
    // Ensure val is a string; if it's undefined or null, treat as empty string to avoid "undefined" in output.
    const valueToInsert = val ?? "";
    out = out.replaceAll(`{{${key}}}`, valueToInsert.trim());
  }

  // Strip any line that still contains an unreplaced {{TOKEN}} or a token replaced with an empty string that might leave the token itself.
  // This regex handles lines that are entirely a token, or a token surrounded by whitespace.
  // It also handles cases where a token might have been replaced by an empty string,
  // and we want to remove the line if it's now effectively empty or just whitespace.
  out = out.replace(/^\s*({{\w+}})\s*$/gm, ""); // Remove lines that are just a token
  
  // Remove lines that became empty or whitespace-only after token replacement
  out = out.split('\n').filter(line => line.trim().length > 0).join('\n');


  // Final trim to remove leading/trailing whitespace from the whole output.
  return out.trim();
}