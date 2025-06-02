import type { Endpoint } from "./github/client"; // Import Endpoint type
import {
  fetchPullComments, // New import
  getCommitDiff,
  getPullRequestDiff,
  getPullRequestMeta,
  listPrCommits,
} from "./github/client";
import type { Pull } from "./github/types";
import { getBasePrompt, getDefaultRoot } from "./settings";

/**
 * Functions for building RepoPrompt URLs and prompt text.
 * Note on URL parameters:
 * - File paths in the 'files' query parameter are individually UTF-8 percent-encoded.
 * - When reading these parameters back using `URLSearchParams.get()`, the browser automatically decodes them.
 */

export type LaunchMode = "workspace" | "folder";

// New: CommentBlockInput
export interface CommentBlockInput {
  id: string; // e.g., "pr-details", "issue-123", "review-456", "thread-file.ts-10-789"
  kind: "comment";
  header: string; // e.g., "### PR #123 DETAILS: Title", "### ISSUE COMMENT", "### REVIEW BY @user (APPROVED)"
  commentBody: string; // The actual text content
  author: string; // Login of the author or relevant name
  authorAvatarUrl?: string; // Optional avatar URL
  timestamp: string; // ISO date string
  filePath?: string; // For threads
  line?: number; // For threads
}

// Updated: DiffBlockInput to include 'kind'
export interface DiffBlockInput {
  id: string; // New: e.g., "diff-pr", "diff-last-commit", "diff-commit-sha"
  kind: "diff";
  header: string;
  patch: string;
}

// New: PromptBlock discriminated union
export type PromptBlock = DiffBlockInput | CommentBlockInput;

export interface DiffOptions {
  includePr?: boolean;
  includeLastCommit?: boolean;
  includeComments?: boolean; // NEW
  /** @internal Currently unused by the UI – always passed as `[]` from DiffPickerDialog. Kept for API compatibility. */
  commits?: string[]; // Array of commit SHAs
}

// Old DiffBlockInput (now part of the union, effectively)
// export interface DiffBlockInput {
//   header: string;
//   patch: string;
// }

/**
 * Resolved metadata about a pull request, typically derived by `buildRepoPromptUrl`.
 */
export interface ResolvedPullMeta {
  owner: string;
  repo: string;
  branch: string;
  files: string[];
  rootPath: string;
}

/** Helper to keep test output clean */
const isTestEnv = () =>
  typeof process !== "undefined" && process.env.NODE_ENV === "test";

/** Pretty-print the parameters we’re about to hand to RepoPrompt */
export function logRepoPromptCall(details: {
  rootPath: string;
  workspace: string;
  branch: string;
  files: string[];
  flags: Record<string, boolean | undefined>;
  promptPreview: string;
}) {
  if (!isTestEnv()) {
    // eslint-disable-next-line no-console
    console.info("[RepoPrompt] Launch parameters:", details);
  }
}

/** The PR object we need here must expose the head-branch name. */
type PullWithBranch = Pull & { branch: string };

/** Return a stable `YYYY-Mon-DD` string in **UTC**, e.g. `2024-Jan-01`. */
function formatDateUtcShort(ts: string): string {
  const d = new Date(ts);
  const months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${String(
           d.getUTCDate()
         ).padStart(2, "0")}`;
}

// Renamed and updated to handle single PromptBlock
export function formatPromptBlock(block: PromptBlock): string {
  if (block.kind === "diff") {
    // keep the patch exactly as GitHub returned it
    return `${block.header}\n\`\`\`diff\n${block.patch}\n\`\`\`\n`;
  } else if (block.kind === "comment") {
    const dateString = formatDateUtcShort(block.timestamp);
    return `${block.header}\n> _${block.author} · ${dateString}_\n\n${block.commentBody}\n`;
  }
  return ""; // Should not happen
}

function formatListOfPromptBlocks(blocks: PromptBlock[]): string {
  if (blocks.length === 0) {
    return "";
  }
  return blocks.map(formatPromptBlock).join("\n").trimEnd();
}

