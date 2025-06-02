import {
  Button,
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
import React, { useState } from "react";
import type { DiffBlockInput } from "../lib/repoprompt";
import styles from "./PromptCopyDialog.module.scss"; // Create this SCSS file too

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
  promptText: string; // Full prompt for "Copy all"
  blocks: DiffBlockInput[]; // Individual blocks for section-wise copy
  onClose: () => void;
  prTitle?: string;
  repoPromptUrl?: string; // destination to open
  onOpenRepoPrompt?: () => void; // optional callback (logging, side-effects)
}

interface CopyState {
  id: string; // 'all' or block index
  copied: boolean;
}

export function PromptCopyDialog({
  isOpen,
  promptText,
  blocks,
  onClose,
  prTitle,
  repoPromptUrl,
  onOpenRepoPrompt,
}: PromptCopyDialogProps) {
  const [openCollapsible, setOpenCollapsible] = useState<Record<number, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<CopyState | null>(null);

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

  const toggleCollapse = (index: number) => {
    setOpenCollapsible(prev => ({ ...prev, [index]: !prev[index] }));
  };
  
  // Reset collapsible state when dialog opens/closes or blocks change
  React.useEffect(() => {
    if (isOpen) {
      const initialCollapseState: Record<number, boolean> = {};
      blocks.forEach((_, index) => {
        // Default to collapsed if patch is long, otherwise open
        initialCollapseState[index] = blocks[index].patch.length < 1000;
      });
      setOpenCollapsible(initialCollapseState);
    }
  }, [isOpen, blocks]);


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
          {blocks.map((block, index) => (
            <div key={index} className={styles.promptBlock}>
              <div className={styles.blockHeader}>
                <H5>{block.header}</H5>
                <div>
                  <Tooltip content={openCollapsible[index] ? "Collapse" : "Expand"}>
                    <Button
                      minimal
                      icon={openCollapsible[index] ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
                      onClick={() => toggleCollapse(index)}
                      small
                    />
                  </Tooltip>
                  <Tooltip content={copyStatus?.id === `block-${index}` && copyStatus.copied ? "Copied!" : "Copy section"}>
                    <Button
                      minimal
                      icon={copyStatus?.id === `block-${index}` && copyStatus.copied ? IconNames.SAVED : IconNames.CLIPBOARD}
                      onClick={() => handleCopy(`${block.header}\n${block.patch}`, `block-${index}`)}
                      small
                    />
                  </Tooltip>
                   {! (copyStatus?.id === `block-${index}` && !copyStatus.copied) ? null : (
                     <Tooltip content="Failed to copy" intent={Intent.DANGER}>
                        <Icon icon={IconNames.ERROR} intent={Intent.DANGER} style={{ marginLeft: '4px' }} />
                     </Tooltip>
                   )}
                </div>
              </div>
              <Collapse isOpen={openCollapsible[index] ?? true}>
                <pre className={`${Classes.CODE_BLOCK} ${styles.codeBlock}`}>{block.patch}</pre>
              </Collapse>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter
        actions={
          <ButtonGroup minimal={false} large={false}>
            <Button
              icon={copyStatus?.id === 'all' && copyStatus.copied ? IconNames.SAVED : IconNames.CLIPBOARD}
              text={copyStatus?.id === 'all' && copyStatus.copied ? "Copied!" : "Copy All"}
              onClick={() => handleCopy(promptText, 'all')}
              rightIcon={
                (copyStatus?.id === 'all' && !copyStatus.copied) ?
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
                  onOpenRepoPrompt?.();
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