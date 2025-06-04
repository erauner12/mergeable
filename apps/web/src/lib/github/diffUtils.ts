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
  
  const patchContents: string[] = [];

  // Sort allFiles to ensure a consistent order of patches if multiple are selected
  const sortedAllFiles = [...allFiles].sort();

  // getOmissionReason function is removed as it's no longer used for a header

  for (const filePath of sortedAllFiles) {
    const hasFilePath = selectedFiles.has(filePath);
    const hasPatch = patches[filePath];

    if (hasFilePath && hasPatch) {
      // Ensure individual patches are trimmed before joining
      patchContents.push(patches[filePath].patch.trim());
    }
  }

  // Join trimmed patches with a single newline.
  // If patchContents is empty, returns "".
  // If one patch, returns it.
  // If multiple, joins them with a newline separator.
  return patchContents.join("\n");
}