/**
 * Builds a RepoPrompt URL for a given pull request and launch mode.
 * This function no longer includes the prompt in the URL.
 * @param pull The pull request object.
 * @param launchMode The mode to launch RepoPrompt in ('workspace' or 'folder').
 * @param endpoint Optional endpoint configuration for authenticated requests.
 * @returns An object containing the final URL and resolved metadata.
 */
export async function buildRepoPromptUrl(
  pull: PullWithBranch,
  launchMode: LaunchMode = "workspace",
  endpoint?: Endpoint,
): Promise<{ url: string; resolvedMeta: ResolvedPullMeta }> {
  const baseRoot = await getDefaultRoot();
  if (typeof baseRoot !== "string") {
    throw new Error("getDefaultRoot did not return a string value");
  }
  const [owner, repo] = pull.repo.split("/") as [string, string];
  const rootPath = `${baseRoot}/${repo}`;

  let { branch, files } = pull;
  const token = endpoint?.auth;

  if (!branch || files.length === 0) {
    const metaFromGithub = await getPullRequestMeta(
      // Renamed to avoid conflict with 'meta' parameter in buildRepoPromptText
      owner,
      repo,
      pull.number,
      token,
      endpoint?.baseUrl, // Pass baseUrl
    );
    branch = branch || metaFromGithub.branch;
    files = files.length ? files : metaFromGithub.files;
  }

  const filesParamValue = files.map((f) => encodeURIComponent(f)).join(",");

  const query: string[] = ["focus=true"];
  let base: string;

  if (launchMode === "workspace") {
    base = "repoprompt://open";
    query.push(`workspace=${encodeURIComponent(repo)}`);
  } else {
    //  mode === "folder"
    base = `repoprompt://open/${encodeURIComponent(rootPath)}`;
    query.push("ephemeral=true");
  }

  if (files.length > 0) {
    query.push(`files=${filesParamValue}`);
  }

  query.sort();
  const finalUrl = `${base}?${query.join("&")}`;

  return {
    url: finalUrl,
    resolvedMeta: { owner, repo, branch, files, rootPath },
  };
}

/**
 * Builds the prompt text and structured prompt blocks for a pull request.
 * @param pull The pull request object.
 * @param diffOptions Options for including different types of diffs and comments.
 * @param endpoint Optional endpoint configuration for authenticated requests.
 * @param meta Resolved metadata (owner, repo, branch, rootPath) from buildRepoPromptUrl.
 * @returns An object containing the full prompt text (of initially selected blocks) and an array of all generated prompt blocks.
 */
