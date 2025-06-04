export function renderTemplate(tpl: string, slots: Record<string, string>): string {
  let out = tpl;

  for (const [key, val] of Object.entries(slots)) {
    // Ensure val is a string; if it's undefined or null, treat as empty string to avoid "undefined" in output.
    const valueToInsert = val ?? "";
    out = out.replaceAll(`{{${key}}}`, valueToInsert.trim());
  }

  // If FILES_LIST was empty, remove its conditional comment marker line
  // THIS LOGIC IS REMOVED as FILES_LIST is always populated and marker is removed from templates.
  // if (opts?.removeMarker?.includes('FILES_LIST') && filesListSlotIsEmpty) {
  //   out = out.split('\n').map(line => {
  //     if (line.trim() === "<!-- FILE_LIST_ONLY_IF_PRESENT -->") {
  //       return ""; // Mark for removal, will be filtered out later
  //     }
  //     return line;
  //   }).join('\n');
  // }

  // Strip any line that still contains an unreplaced {{TOKEN}} or a token replaced with an empty string that might leave the token itself.
  // This regex handles lines that are entirely a token, or a token surrounded by whitespace.
  // It also handles cases where a token might have been replaced by an empty string,
  // and we want to remove the line if it's now effectively empty or just whitespace.
  out = out.replace(/^\s*{{\s*\w+\s*}}\s*$/gm, ""); // Tightened regex
  
  // Remove lines that became empty or whitespace-only after token replacement
  // Also removes lines that were marked for removal by the (now removed) marker logic.
  out = out.split('\n').filter(line => line.trim().length > 0 || line === "").join('\n'); // Keep intentionally blank lines from template if any, filter truly empty/whitespace only from replacements

  // Normalize consecutive blank lines to a maximum of two
  out = out.replace(/\n{3,}/g, '\n\n');

  // Final trim to remove leading/trailing whitespace from the whole output.
  return out.trim();
}
