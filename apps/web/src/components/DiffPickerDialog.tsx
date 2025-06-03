import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  Intent,
  Radio,
  RadioGroup,
} from "@blueprintjs/core"; // Added RadioGroup, Radio
import { useEffect, useState } from "react";
import type { DiffOptions, PromptMode } from "../lib/repoprompt"; // Added PromptMode
import { defaultPromptMode } from "../lib/repoprompt"; // Added defaultPromptMode

// New result type
export interface DiffPickerResult {
  diffOpts: DiffOptions;
  mode: PromptMode;
}

export interface DiffPickerDialogProps {
  isOpen: boolean;
  initial?: DiffOptions;
  onConfirm: (result: DiffPickerResult) => void; // Updated signature
  onCancel: () => void;
  prTitle?: string; // For dialog title
}

// Available prompt modes and their labels
const promptModeOptions = [
  { label: "Implement Changes", value: "implement" as PromptMode },
  { label: "Review Code", value: "review" as PromptMode },
  { label: "Adjust PR Description", value: "adjust-pr" as PromptMode },
  { label: "Respond to Comments", value: "respond" as PromptMode },
];

export function DiffPickerDialog({
  isOpen,
  initial,
  onConfirm,
  onCancel,
  prTitle,
}: DiffPickerDialogProps) {
  const [includePr, setIncludePr] = useState(true);
  const [includeLastCommit, setIncludeLastCommit] = useState(true);
  const [includeComments, setIncludeComments] = useState(false);
  const [selectedMode, setSelectedMode] = useState<PromptMode>(() => {
    const lastMode = localStorage.getItem("picker:lastMode");
    return (lastMode as PromptMode) ?? defaultPromptMode;
  });

  useEffect(() => {
    if (isOpen) {
      setIncludePr(initial?.includePr ?? true);
      setIncludeLastCommit(initial?.includeLastCommit ?? true);
      setIncludeComments(initial?.includeComments ?? false);
      // Persist mode choice
      localStorage.setItem("picker:lastMode", selectedMode);
    }
  }, [isOpen, initial, selectedMode]);

  const handleConfirm = () => {
    const diffOpts: DiffOptions = {
      includePr,
      includeLastCommit,
      includeComments,
      commits: [], // Always pass an empty array for commits
    };
    onConfirm({ diffOpts, mode: selectedMode });
  };

  const canConfirm = includePr || includeLastCommit || includeComments;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={prTitle ? `Diff options for "${prTitle}"` : "Select Diff Options"}
      canOutsideClickClose={true}
      canEscapeKeyClose={true}
    >
      <DialogBody>
        <p>Choose which diffs and comments to include in the prompt:</p>
        <RadioGroup
          label="Select Mode:"
          selectedValue={selectedMode}
          onChange={(e) => setSelectedMode(e.currentTarget.value as PromptMode)}
          inline={true}
          style={{ marginBottom: "15px" }}
        >
          {promptModeOptions.map((opt) => (
            <Radio key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </RadioGroup>
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
          style={{ marginBottom: "10px" }} // Added margin
        />
        <Checkbox // New checkbox for comments
          label="Review comments & discussions"
          checked={includeComments}
          onChange={(e) =>
            setIncludeComments((e.target as HTMLInputElement).checked)
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
