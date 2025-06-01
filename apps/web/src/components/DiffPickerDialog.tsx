import { Button, Checkbox, Dialog, DialogBody, DialogFooter, Intent } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import type { DiffOptions } from "../lib/repoprompt";

export interface DiffPickerDialogProps {
  isOpen: boolean;
  initial?: DiffOptions;
  onConfirm: (opts: DiffOptions) => void;
  onCancel: () => void;
  prTitle?: string; // For dialog title
}

export function DiffPickerDialog({
  isOpen,
  initial,
  onConfirm,
  onCancel,
  prTitle,
}: DiffPickerDialogProps) {
  const [includePr, setIncludePr] = useState(true);
  const [includeLastCommit, setIncludeLastCommit] = useState(true);

  useEffect(() => {
    if (isOpen) {
      // Reset state based on initial prop when dialog opens or initial prop changes
      // If initial.commits was present, it's ignored for these checkboxes.
      setIncludePr(initial?.includePr ?? true);
      setIncludeLastCommit(initial?.includeLastCommit ?? true);
    }
  }, [isOpen, initial]);

  const handleConfirm = () => {
    onConfirm({
      includePr,
      includeLastCommit,
      commits: [], // Always pass an empty array for commits
    });
  };

  const canConfirm = includePr || includeLastCommit;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={prTitle ? `Diff options for "${prTitle}"` : "Select Diff Options"}
      canOutsideClickClose={true}
      canEscapeKeyClose={true}
    >
      <DialogBody>
        <p>Choose which diffs to include in the prompt:</p>
        <Checkbox
          label="Full PR diff"
          checked={includePr}
          onChange={(e) => setIncludePr((e.target as HTMLInputElement).checked)}
          style={{ marginBottom: "10px" }}
        />
        <Checkbox
          label="Last commit only"
          checked={includeLastCommit}
          onChange={(e) =>
            setIncludeLastCommit((e.target as HTMLInputElement).checked)
          }
        />
        {/* Removed \"Or, choose specific commits\" section and loading placeholder */}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onCancel}>Cancel</Button>
            <Button
              intent={Intent.PRIMARY}
              onClick={handleConfirm}
              disabled={!canConfirm} // Disable if no option is selected
            >
              Open
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

export default DiffPickerDialog;
