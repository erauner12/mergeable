import { Icon, Tag, Tooltip } from "@blueprintjs/core";
import { useState } from "react";
import type { Endpoint } from "../lib/github/client";
import type { Pull } from "../lib/github/types";
import { toggleStar } from "../lib/mutations";
import { useConnections, useStars } from "../lib/queries";
import {
  buildRepoPromptText,
  buildRepoPromptUrl, // Added PromptMode
  defaultPromptMode,
  logRepoPromptCall,
  type DiffOptions,
  type LaunchMode,
  type PromptBlock,
  type PromptMode,
  type ResolvedPullMeta,
} from "../lib/repoprompt";
import { isDiffBlock } from "../lib/repoprompt.guards";
import { computeSize } from "../lib/size";
import CopyToClipboardIcon from "./CopyToClipboardIcon";
import DiffPickerDialog, { type DiffPickerResult } from "./DiffPickerDialog"; // Updated import
import IconWithTooltip from "./IconWithTooltip";
import PromptCopyDialog from "./PromptCopyDialog";
import styles from "./PullRow.module.scss";
import TimeAgo from "./TimeAgo";

export interface PullRowProps {
  pull: Pull;
  sizes?: number[];
}

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

export default function PullRow({ pull, sizes }: PullRowProps) {
  const [active, setActive] = useState(false);
  const stars = useStars();
  const { data: connections } = useConnections();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [currentLaunchMode, setCurrentLaunchMode] =
    useState<LaunchMode>("workspace");

  const [promptCopyState, setPromptCopyState] = useState<{
    isOpen: boolean;
    initialPromptText: string; // Renamed from promptText
    blocks: PromptBlock[]; // Updated type
    initialSelectedBlockIds: Set<string>; // New: for pre-selecting blocks in PromptCopyDialog
    prTitle?: string;
    repoPromptUrl?: string;
    resolvedMeta?: ResolvedPullMeta;
  }>({ isOpen: false, initialPromptText: "", blocks: [], initialSelectedBlockIds: new Set(), prTitle: "", repoPromptUrl: undefined, resolvedMeta: undefined });

  const handleLaunch = async (
    diffOpts?: DiffOptions,
    mode: PromptMode = defaultPromptMode,
  ) => {
    // Added mode parameter
    try {
      const currentConn = connections?.find((c) => c.id === pull.connection);
      let endpoint: Endpoint | undefined = undefined;

      if (currentConn) {
        endpoint = { auth: currentConn.auth, baseUrl: currentConn.baseUrl };
      } else {
        console.warn(
          `Connection with ID ${pull.connection} not found for PR #${pull.number}. Proceeding unauthenticated.`,
        );
        endpoint = { auth: "", baseUrl: "https://api.github.com" };
      }

      // 1. Build URL (which also resolves metadata)
      const { url: repoPromptUrl, resolvedMeta } = await buildRepoPromptUrl(
        pull,
        currentLaunchMode,
        endpoint,
      );

      // 2. Open RepoPrompt in a new tab - REMOVED
      // window.open(repoPromptUrl, "_blank");

      // 3. Build prompt text and blocks using resolved metadata
      const {
        promptText: generatedInitialPromptText,
        blocks: allPromptBlocks,
      } = await buildRepoPromptText(
        pull,
        diffOpts,
        mode, // Pass mode
        endpoint,
        resolvedMeta,
      );

      // Determine initially selected block IDs for PromptCopyDialog
      const newInitialSelectedBlockIds = new Set<string>();
      allPromptBlocks.forEach((block) => {
        if (block.id.startsWith("pr-details")) {
          // PR details always selected
          newInitialSelectedBlockIds.add(block.id);
        } else if (isDiffBlock(block)) {
          if (diffOpts?.includePr && block.id.startsWith("diff-pr")) {
            newInitialSelectedBlockIds.add(block.id);
          }
          if (
            diffOpts?.includeLastCommit &&
            block.id.startsWith("diff-last-commit")
          ) {
            newInitialSelectedBlockIds.add(block.id);
          }
          // Add logic for specific commits if that feature is re-enabled for selection
        }
        // Comment blocks (from includeComments) are not initially selected for the prompt text by default
        // but will be available in the dialog.
      });

      // 4. Set state to open the PromptCopyDialog
      setPromptCopyState({
        isOpen: true,
        initialPromptText: generatedInitialPromptText, // This is the text of initially selected blocks
        blocks: allPromptBlocks, // All generated blocks
        initialSelectedBlockIds: newInitialSelectedBlockIds,
        prTitle: pull.title,
        repoPromptUrl,
        resolvedMeta,
      });

      // 5. Log the call - REMOVED (will be done via onOpenRepoPrompt callback)
      // logRepoPromptCall({ ... }); // Will be called from PromptCopyDialog's onOpenRepoPrompt
    } catch (err) {
      console.error("Failed to build RepoPrompt link or prompt text:", err);
      // Optional: Show a toast message to the user
    }
  };

  // 🔹 old openRepoPrompt helper removed or adapted into handleLaunch

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStar(pull).catch(console.error);
  };

  return (
    <>
      {" "}
      {/* Fragment to wrap tr and Dialog */}
      <tr
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        className={styles.row}
      >
        <td onClick={(e) => handleStar(e)} style={{ cursor: "pointer" }}>
          {stars.has(pull.uid) ? (
            <IconWithTooltip
              icon="star"
              color="#FBD065"
              title="Unstar pull request"
              className={styles.star}
            />
          ) : (
            <IconWithTooltip
              icon="star-empty"
              title="Star pull request"
              className={styles.star}
            />
          )}
        </td>
        {/* Updated onClick to open dialog */}
        <td
          onClick={() => {
            setCurrentLaunchMode("workspace");
            setPickerOpen(true);
          }}
          style={{ cursor: "pointer" }}
        >
          <IconWithTooltip
            icon="application"
            title="Open workspace in RepoPrompt (choose diff…)"
          />
        </td>
        {/* Updated onClick to open dialog */}
        <td
          onClick={() => {
            setCurrentLaunchMode("folder");
            setPickerOpen(true);
          }}
          style={{ cursor: "pointer" }}
        >
          <IconWithTooltip
            icon="folder-open"
            title="Open folder (choose diff…)"
          />
        </td>
        <td>
          {pull.attention?.set && (
            <IconWithTooltip
              icon="flag"
              color="#CD4246"
              title={`You are in the attention set: ${pull.attention?.reason}`}
            />
          )}
        </td>
        <td>
          <div className={styles.author}>
            {pull.author && (
              <Tooltip content={pull.author.name}>
                {pull.author.avatarUrl ? (
                  <img src={pull.author.avatarUrl} />
                ) : (
                  <Icon icon="user" />
                )}
              </Tooltip>
            )}
          </div>
        </td>
        <td>
          {pull.state == "draft" ? (
            <IconWithTooltip icon="document" title="Draft" color="#5F6B7C" />
          ) : pull.state == "merged" ? (
            <IconWithTooltip icon="git-merge" title="Merged" color="#634DBF" />
          ) : pull.state == "enqueued" ? (
            <IconWithTooltip icon="time" title="Enqueued" color="#1C6E42" />
          ) : pull.state == "closed" ? (
            <IconWithTooltip
              icon="cross-circle"
              title="Closed"
              color="#AC2F33"
            />
          ) : pull.state == "approved" ? (
            <IconWithTooltip icon="git-pull" title="Approved" color="#1C6E42" />
          ) : pull.state == "pending" ? (
            <IconWithTooltip icon="git-pull" title="Pending" color="#C87619" />
          ) : null}
        </td>
        <td>
          {pull.checkState == "error" ? (
            <IconWithTooltip icon="error" title="Error" color="#AC2F33" />
          ) : pull.checkState == "failure" ? (
            <IconWithTooltip
              icon="cross-circle"
              title="Some checks are failing"
              color="#AC2F33"
            />
          ) : pull.checkState == "success" ? (
            <IconWithTooltip
              icon="tick-circle"
              title="All checks passing"
              color="#1C6E42"
            />
          ) : (
            <IconWithTooltip icon="remove" title="Pending" color="#5F6B7C" />
          )}
        </td>
        <td>
          <Tooltip content={formatDate(pull.updatedAt)}>
            <TimeAgo
              date={new Date(pull.updatedAt)}
              tooltip={false}
              timeStyle="round"
            />
          </Tooltip>
        </td>
        <td>
          <Tooltip
            content={
              <>
                <span className={styles.additions}>+{pull.additions}</span> /{" "}
                <span className={styles.deletions}>-{pull.deletions}</span>
              </>
            }
            openOnTargetFocus={false}
            usePortal={false}
          >
            <Tag>{computeSize(pull, sizes)}</Tag>
          </Tooltip>
        </td>
        <td>
          <div className={styles.title}>
            <a href={pull.url}>{pull.title}</a>
            {active && (
              <CopyToClipboardIcon
                title="Copy URL to clipboard"
                text={pull.url}
                className={styles.copy}
              />
            )}
          </div>
          <div className={styles.source}>
            <a href={pull.url}>
              {pull.host}/{pull.repo} #{pull.number}
            </a>
          </div>
        </td>
      </tr>
      {/* 🚀 Render DiffPickerDialog */}
      <DiffPickerDialog
        isOpen={pickerOpen}
        onConfirm={({ diffOpts, mode }: DiffPickerResult) => {
          // Destructure diffOpts and mode
          setPickerOpen(false);
          // Note: currentLaunchMode is set by the click handlers for the icons.
          // If we want mode to influence launchMode, that logic would be here or in handleLaunch.
          // For now, launchMode remains determined by which icon was clicked.
          void handleLaunch(diffOpts, mode); // Pass selected options and mode to handleLaunch
        }}
        onCancel={() => setPickerOpen(false)}
        prTitle={pull.title} // Pass PR title to DiffPickerDialog
      />
      {/* Render PromptCopyDialog */}
      <PromptCopyDialog
        isOpen={promptCopyState.isOpen}
        initialPromptText={promptCopyState.initialPromptText}
        blocks={promptCopyState.blocks}
        initialSelectedBlockIds={promptCopyState.initialSelectedBlockIds}
        prTitle={promptCopyState.prTitle}
        repoPromptUrl={promptCopyState.repoPromptUrl}
        onOpenRepoPrompt={(selectedText) => {
          // Receive selectedText
          if (!promptCopyState.resolvedMeta) {
            console.error(
              "Resolved meta not available for logging RepoPrompt call",
            );
            return;
          }
          const m = promptCopyState.resolvedMeta;
          logRepoPromptCall({
            rootPath: m.rootPath,
            workspace: m.repo,
            branch: m.branch,
            files: m.files,
            flags: {
              focus: true,
              ephemeral: currentLaunchMode === "folder",
            },
            // Use selectedText for preview
            promptPreview:
              selectedText.length > 120
                ? `${selectedText.slice(0, 120)}…`
                : selectedText,
          });
        }}
        onClose={() =>
          setPromptCopyState((prev) => ({ ...prev, isOpen: false }))
        }
      />
    </>
  );
}
