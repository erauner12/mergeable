import {
  Button,
  ButtonGroup,
  Checkbox,
  Classes,
  Collapse,
  Dialog,
  DialogBody,
  DialogFooter,
  H5,
  H6,
  Icon,
  Intent,
  TextArea,
  Tooltip,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  buildClipboardPayload,
  splitUnifiedDiff,
  type PatchFileMetadata,
} from "../lib/github/diffUtils";
import type { PromptBlock } from "../lib/repoprompt";
import { formatPromptBlock } from "../lib/repoprompt";
import { joinBlocks } from "../lib/utils/promptFormat"; // ADDED IMPORT
import { FileDiffPicker } from "./FileDiffPicker";
import styles from "./PromptCopyDialog.module.scss";

// Constants for injection logic
const DIFF_PLACEHOLDER_TEXT =
  "(diff content here, possibly empty if not selected for template)";
const DIFF_TOKEN_TEXT = "{{DIFF_CONTENT}}";

// Helper for copying text to clipboard
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for non-secure contexts or older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed"; // Prevent scrolling to bottom of page in MS Edge.
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error("Failed to copy text: ", err);
    return false;
  }
}

interface PromptCopyDialogProps {
  isOpen: boolean;
  initialPromptText: string;
  blocks: PromptBlock[];
  initialSelectedBlockIds?: Set<string>; // IDs of blocks initially selected by DiffPickerDialog choices
  onClose: () => void;
  prTitle?: string;
  repoPromptUrl?: string;
  onOpenRepoPrompt?: (fullPrompt: string) => void;
}

interface CopyState {
  id: string; // 'all' or block index
  copied: boolean;
}

