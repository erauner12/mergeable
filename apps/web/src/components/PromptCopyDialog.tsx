import {
  Button,
  Checkbox, // New import
  Classes,
  Collapse,
  Dialog,
  DialogBody,
  DialogFooter,
  H5,
  Icon,
  Intent,
  Tooltip,
  ButtonGroup,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React, { useState, useEffect, useMemo } from "react"; // Added useEffect, useMemo
import type { PromptBlock, DiffBlockInput, CommentBlockInput, DiffOptions } from "../lib/repoprompt"; // Updated imports
import { formatPromptBlock } from "../lib/repoprompt"; // Import formatter
import styles from "./PromptCopyDialog.module.scss";

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
  initialPromptText: string; // Full prompt of initially selected items
  blocks: PromptBlock[]; // All available blocks
  initialSelectedBlockIds?: Set<string>; // IDs of blocks initially selected by DiffPickerDialog choices
  onClose: () => void;
  prTitle?: string;
  repoPromptUrl?: string;
  onOpenRepoPrompt?: (selectedText: string) => void; // Passes currently selected text
}

interface CopyState {
  id: string; // 'all' or block index
  copied: boolean;
}

export function PromptCopyDialog({
  isOpen,
  initialPromptText, // Renamed from promptText
  blocks,
  initialSelectedBlockIds,
  onClose,
  prTitle,
  repoPromptUrl,
  onOpenRepoPrompt,
}: PromptCopyDialogProps) {
  const [openCollapsible, setOpenCollapsible] = useState<Record<string, boolean>>({}); // Use block.id as key
  const [copyStatus, setCopyStatus] = useState<CopyState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Initialize selectedIds and openCollapsible when dialog opens or blocks/initial selections change
  useEffect(() => {
    if (isOpen) {
      const initialCollapseState: Record<string, boolean> = {};
      const defaultSelected = new Set<string>();

      blocks.forEach((block) => {
        // Default to collapsed if content is long, otherwise open
        const content = block.kind === "diff" ? block.patch : block.commentBody;
        initialCollapseState[block.id] = content.length < 1000;

        if (initialSelectedBlockIds?.has(block.id)) {
          defaultSelected.add(block.id);
        } else if (block.id.startsWith("pr-details")) { // Always select PR details by default
             defaultSelected.add(block.id);
        }
        // Other comment blocks are not selected by default unless specified by initialSelectedBlockIds
      });
      setOpenCollapsible(initialCollapseState);
      setSelectedIds(initialSelectedBlockIds || defaultSelected);
    }
  }, [isOpen, blocks, initialSelectedBlockIds]);


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
    setOpenCollapsible(prev => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  const toggleSelected = (blockId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(blockId)) {
        newSet.delete(blockId);
      } else {
        newSet.add(blockId);
      }
      return newSet;
    });
  };

  const currentSelectedText = useMemo(() => {
    return blocks
      .filter(block => selectedIds.has(block.id))
      .map(block => formatPromptBlock(block)) // Use the formatter
      .join("\n")
      .trimEnd();
  }, [blocks, selectedIds]);
  
  const renderBlockContent = (block: PromptBlock) => {
    if (block.kind === "diff") {
      return <pre className={`${Classes.CODE_BLOCK} ${styles.codeBlock}`}>{block.patch}</pre>;
    }
    // block.kind === "comment"
    return (
      <div className={styles.commentBlockContent}>
        <div className={styles.commentMeta}>
          {block.authorAvatarUrl && <img src={block.authorAvatarUrl} alt={block.author} className={styles.avatar} />}
          <span><strong>@{block.author}</strong> · {new Date(block.timestamp).toLocaleDateString("en-CA", { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' })}</span>
          {block.filePath && <span className={styles.filePath}> ({block.filePath}{block.line ? `:${block.line}` : ''})</span>}
        </div>
        <pre className={`${Classes.RUNNING_TEXT} ${styles.codeBlock}`}>{block.commentBody}</pre>
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
          {blocks.map((block) => (
            <div key={block.id} className={styles.promptBlock}>
              <div className={styles.blockHeader}>
                <Checkbox
                  checked={selectedIds.has(block.id)}
                  onChange={() => toggleSelected(block.id)}
                  className={styles.blockCheckbox}
                />
                <H5>{block.header}</H5>
                <div className={styles.blockActions}>
                  <Tooltip content={openCollapsible[block.id] ? "Collapse" : "Expand"}>
                    <Button
                      minimal
                      icon={openCollapsible[block.id] ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
                      onClick={() => toggleCollapse(block.id)}
                      small
                    />
                  </Tooltip>
                  <Tooltip content={copyStatus?.id === block.id && copyStatus.copied ? "Copied!" : `Copy section: ${block.header.substring(0,20)}...`}>
                    <Button
                      minimal
                      icon={copyStatus?.id === block.id && copyStatus.copied ? IconNames.SAVED : IconNames.CLIPBOARD}
                      onClick={() => handleCopy(formatPromptBlock(block), block.id)} // Format individual block for copy
                      small
                    />
                  </Tooltip>
                   {! (copyStatus?.id === block.id && !copyStatus.copied) ? null : (
                     <Tooltip content="Failed to copy" intent={Intent.DANGER}>
                        <Icon icon={IconNames.ERROR} intent={Intent.DANGER} style={{ marginLeft: '4px' }} />
                     </Tooltip>
                   )}
                </div>
              </div>
              <Collapse isOpen={openCollapsible[block.id] ?? true}>
                {renderBlockContent(block)}
              </Collapse>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter
        actions={
          <ButtonGroup minimal={false} large={false}>
            <Button
              icon={copyStatus?.id === 'all_selected' && copyStatus.copied ? IconNames.SAVED : IconNames.CLIPBOARD}
              text={copyStatus?.id === 'all_selected' && copyStatus.copied ? "Copied!" : "Copy Selected"}
              onClick={() => handleCopy(currentSelectedText, 'all_selected')}
              disabled={selectedIds.size === 0} // Disable if nothing selected
              rightIcon={
                (copyStatus?.id === 'all_selected' && !copyStatus.copied) ?
                <Tooltip content="Failed to copy" intent={Intent.DANGER} placement="top">
                  <Icon icon={IconNames.ERROR} intent={Intent.DANGER} />
                </Tooltip>
                : undefined
              }
            />
            <Button
              intent={Intent.PRIMARY}
              icon={IconNames.APPLICATION}
              disabled={!repoPromptUrl}
              onClick={() => {
                if (repoPromptUrl) {
                  window.open(repoPromptUrl, '_blank');
                  onOpenRepoPrompt?.(currentSelectedText); // Pass current selected text
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
    </Dialog>
  );
}

export default PromptCopyDialog;