export async function buildRepoPromptText(
  pull: PullWithBranch,
  diffOptions: DiffOptions = {},
  endpoint: Endpoint | undefined,
  meta: ResolvedPullMeta,
): Promise<{ promptText: string; blocks: PromptBlock[] }> {
  const { owner, repo, branch, rootPath } = meta;
  const token = endpoint?.auth;

  const allPromptBlocks: PromptBlock[] = [];
  const initiallySelectedBlocks: PromptBlock[] = []; // For generating the initial promptText

  // 0. PR Details Block (always first, always initially selected)
  const prDetailsBlock: CommentBlockInput = {
    id: `pr-details-${pull.id}`,
    kind: "comment",
    header: `### PR #${pull.number} DETAILS: ${pull.title}`,
    commentBody: pull.body?.trim() || "_No description provided._",
    author: pull.author?.name ?? "unknown",
    authorAvatarUrl: pull.author?.avatarUrl,
    timestamp: pull.createdAt,
  };
  allPromptBlocks.push(prDetailsBlock);
  initiallySelectedBlocks.push(prDetailsBlock);

  // 1. Comments, Reviews, Threads (if requested)
  if (diffOptions.includeComments) {
    if (endpoint) {
      // fetchPullComments requires an endpoint
      const commentBlocks = await fetchPullComments(
        endpoint,
        owner,
        repo,
        pull.number,
      );
      allPromptBlocks.push(...commentBlocks);
      // Comment blocks are NOT initially selected by default for the promptText
    } else {
      console.warn("Cannot fetch comments: endpoint is undefined.");
    }
  }

  // 2. Full PR Diff
  if (diffOptions.includePr) {
    const prDiff = await getPullRequestDiff(
      owner,
      repo,
      pull.number,
      token,
      endpoint?.baseUrl, // Pass baseUrl
    );
    if (prDiff.trim()) {
      const block: DiffBlockInput = {
        id: `diff-pr-${pull.id}`,
        kind: "diff",
        header: "### FULL PR DIFF",
        patch: prDiff,
      };
      allPromptBlocks.push(block);
      initiallySelectedBlocks.push(block);
    }
  }

  // 3. Last Commit Diff
  if (diffOptions.includeLastCommit) {
    const prCommits = await listPrCommits(
      owner,
      repo,
      pull.number,
      1,
      token,
      endpoint?.baseUrl, // Pass baseUrl
    );
    if (prCommits.length > 0) {
      const lastCommit = prCommits[0];
      if (lastCommit && lastCommit.sha) {
        const lastCommitDiff = await getCommitDiff(
          owner,
          repo,
          lastCommit.sha,
          token,
          endpoint?.baseUrl, // Pass baseUrl
        );
        if (lastCommitDiff.trim()) {
          const shortSha = lastCommit.sha.slice(0, 7);
          const commitTitle = (
            lastCommit.commit.message || "No commit message"
          ).split("\n")[0];
          const block: DiffBlockInput = {
            id: `diff-last-commit-${lastCommit.sha}`,
            kind: "diff",
            header: `### LAST COMMIT (${shortSha} — "${commitTitle}")`,
            patch: lastCommitDiff,
          };
          allPromptBlocks.push(block);
          initiallySelectedBlocks.push(block);
        }
      } else {
        console.warn(
          `Could not get SHA for the last commit of PR #${pull.number}`,
        );
      }
    } else {
      console.warn(`PR #${pull.number} has no commits for 'last commit' diff.`);
    }
  }

  // 4. Specific Commits Diffs
  if (diffOptions.commits && diffOptions.commits.length > 0) {
    const allPrCommitsForMessages = await listPrCommits(
      owner,
      repo,
      pull.number,
      250, // Default limit for fetching commit messages
      token,
      endpoint?.baseUrl, // Pass baseUrl
    );
    const commitMessageMap = new Map(
      allPrCommitsForMessages.map((c) => [
        c.sha,
        (c.commit.message || "No commit message").split("\n")[0],
      ]),
    );

    for (const sha of diffOptions.commits) {
      const commitDiff = await getCommitDiff(
        owner,
        repo,
        sha,
        token,
        endpoint?.baseUrl, // Pass baseUrl
      );
      if (commitDiff.trim()) {
        const shortSha = sha.slice(0, 7);
        const commitTitle =
          commitMessageMap.get(sha) || "Unknown commit message";
        const block: DiffBlockInput = {
          id: `diff-commit-${sha}`,
          kind: "diff",
          header: `### COMMIT (${shortSha} — "${commitTitle}")`,
          patch: commitDiff,
        };
        allPromptBlocks.push(block);
        initiallySelectedBlocks.push(block); // Assuming specific commits are also initially selected if requested
      }
    }
  }

  const combinedInitialContent = formatListOfPromptBlocks(
    initiallySelectedBlocks,
  );

  const basePrompt = await getBasePrompt();
  const promptPayloadParts: string[] = [
    "## SETUP",
    "```bash",
    `cd ${rootPath}`, // Correctly from meta
    "git fetch origin",
    `git checkout ${branch}`, // Correctly from meta
    "```",
    "",
    basePrompt,
    "",
  ];

  if (combinedInitialContent.trim()) {
    promptPayloadParts.push(combinedInitialContent, "");
  }

  // Ensure the PR link is correctly formatted
  const prLink = pull.url.includes("/pull/")
    ? pull.url
    : `https://github.com/${owner}/${repo}/pull/${pull.number}`;
  promptPayloadParts.push(`🔗 ${prLink}`);
  const promptText = promptPayloadParts.join("\n");

  return { promptText, blocks: allPromptBlocks };
}