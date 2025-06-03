export interface PatchFileMetadata {
  /** Path in the repo (full "b/" side of `diff --git`) */
  path: string;
  patch: string;
  lineCount: number; // Sum of added and deleted lines
  byteCount: number; // Total bytes of the patch string
  isBinary: boolean;
}

export function splitUnifiedDiff(unifiedDiff: string): Record<string, PatchFileMetadata> {
  const map: Record<string, PatchFileMetadata> = {};
  if (!unifiedDiff?.trim()) {
    return map;
  }

  const diffLines = unifiedDiff.split('\n');
  let currentPatchLines: string[] = [];
  let currentFilePath: string | null = null;

  const processCurrentPatch = () => {
    if (currentFilePath && currentPatchLines.length > 0) {
      const patchString = currentPatchLines.join('\n');
      const byteCount = new TextEncoder().encode(patchString).length;
      let isBinary = false;
      let lineCount = 0;

      if (currentPatchLines.some(l => /^Binary files .* and .* differ$/.test(l))) {
        isBinary = true;
        // lineCount remains 0 for binary files as per common understanding,
        // or could be set to 1 if the "Binary files..." line is considered.
        // For autoOmit logic, specific line count for binary is not critical.
      } else {
        for (const patchLine of currentPatchLines) {
          if ((patchLine.startsWith('+') && !patchLine.startsWith('+++')) ||
              (patchLine.startsWith('-') && !patchLine.startsWith('---'))) {
            lineCount++;
          }
        }
      }

      map[currentFilePath] = {
        path: currentFilePath, // Populate the path property
        patch: patchString,
        lineCount,
        byteCount,
        isBinary,
      };
    }
  };

  for (const line of diffLines) {
    const match = line.match(/^diff --git a\/(?:.*?) b\/(.+)$/);
    if (match) {
      processCurrentPatch(); // Process the completed patch for the previous file

      currentFilePath = match[1].trim(); // The b-path
      currentPatchLines = [line]; // Start new patch with the "diff --git" line
    } else if (currentFilePath) {
      currentPatchLines.push(line);
    }
  }

  processCurrentPatch(); // Process the last patch after the loop

  return map;
}

export function buildClipboardPayload(opts: {
  selectedFiles: Set<string>;
  allFiles: string[];
  patches: Record<string, PatchFileMetadata>;
}): string {
  const { selectedFiles, allFiles, patches } = opts;
  const headerLines: string[] = [];

  const sortedAllFiles = [...allFiles].sort();

  headerLines.push(`### files changed (${sortedAllFiles.length})`);

  function getOmissionReason(meta: PatchFileMetadata | undefined): string | null {
    if (!meta) return null;
    if (meta.isBinary) return "binary file";
    if (meta.lineCount > 400) return `${meta.lineCount} lines`;
    // Show KB if byteCount is large, converting bytes to KB
    if (meta.byteCount > 100_000) return `${Math.round(meta.byteCount / 1024)} KB`;
    return null;
  }

  for (const filePath of sortedAllFiles) {
    const meta = patches[filePath];
    if (selectedFiles.has(filePath)) {
      headerLines.push(`- ${filePath}`);
    } else {
      const reason = getOmissionReason(meta);
      if (reason) {
        headerLines.push(`- ${filePath} _(${reason} – diff omitted)_`);
      } else {
        headerLines.push(`- ${filePath} _(diff omitted)_`);
      }
    }
  }

  const patchContents: string[] = [];
  for (const filePath of sortedAllFiles) {
    if (selectedFiles.has(filePath) && patches[filePath]) {
      patchContents.push(patches[filePath].patch.trim());
    }
  }

  return `${headerLines.join('\n')}\n\n${patchContents.join('\n')}`.trim();
}