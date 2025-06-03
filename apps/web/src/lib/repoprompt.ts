import type { Endpoint } from "./github/client"; // Import Endpoint type
import {
  fetchPullComments, // New import
  getCommitDiff,
  getPullRequestDiff,
  getPullRequestMeta,
  listPrCommits,
} from "./github/client";
import type { Pull } from "./github/types";
import { renderTemplate } from "./renderTemplate"; // ADDED: Import renderTemplate
import { getDefaultRoot, getPromptTemplate } from "./settings"; // Added getPromptTemplate

/**
 * Functions for building RepoPrompt URLs and prompt text.
 * Note on URL parameters:
 * - File paths in the 'files' query parameter are individually UTF-8 percent-encoded.
 * - When reading these parameters back using `URLSearchParams.get()`, the browser automatically decodes them.
 */

/** Pushes `item` into `arr` IFF no existing element satisfies `key(item)`. */
function pushUnique<T>(arr: T[], item: T, key: (t: T) => string) {
  if (!arr.some((existing) => key(existing) === key(item))) {
    arr.push(item);
  }
}

export type LaunchMode = "workspace" | "folder";

// New: PromptMode enum and default
export type PromptMode = "implement" | "review" | "adjust-pr" | "respond";
export const defaultPromptMode: PromptMode = "implement";

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
  threadId?: string; // new – PR review thread (undefined for issue comments)
  diffHunk?: string; // new – raw hunk text from the API
  resolved?: boolean; // ← NEW (undefined = not a code-thread or resolution unknown, false = unresolved, true = resolved)
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
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Ensures the "files changed" list is added to the body content idempotently.
 * @param bodyInput The original body content.
 * @param files List of file paths to include.
 * @param placeholderIfEmpty The string that represents an empty/placeholder body.
 * @returns The body content, potentially with the "files changed" list appended.
 */
function withFileList(
  bodyInput: string,
  files: string[],
  placeholderIfEmpty: string,
): string {
  const FILES_LIST_RE = /^\s*###\s+files\s+changed\s+\(\d+\)/im;
  const canonicalHeader = "### files changed";

  // If a list already exists (matched by robust regex) or no files to list, return the original body.
  if (FILES_LIST_RE.test(bodyInput) || files.length === 0) {
    return bodyInput;
  }

  // If no list exists and there are files, append a canonical one.
  const filesList = files.map((f) => `- ${f}`).join("\n");
  const sectionToAdd = `${canonicalHeader} (${files.length})\n${filesList}`;

  const trimmedBody = bodyInput.trim();

  // If the original body (trimmed) was empty or just the placeholder, the new section is the whole body.
  if (trimmedBody === "" || trimmedBody === placeholderIfEmpty) {
    return sectionToAdd;
  }

  // Append to existing body content
  return `${trimmedBody}\n\n${sectionToAdd}`; // Ensure separation
}