export function PromptCopyDialog({
  isOpen,
  initialPromptText,
  blocks,
  initialSelectedBlockIds,
  onClose,
  prTitle,
  repoPromptUrl,
  onOpenRepoPrompt,
}: PromptCopyDialogProps) {
  const [openCollapsible, setOpenCollapsible] = useState<
    Record<string, boolean>
  >(() => {
    const initialOpenState: Record<string, boolean> = {};
    blocks.forEach((block) => {
      if (block.kind === "comment" && block.threadId) {
        // This is a comment thread block
        const isResolved = block.resolved === true;
        initialOpenState[block.id] = !isResolved; // Default: open if unresolved, collapse if resolved
      } else {
        // Non-thread blocks (PR details, general comments, diffs)
        initialOpenState[block.id] = true; // Default: open (expanded)
      }
    });
    return initialOpenState;
  }); // Use block.id as key
  const [copyStatus, setCopyStatus] = useState<CopyState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // 1. Honour an explicit preload
    if (initialSelectedBlockIds !== undefined) {
      return new Set(initialSelectedBlockIds);
    }

    // 2. Otherwise compute defaults synchronously
    const defaults = new Set<string>();
    blocks.forEach((block) => {
      if (
        block.kind === "comment" &&
        block.threadId &&
        block.resolved === true // resolved threads start un-selected
      ) {
        return; // Do not add to defaults
      }
      defaults.add(block.id); // everything else is selected
    });
    return defaults;
  });
  const [userText, setUserText] = useState<string>(""); // ADDED userText state

  // State for FileDiffPicker and its data
  const [isFileDiffPickerOpen, setFileDiffPickerOpen] = useState(false);
  const [diffPatchData, setDiffPatchData] = useState<{
    patches: Record<string, PatchFileMetadata>;
    allFilePaths: string[];
    sourceBlockId: string; // ID of the PromptBlock this diff data comes from
  } | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(
    new Set(),
  );

  // Initialize selectedIds and openCollapsible when dialog opens or blocks/initial selections change
  useEffect(() => {
    if (isOpen) {
      // The lazy initializers for useState now handle the *initial* setup.
      // This effect will primarily handle re-initialization if props change *after* initial mount,
      // or when the dialog re-opens.

      const finalSelectedIds = new Set<string>();
      const finalOpenCollapsible: Record<string, boolean> = {};

      blocks.forEach((block) => {
        if (block.kind === "comment" && block.threadId) {
          // This is a comment thread block
          const isResolved = block.resolved === true;
          if (!isResolved) {
            // Default: select if unresolved
            finalSelectedIds.add(block.id);
          }
          finalOpenCollapsible[block.id] = !isResolved; // Default: open if unresolved, collapse if resolved
        } else {
          // Non-thread blocks (PR details, general comments, diffs)
          finalSelectedIds.add(block.id); // Default: select
          finalOpenCollapsible[block.id] = true; // Default: open (expanded)
        }
      });

      // If initialSelectedBlockIds is provided, it dictates selection.
      // The lazy initializer for selectedIds already handles this for the *first* render.
      // This ensures that if initialSelectedBlockIds changes while the dialog is open,
      // the selection is updated.
      if (initialSelectedBlockIds !== undefined) {
        setSelectedIds(new Set(initialSelectedBlockIds));
      } else {
        // If initialSelectedBlockIds is not provided (or becomes undefined),
        // re-apply the default logic. The lazy initializer handles the first render.
        setSelectedIds(finalSelectedIds);
      }
      // Similarly, setOpenCollapsible will re-apply defaults if blocks change.
      // The lazy initializer for openCollapsible handles the first render.
      setOpenCollapsible(finalOpenCollapsible);
    } else {
      // if !isOpen
      setUserText(""); // Existing logic to reset userText
      // Reset diff-related state when dialog closes
      setDiffPatchData(null);
      setSelectedFilePaths(new Set());
      setFileDiffPickerOpen(false);
    }
  }, [isOpen, blocks, initialSelectedBlockIds]);

  // ADDED: Effect to parse diff when dialog opens or blocks change
  useEffect(() => {
    if (isOpen) {
      const diffBlock = blocks.find((b) => b.kind === "diff");
      if (diffBlock) {
        const parsedPatches = splitUnifiedDiff(diffBlock.patch);
        const allPaths = Object.keys(parsedPatches);
        // Ensure selectedFilePaths is set before diffPatchData to avoid race conditions in effects/memos
        setSelectedFilePaths(new Set(allPaths)); // Default to all files selected
        setDiffPatchData({
          patches: parsedPatches,
          allFilePaths: allPaths,
          sourceBlockId: diffBlock.id,
        });
      } else {
        // Ensure reset if no diff block is found while open
        setDiffPatchData(null);
        setSelectedFilePaths(new Set());
      }
    }
    // No else here, covered by the other useEffect for !isOpen which handles full reset
  }, [isOpen, blocks]);
  // END ADDED Effect

  // Reset userText when dialog is closed/reopened
  useEffect(() => {
    if (!isOpen) {
      setUserText("");
    }
  }, [isOpen]);

  const handleCopy = async (textToCopy: string, id: string) => {
    const success = await copyTextToClipboard(textToCopy);
    if (success) {
      setCopyStatus({ id, copied: true });
      setTimeout(() => setCopyStatus(null), 2000); // Reset after 2s
    } else {
      setCopyStatus({ id, copied: false });
      // Optionally show a more persistent error to the user
    }
  };

  const toggleCollapse = (blockId: string) => {
    setOpenCollapsible((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  const toggleSelected = (blockId: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(blockId)) {
        newSet.delete(blockId);
      } else {
        newSet.add(blockId);
      }
      return newSet;
    });
  };

  // ADD NEW useMemo hooks here
  const selectedDiffBlock = useMemo(() => {
    return blocks.find((b) => b.kind === "diff" && selectedIds.has(b.id));
  }, [blocks, selectedIds]);

  const selectedNonDiffText = useMemo(() => {
    return joinBlocks(
      blocks
        .filter((b) => selectedIds.has(b.id) && b.id !== selectedDiffBlock?.id)
        .map(formatPromptBlock),
    );
  }, [blocks, selectedIds, selectedDiffBlock]);

  // Refactored: Use new prompt assembly logic
  const getFinalPrompt = useCallback((): string => {
    const template = initialPromptText.trim();
    const extra = userText.trim();

    let diffSel = "";
    if (
      selectedDiffBlock &&
      diffPatchData &&
      diffPatchData.sourceBlockId === selectedDiffBlock.id
    ) {
      diffSel = buildClipboardPayload({
        selectedFiles: selectedFilePaths,
        allFiles: diffPatchData.allFilePaths,
        patches: diffPatchData.patches,
      }).trimEnd();
    }

    const commentSel = selectedNonDiffText?.trimEnd(); // may be '' or undefined

    const parts: (string | undefined)[] = [];

    if (template) {
      let renderedText = template;
      const placeholderHit = renderedText.includes(DIFF_PLACEHOLDER_TEXT);
      const tokenHit = renderedText.includes(DIFF_TOKEN_TEXT);

      if (placeholderHit || tokenHit) {
        // Replace with diff (possibly empty string if diffSel is empty/undefined)
        const diffToInject = diffSel ?? "";
        if (placeholderHit) {
          renderedText = renderedText.replace(
            DIFF_PLACEHOLDER_TEXT,
            diffToInject,
          );
        }
        // If tokenHit, ensure it's also replaced. If placeholder was already hit, operate on the modified string.
        if (tokenHit) {
          renderedText = renderedText.replace(DIFF_TOKEN_TEXT, diffToInject);
        }
      }
      parts.push(renderedText);
      parts.push(commentSel); // Comments always appended after template
      parts.push(extra);
    } else {
      // No template: diff -> comments -> user text
      parts.push(diffSel);
      parts.push(commentSel);
      parts.push(extra);
    }

    return joinBlocks(parts.filter(Boolean) as string[]).trimEnd();
  }, [
    initialPromptText,
    userText,
    selectedDiffBlock,
    diffPatchData,
    selectedNonDiffText,
    selectedFilePaths,
  ]);

  const nothingToSend =
    selectedIds.size === 0 &&
    userText.trim() === "" &&
    initialPromptText.trim() === "";

  // DEBUG ––– remove after investigation –––––––––––––––––
  useEffect(() => {
    // Fire every time the user toggles any checkbox or updates the picker.
    // It will *not* spam because the dependencies are tight.
    console.groupCollapsed(
      "%c[PromptCopyDialog DEBUG] build context",
      "color:tomato;font-weight:bold;",
    );

    console.log("initialPromptText (trimmed)", initialPromptText.trim());

    console.log(
      "blocks (id, kind, header):",
      blocks.map(({ id, kind, header }) => ({ id, kind, header })),
    );

    console.log("selectedIds →", Array.from(selectedIds));

    console.log("selectedDiffBlock →", selectedDiffBlock?.id ?? null);

    console.log("selectedNonDiffText →", selectedNonDiffText);

    // Calculate diffPayload inline for debugging
    let diffPayloadForDebug = "";
    if (
      selectedDiffBlock &&
      diffPatchData &&
      diffPatchData.sourceBlockId === selectedDiffBlock.id
    ) {
      diffPayloadForDebug = buildClipboardPayload({
        selectedFiles: selectedFilePaths,
        allFiles: diffPatchData.allFilePaths,
        patches: diffPatchData.patches,
      }).trimEnd();
    }
    console.log(
      "diffPayload (first 250 chars) →",
      diffPayloadForDebug.slice(0, 250),
    );

    // What will actually be copied if the user presses "Copy Selected"
    console.log(
      "getFinalPrompt() (first 250 chars) →",
      getFinalPrompt().slice(0, 250),
    );

    console.groupEnd();
  }, [
    initialPromptText,
    blocks,
    selectedIds,
    selectedDiffBlock,
    selectedNonDiffText,
    diffPatchData, // Changed from diffPayload to diffPatchData since that's what affects the diff content
    userText, // Add userText to dependencies since it affects getFinalPrompt
    getFinalPrompt, // Add getFinalPrompt to fix ESLint warning
    selectedFilePaths,
  ]);
  // DEBUG –––––––––––––––––––––––––––––––––––––––––––––––––––

  const renderBlockContent = (block: PromptBlock) => {
    if (block.kind === "diff") {
      // Check if this is the active diff block being managed by diffPatchData
      const isActiveManagedDiffBlock =
        diffPatchData && block.id === diffPatchData.sourceBlockId;

      if (isActiveManagedDiffBlock && selectedIds.has(block.id)) {
        // Always show the current selection in selectedFilePaths
        const currentDiffSelectionContent = buildClipboardPayload({
          selectedFiles: selectedFilePaths,
          allFiles: diffPatchData.allFilePaths,
          patches: diffPatchData.patches,
        });
        const displayContent = currentDiffSelectionContent.trimEnd();
        return (
          <pre className={`${Classes.CODE_BLOCK} ${styles.codeBlock}`}>
            {displayContent.length > 0
              ? displayContent
              : "(No files selected or diff is empty)"}
          </pre>
        );
      }
      // For other diff blocks (if any) or if the main diff block isn't selected for detailed view, show its original patch
      return (
        <pre className={`${Classes.CODE_BLOCK} ${styles.codeBlock}`}>
          {block.patch.trimEnd()}
        </pre>
      );
    }

    // block.kind === "comment"
    return (
      <div className={styles.commentBlockContent}>
        <div className={styles.commentMeta}>
          {block.authorAvatarUrl && (
            <img
              src={block.authorAvatarUrl}
              alt={block.author}
              className={styles.avatar}
            />
          )}
          <span>
            <strong>@{block.author}</strong> ·{" "}
            {new Date(block.timestamp).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
            })}
          </span>
          {block.filePath && (
            <span className={styles.filePath}>
              {" "}
              ({block.filePath}
              {block.line ? `:${block.line}` : ""})
            </span>
          )}
        </div>
        <pre className={`${Classes.RUNNING_TEXT} ${styles.codeBlock}`}>
          {block.commentBody}
        </pre>
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={prTitle ? `Prompt for "${prTitle}"` : "Copy Prompt"}
      icon={IconNames.CLIPBOARD}
      canOutsideClickClose={true}
      canEscapeKeyClose={true}
      className={styles.promptDialog}
    >
      <DialogBody>
        <div className={styles.scrollableContent}>
          {blocks.map((block) => {
            const isResolvedThread =
              block.kind === "comment" &&
              block.threadId &&
              block.resolved === true;

            const isActiveDiffBlock =
              block.kind === "diff" &&
              diffPatchData &&
              block.id === diffPatchData.sourceBlockId;

            let checkboxElement = (
              <Checkbox
                checked={selectedIds.has(block.id)}
                onChange={() => toggleSelected(block.id)}
                className={styles.blockCheckbox}
              />
            );

            if (isResolvedThread) {
              checkboxElement = (
                <Tooltip content="Thread is resolved" placement="top" minimal>
                  {checkboxElement}
                </Tooltip>
              );
            }

            // Helper function to format file selection status
            const formatFileSelectionLabel = (
              selectedCount: number,
              totalCount: number,
            ): string => {
              if (totalCount === 0) return "(No files in diff)";
              if (selectedCount === totalCount)
                return `(All ${totalCount} files)`;
              return `(${selectedCount} of ${totalCount} files)`;
            };

            return (
              <div key={block.id} className={styles.promptBlock}>
                <div
                  className={`${styles.blockHeader} ${isResolvedThread ? styles.resolvedHeader : ""}`}
                >
                  {checkboxElement}
                  <H5>{block.header}</H5>
                  {/* ADDED: Diff file selection controls for the active diff block */}
                  {isActiveDiffBlock && (
                    <div className={styles.diffControls}>
                      <span className={styles.diffSelectionLabel}>
                        {formatFileSelectionLabel(
                          selectedFilePaths.size,
                          diffPatchData.allFilePaths.length,
                        )}
                      </span>
                      <Button
                        minimal
                        icon={IconNames.EDIT}
                        text="Choose files…"
                        small
                        onClick={() => setFileDiffPickerOpen(true)}
                        style={{ marginLeft: "8px" }}
                        data-testid={`choose-files-${block.id}`} // Added for easier testing
                      />
                    </div>
                  )}
                  <div className={styles.blockActions}>
                    <Tooltip
                      content={
                        openCollapsible[block.id] ? "Collapse" : "Expand"
                      }
                    >
                      <Button
                        minimal
                        icon={
                          openCollapsible[block.id]
                            ? IconNames.CHEVRON_UP
                            : IconNames.CHEVRON_DOWN
                        }
                        onClick={() => toggleCollapse(block.id)}
                        small
                      />
                    </Tooltip>
                    <Tooltip
                      content={
                        copyStatus?.id === block.id && copyStatus.copied
                          ? "Copied!"
                          : `Copy section: ${block.header.substring(0, 20)}...`
                      }
                    >
                      <Button
                        minimal
                        icon={
                          copyStatus?.id === block.id && copyStatus.copied
                            ? IconNames.SAVED
                            : IconNames.CLIPBOARD
                        }
                        onClick={() => {
                          if (isActiveDiffBlock) {
                            const diffContentForBlock = buildClipboardPayload({
                              selectedFiles: selectedFilePaths,
                              allFiles: diffPatchData.allFilePaths,
                              patches: diffPatchData.patches,
                            });
                            const fullContentForBlock = `${block.header}\n${diffContentForBlock}`;
                            void handleCopy(fullContentForBlock, block.id);
                          } else {
                            void handleCopy(formatPromptBlock(block), block.id);
                          }
                        }}
                        small
                      />
                    </Tooltip>
                    {!(
                      copyStatus?.id === block.id && !copyStatus.copied
                    ) ? null : (
                      <Tooltip content="Failed to copy" intent={Intent.DANGER}>
                        <Icon
                          icon={IconNames.ERROR}
                          intent={Intent.DANGER}
                          style={{ marginLeft: "4px" }}
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
                <Collapse isOpen={openCollapsible[block.id] ?? true}>
                  {renderBlockContent(block)}
                </Collapse>
              </div>
            );
          })}
        </div>
        {/* ADDED Composer TextArea */}
        <H6 className={styles.composerLabel} id="prompt-composer-label">
          Your instructions (optional)
        </H6>
        <TextArea
          className={styles.composerInput}
          fill
          rows={4}
          value={userText}
          onChange={(e) => {
            const v = e.target.value;
            setUserText(v);
          }}
          id="prompt-composer-input"
          aria-labelledby="prompt-composer-label"
        />
      </DialogBody>
      <DialogFooter
        actions={
          <ButtonGroup minimal={false} large={false}>
            <Button
              icon={
                copyStatus?.id === "all_selected" && copyStatus.copied
                  ? IconNames.SAVED
                  : IconNames.CLIPBOARD
              }
              text={
                copyStatus?.id === "all_selected" && copyStatus.copied
                  ? "Copied!"
                  : "Copy Selected"
              }
              onClick={() => {
                /* Make sure the very latest userText is in state
                   before we build the final prompt. */
                flushSync(() => {}); // flush pending updates
                void handleCopy(getFinalPrompt(), "all_selected");
              }}
              disabled={nothingToSend}
              rightIcon={
                copyStatus?.id === "all_selected" && !copyStatus.copied ? (
                  <Tooltip
                    content="Failed to copy"
                    intent={Intent.DANGER}
                    placement="top"
                  >
                    <Icon icon={IconNames.ERROR} intent={Intent.DANGER} />
                  </Tooltip>
                ) : undefined
              }
            />
            <Button
              intent={Intent.PRIMARY}
              icon={IconNames.APPLICATION}
              disabled={!repoPromptUrl || nothingToSend}
              onClick={() => {
                if (repoPromptUrl) {
                  window.open(repoPromptUrl, "_blank");
                  onOpenRepoPrompt?.(getFinalPrompt());
                }
              }}
              text="Open in RepoPrompt"
            />
            <Button onClick={onClose} intent={Intent.NONE}>
              Close
            </Button>
          </ButtonGroup>
        }
      />
      {/* ADDED FileDiffPicker, ensure it's only rendered if diffPatchData is available */}
      {isOpen && diffPatchData && (
        <FileDiffPicker
          isOpen={isFileDiffPickerOpen}
          files={Object.values(diffPatchData.patches)}
          defaultChecked={true}
          onConfirm={(newSelectedPaths) => {
            setSelectedFilePaths(newSelectedPaths);
            setFileDiffPickerOpen(false);
          }}
          onCancel={() => setFileDiffPickerOpen(false)}
          title={`Choose files for: ${prTitle || diffPatchData.sourceBlockId}`}
        />
      )}
    </Dialog>
  );
}

export default PromptCopyDialog;
