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

  // when "Full PR diff" becomes true, force last-commit to false, and vice-versa
  useEffect(() => {
    if (includePr) {
      // If initial?.includePr was false and initial?.includeLastCommit was true,
      // this could override the initial state if not handled carefully in the main useEffect.
      // However, the primary goal is mutual exclusivity post-initialization.
      // The main useEffect below handles initial state from `initial` prop.
      // This effect ensures that if includePr is programmatically or user-set to true, includeLastCommit becomes false.
      setIncludeLastCommit(false);
    }
  }, [includePr]);

  useEffect(() => {
    if (includeLastCommit) {
      // If includeLastCommit is programmatically or user-set to true, includePr becomes false.
      setIncludePr(false);
    }
  }, [includeLastCommit]);

  useEffect(() => {
    if (isOpen) {
      // Initialize based on `initial` prop, respecting that one might be forced false by the above effects.
      // If initial.includePr is true, the first effect will set includeLastCommit to false.
      // If initial.includePr is false and initial.includeLastCommit is true, the second effect will set includePr to false.
      // If both initial.includePr and initial.includeLastCommit are true, includePr will likely win due to order,
      // setting includeLastCommit to false.
      // Default to includePr = true, which implies includeLastCommit = false after effects.
      const initialIncludePr = initial?.includePr ?? true;
      const initialIncludeLastCommit =
        initial?.includeLastCommit ?? (initialIncludePr ? false : true);

      setIncludePr(initialIncludePr);
      // This might trigger the effects again, which should stabilize.
      // If initialIncludePr is true, includeLastCommit will be set to false by the effect.
      // If initialIncludePr is false, then initialIncludeLastCommit can be true.
      setIncludeLastCommit(initialIncludePr ? false : initialIncludeLastCommit);

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

  const canConfirm =
    selectedMode === "adjust-pr"
      ? true
      : includePr || includeLastCommit || includeComments;

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
          onChange={(e) => setIncludePr(e.currentTarget.checked)}
          style={{ marginBottom: "10px" }}
        />
        <Checkbox
          label="Last commit only"
          checked={includeLastCommit}
          disabled={includePr} // Disable if "Full PR diff" is checked
          onChange={(e) => setIncludeLastCommit(e.currentTarget.checked)}
          style={{ marginBottom: "10px" }} // Added margin
        />
        <Checkbox // New checkbox for comments
          label="Review comments & discussions"
          checked={includeComments}
          onChange={(e) => setIncludeComments(e.currentTarget.checked)}
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