// Renamed and updated to handle single PromptBlock
export function formatPromptBlock(block: PromptBlock): string {
  if (block.kind === "diff") {
    // keep the patch exactly as GitHub returned it
    return `${block.header}\n\`\`\`diff\n${block.patch}\n\`\`\`\n`;
  } else if (block.kind === "comment") {
    const parts: string[] = [];
    if (block.diffHunk) {
      // Only threads from review comments will have diffHunk
      parts.push("```diff");
      parts.push(block.diffHunk.trim());
      parts.push("```");
      parts.push(""); // Add a newline after the diff hunk
    }

    parts.push(block.header); // e.g., "### THREAD ON ..." or "### ISSUE COMMENT ..."

    // If it's a block generated by makeThreadBlock (indicated by threadId),
    // its commentBody is already formatted with individual authors/timestamps.
    // If it's a simple issue/review comment, we need to add the author/timestamp line.
    if (block.threadId) {
      // This indicates it came from makeThreadBlock or represents a comment thread
      parts.push(block.commentBody); // This body is already fully formatted with individual comments
    } else {
      // Simple comment (e.g. issue comment, review summary, or PR description)
      const dateString = formatDateUtcShort(block.timestamp);
      parts.push(`> _${block.author} · ${dateString}_`);
      parts.push(""); // Newline after author line
      parts.push(block.commentBody);
    }
    // Ensure a trailing newline for the block, formatListOfPromptBlocks will handle overall trimming
    return parts.join("\n") + "\n";
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

// --------------------------------------------------------------------------------
// NEW OVERLOADS (place *above* the implementation)
// --------------------------------------------------------------------------------
export async function buildRepoPromptText(
  pull: PullWithBranch,
  diffOptions?: DiffOptions,
  endpoint?: Endpoint,
  meta?: ResolvedPullMeta,
): Promise<{ promptText: string; blocks: PromptBlock[] }>;

export async function buildRepoPromptText(
  pull: PullWithBranch,
  diffOptions: DiffOptions | undefined,
  mode: PromptMode,
  endpoint?: Endpoint,
  meta?: ResolvedPullMeta,
): Promise<{ promptText: string; blocks: PromptBlock[] }>;

// --------------------------------------------------------------------------------
// SINGLE IMPLEMENTATION
// --------------------------------------------------------------------------------
export async function buildRepoPromptText(
  pull: PullWithBranch,
  diffOptionsArg?: DiffOptions,
  modeOrEndpoint?: PromptMode | Endpoint,
  endpointOrMeta?: Endpoint | ResolvedPullMeta,
  maybeMeta?: ResolvedPullMeta,
): Promise<{ promptText: string; blocks: PromptBlock[] }> {
  // --- argument juggling (no changes) ---
  let mode: PromptMode = defaultPromptMode;
  let endpoint: Endpoint | undefined;
  let meta: ResolvedPullMeta | undefined;
  const diffOptions: DiffOptions = diffOptionsArg || {};

  if (diffOptions.includePr && diffOptions.includeLastCommit) {
    diffOptions.includeLastCommit = false;
  }

  if (
    typeof modeOrEndpoint === "string" &&
    (modeOrEndpoint === "implement" ||
      modeOrEndpoint === "review" ||
      modeOrEndpoint === "adjust-pr" ||
      modeOrEndpoint === "respond")
  ) {
    mode = modeOrEndpoint as PromptMode;
    endpoint = endpointOrMeta as Endpoint | undefined;
    meta = maybeMeta;
  } else {
    endpoint = modeOrEndpoint;
    meta = endpointOrMeta as ResolvedPullMeta | undefined;
  }

  if (!meta) {
    throw new Error(
      "ResolvedPullMeta (meta) is required for buildRepoPromptText. Legacy callers might need updating or meta resolution logic here.",
    );
  }

  const { owner, repo, branch, rootPath } = meta;
  const token = endpoint?.auth;

  const allPromptBlocks: PromptBlock[] = [];
  // `initiallySelectedBlocks` will be used to determine content for PR_DETAILS and DIFF_CONTENT slots
  const initiallySelectedBlocks: PromptBlock[] = [];

  // 0. PR Details Block (always first, always initially selected)
  const placeholderDescription = "_No description provided._";
  let prBodyForBlock = pull.body?.trim() || placeholderDescription;

  if (!diffOptions.includePr && meta.files && meta.files.length > 0) {
    prBodyForBlock = withFileList(
      prBodyForBlock,
      meta.files,
      placeholderDescription,
    );
  }

  const prDetailsBlock: CommentBlockInput = {
    id: `pr-details-${pull.id}`,
    kind: "comment",
    header: `### PR #${pull.number} DETAILS: ${pull.title}`,
    commentBody: prBodyForBlock,
    author: pull.author?.name ?? "unknown",
    authorAvatarUrl: pull.author?.avatarUrl,
    timestamp: pull.createdAt,
  };
  pushUnique(allPromptBlocks, prDetailsBlock, (b) => b.id);
  pushUnique(initiallySelectedBlocks, prDetailsBlock, (b) => b.id);

  // --- Block Fetching Logic (1. Comments, 2. Full PR Diff, 3. Last Commit Diff, 4. Specific Commits Diffs) ---
  // This logic remains largely the same, pushing to `allPromptBlocks` and `initiallySelectedBlocks`
  // ... (existing block fetching logic here, ensuring `initiallySelectedBlocks` is populated correctly) ...
  // 1. Comments, Reviews, Threads (if requested)
  if (diffOptions.includeComments) {
    if (endpoint) {
      const commentBlocks = await fetchPullComments(
        endpoint,
        owner,
        repo,
        pull.number,
      );
      commentBlocks.forEach((block) => {
        pushUnique(allPromptBlocks, block, (b) => b.id);
        // Decide if comments go into initiallySelectedBlocks based on mode
        if (mode !== "adjust-pr") {
          // Example: comments not initially selected for adjust-pr
          // Potentially add to initiallySelectedBlocks for other modes if desired
          // For now, let's assume they are generally *not* part of DIFF_CONTENT by default
          // but are available in `allPromptBlocks` for the UI to pick.
          // If they *should* be in DIFF_CONTENT, push them to initiallySelectedBlocks here.
        }
      });
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
      endpoint?.baseUrl,
    );
    if (prDiff.trim()) {
      const block: DiffBlockInput = {
        id: `diff-pr-${pull.id}`,
        kind: "diff",
        header: "### FULL PR DIFF",
        patch: prDiff,
      };
      pushUnique(allPromptBlocks, block, (b) => b.id);
      pushUnique(initiallySelectedBlocks, block, (b) => b.id);
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
      endpoint?.baseUrl,
    );
    if (prCommits.length > 0) {
      const lastCommit = prCommits[0];
      if (lastCommit && lastCommit.sha) {
        const lastCommitDiff = await getCommitDiff(
          owner,
          repo,
          lastCommit.sha,
          token,
          endpoint?.baseUrl,
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
          pushUnique(allPromptBlocks, block, (b) => b.id);
          pushUnique(initiallySelectedBlocks, block, (b) => b.id);
        }
      }
    }
  }

  // 4. Specific Commits Diffs
  if (diffOptions.commits && diffOptions.commits.length > 0) {
    const allPrCommitsForMessages = await listPrCommits(
      owner,
      repo,
      pull.number,
      250,
      token,
      endpoint?.baseUrl,
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
        endpoint?.baseUrl,
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
        pushUnique(allPromptBlocks, block, (b) => b.id);
        pushUnique(initiallySelectedBlocks, block, (b) => b.id);
      }
    }
  }
  // --- End of Block Fetching Logic ---

  // Prepare content for template slots
  const setupString = [
    `cd ${rootPath}`,
    "git fetch origin",
    `git checkout ${branch}`,
  ].join("\n");

  const prDetailsString = formatPromptBlock(prDetailsBlock);

  const otherSelectedBlocks = initiallySelectedBlocks.filter(
    (block) => block.id !== prDetailsBlock.id,
  );
  const diffContentString = formatListOfPromptBlocks(otherSelectedBlocks);

  const linkString = `🔗 ${pull.url.includes("/pull/") ? pull.url : `https://github.com/${owner}/${repo}/pull/${pull.number}`}`;
  const mainTemplateString = await getPromptTemplate(mode);

  // Check if template contains the prDetailsBlock token
  const hasTokenInTemplate = mainTemplateString.includes('{{prDetailsBlock}}');
  
  // Check if this is a standard template (contains standard slots)
  const isStandardTemplate = mainTemplateString.includes('{{SETUP}}') && 
                             mainTemplateString.includes('{{PR_DETAILS}}') && 
                             mainTemplateString.includes('{{LINK}}');
  
  // Render the template with slots including prDetailsBlock support
  const renderedTemplate = renderTemplate(mainTemplateString, {
    SETUP: setupString,
    PR_DETAILS: prDetailsString,
    DIFF_CONTENT: diffContentString,
    LINK: linkString,
    prDetailsBlock: prDetailsString, // Add support for {{prDetailsBlock}} token
  });

  let promptText: string;
  
  if (isStandardTemplate) {
    // For standard templates, just return the rendered content
    promptText = renderedTemplate;
  } else {
    // For custom templates, use the structured approach with SETUP/LINK sections
    const promptSections = [];
    
    // Always include SETUP section
    promptSections.push(`## SETUP\n${setupString}`);
    
    // Add the rendered template content
    promptSections.push(renderedTemplate);
    
    // For backward compatibility: if template didn't contain {{prDetailsBlock}}, append PR details
    if (!hasTokenInTemplate) {
      promptSections.push(prDetailsString);
    }
    
    // Always include LINK section
    promptSections.push(linkString);
    
    promptText = promptSections.join('\n\n');
  }

  const uniqueAllPromptBlocks = Array.from(
    new Map(allPromptBlocks.map((b) => [b.id, b])).values(),
  );

  return { promptText, blocks: uniqueAllPromptBlocks };
}
