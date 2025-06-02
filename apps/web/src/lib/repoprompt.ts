import type { Endpoint } from "./github/client"; // Import Endpoint type
import {
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

export interface DiffOptions {
  includePr?: boolean;
  includeLastCommit?: boolean;
  /** @internal Currently unused by the UI – always passed as `[]` from DiffPickerDialog. Kept for API compatibility. */
  commits?: string[]; // Array of commit SHAs
}

export interface DiffBlockInput {
  header: string;
  patch: string;
}

/**
 * Resolved metadata about a pull request, typically derived by `buildRepoPromptUrl`.
 * All properties (`owner`, `repo`, `branch`, `files`) are expected to be non-empty
 * and validated by the producer (e.g., `buildRepoPromptUrl` fetches them if initially missing).
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

function formatDiffBlocksForPrompt(diffBlocks: DiffBlockInput[]): string {
  if (diffBlocks.length === 0) {
    return "";
  }
  return diffBlocks
    .map(
      (block) =>
        // keep the patch exactly as GitHub returned it
        `${block.header}\n\`\`\`diff\n${block.patch}\n\`\`\`\n`,
    )
    .join("\n")
    .trimEnd();
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
 * Builds the prompt text and structured diff blocks for a pull request.
 * @param pull The pull request object.
 * @param diffOptions Options for including different types of diffs.
 * @param endpoint Optional endpoint configuration for authenticated requests.
 * @param meta Resolved metadata (owner, repo, branch, rootPath) from buildRepoPromptUrl.
 * @returns An object containing the full prompt text and an array of diff blocks.
 */
export async function buildRepoPromptText(
  pull: PullWithBranch,
  diffOptions: DiffOptions = {},
  endpoint: Endpoint | undefined,
  meta: ResolvedPullMeta, // This 'meta' is from buildRepoPromptUrl's return
): Promise<{ promptText: string; blocks: DiffBlockInput[] }> {
  const { owner, repo, branch, rootPath } = meta; // Use destructured values from the 'meta' param
  const token = endpoint?.auth;

  const allDiffBlocks: DiffBlockInput[] = [];

  // 1. Full PR Diff
  if (diffOptions.includePr) {
    const prDiff = await getPullRequestDiff(owner, repo, pull.number, token);
    if (prDiff.trim()) {
      allDiffBlocks.push({
        header: "### FULL PR DIFF",
        patch: prDiff,
      });
    }
  }

  // 2. Last Commit Diff
  if (diffOptions.includeLastCommit) {
    const prCommits = await listPrCommits(owner, repo, pull.number, 1, token);
    if (prCommits.length > 0) {
      const lastCommit = prCommits[0];
      if (lastCommit && lastCommit.sha) {
        const lastCommitDiff = await getCommitDiff(
          owner,
          repo,
          lastCommit.sha,
          token,
        );
        if (lastCommitDiff.trim()) {
          const shortSha = lastCommit.sha.slice(0, 7);
          const commitTitle = (
            lastCommit.commit.message || "No commit message"
          ).split("\n")[0];
          allDiffBlocks.push({
            header: `### LAST COMMIT (${shortSha} — "${commitTitle}")`,
            patch: lastCommitDiff,
          });
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

  // 3. Specific Commits Diffs
  if (diffOptions.commits && diffOptions.commits.length > 0) {
    const allPrCommitsForMessages = await listPrCommits(
      owner,
      repo,
      pull.number,
      250, // Default limit for fetching commit messages
      token,
    );
    const commitMessageMap = new Map(
      allPrCommitsForMessages.map((c) => [
        c.sha,
        (c.commit.message || "No commit message").split("\n")[0],
      ]),
    );

    for (const sha of diffOptions.commits) {
      const commitDiff = await getCommitDiff(owner, repo, sha, token);
      if (commitDiff.trim()) {
        const shortSha = sha.slice(0, 7);
        const commitTitle =
          commitMessageMap.get(sha) || "Unknown commit message";
        allDiffBlocks.push({
          header: `### COMMIT (${shortSha} — "${commitTitle}")`,
          patch: commitDiff,
        });
      }
    }
  }

  const combinedDiffContent = formatDiffBlocksForPrompt(allDiffBlocks);

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
    // Corrected lines: use 'pull' for PR-specific details
    `### PR #${pull.number}: ${pull.title}`,
    "",
    pull.body ?? "",
    "",
  ];

  if (combinedDiffContent.trim()) {
    promptPayloadParts.push(combinedDiffContent, "");
  }

  // Ensure the PR link is correctly formatted
  const prLink = pull.url.includes("/pull/")
    ? pull.url
    : `https://github.com/${owner}/${repo}/pull/${pull.number}`;
  promptPayloadParts.push(`🔗 ${prLink}`);
  const promptText = promptPayloadParts.join("\n");

  return { promptText, blocks: allDiffBlocks };
}