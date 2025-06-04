import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  Intent,
} from "@blueprintjs/core";
import { useMemo } from "react";
import { useDiffSelection } from "../hooks/useDiffSelection";
import type { PatchFileMetadata } from "../lib/github/diffUtils"; // Import the interface

interface FileDiffPickerProps {
  isOpen: boolean;
  files: PatchFileMetadata[]; // Changed from string[]
  defaultChecked?: boolean;
  onConfirm: (selectedFiles: Set<string>) => void;
  onCancel: () => void;
  title?: string;
}

export function FileDiffPicker({
  isOpen,
  files, // files is now PatchFileMetadata[]
  defaultChecked = true,
  onConfirm,
  onCancel,
  title = "Choose files to include",
}: FileDiffPickerProps) {
  const filePaths = useMemo(() => files.map(f => f.path), [files]);
  const [checkedState, toggleFile, setAllFiles] = useDiffSelection(
    filePaths, // Pass only paths to the hook
    defaultChecked,
  );

  // Sort PatchFileMetadata objects by path for display
  const sortedFileMeta = useMemo(() =>
    [...files].sort((a, b) => a.path.localeCompare(b.path)),
    [files]
  );

  const handleConfirm = () => {
    const selected = new Set<string>();
    // checkedState keys are file paths
    for (const filePath in checkedState) {
      if (checkedState[filePath]) {
        selected.add(filePath);
      }
    }
    onConfirm(selected);
  };

  const handleSelectAll = () => setAllFiles(true);
  const handleSelectNone = () => setAllFiles(false);

  const numSelected = useMemo(() => Object.values(checkedState).filter(Boolean).length, [checkedState]);

  if (!isOpen) {
    return null;
  }

  function getFileLabelHint(meta: PatchFileMetadata): string {
    const hints: string[] = [];
    if (meta.isBinary) {
      return " (binary)"; // Added leading space
    }
  
    const linesOverThreshold = meta.lineCount > 400;
    const bytesOverThreshold = meta.byteCount > 100_000;
  
    if (linesOverThreshold) {
      hints.push(`${meta.lineCount} lines`);
    }
    // Add byte hint if it's over threshold, or if lines are not over but bytes are still significant (e.g. > 10KB as a softer hint)
    // For now, strictly stick to "big file" reasons.
    if (bytesOverThreshold) {
      hints.push(`${Math.round(meta.byteCount / 1024)} KB`);
    }
    
    // Only show hint if it's considered "big" by either metric (matching autoOmit logic)
    if (!meta.isBinary && !linesOverThreshold && !bytesOverThreshold) {
        return ""; // Not "big" enough for a hint
    }
  
    return hints.length > 0 ? ` (${hints.join(', ')})` : ""; // Note leading space for the hint
  }


  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title={title} style={{ minWidth: "300px", maxWidth: "600px" }}>
      <DialogBody>
        <FormGroup>
          {/* ... Select all/none buttons ... */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <Button minimal small text="Select all" onClick={handleSelectAll} />
            <Button minimal small text="Select none" onClick={handleSelectNone} />
          </div>
          <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
            {sortedFileMeta.map((fileMeta) => ( // Iterate over sorted PatchFileMetadata objects
              <Checkbox
                key={fileMeta.path}
                label={`${fileMeta.path}${getFileLabelHint(fileMeta)}`} // Display path and hint
                checked={checkedState[fileMeta.path] ?? defaultChecked}
                onChange={() => toggleFile(fileMeta.path)} // Toggle by path
                style={{ marginBottom: "5px" }}
              />
            ))}
          </div>
        </FormGroup>
      </DialogBody>
      {/* ... DialogFooter ... */}
      <DialogFooter
        actions={
          <>
            <Button onClick={onCancel} text="Cancel" />
            <Button
              intent={Intent.PRIMARY}
              onClick={handleConfirm}
              text={`Use ${numSelected} file${numSelected === 1 ? "" : "s"}`}
              disabled={numSelected === 0}
            />
          </>
        }
      />
    </Dialog>
  );
}