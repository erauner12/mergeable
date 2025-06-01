import { getPullRequestDiff } from "./github/client";
import type { Pull } from "./github/types";
import { getBasePrompt, getDefaultRoot } from "./settings";

/** Helper to keep test output clean */
const isTestEnv = () =>
  typeof process !== "undefined" && process.env.NODE_ENV === "test";

/** Pretty-print the parameters we’re about to hand to RepoPrompt */
function logRepoPromptCall(details: {
  rootPath: string;
  workspace: string;
  branch: string;
  files: string[];
  flags: Record<string, boolean | undefined>;
  promptPreview: string;
}) {
  // Print as a single object so it’s collapsible in DevTools
  // (skip when running Vitest to avoid noisy snapshots)
  if (!isTestEnv()) {
    // eslint-disable-next-line no-console
    console.info("[RepoPrompt] Launch parameters:", details);
  }
}

/** The PR object we need here must expose the head-branch name. */
type PullWithBranch = Pull & { branch: string };

// Assuming 'Pull' type and 'getDefaultRoot' are defined or imported
// export interface Pull { ... }
// export async function getDefaultRoot(): Promise<string> { ... }

export async function buildRepoPromptLink(
  pull: PullWithBranch,
): Promise<string> {
  const baseRoot = await getDefaultRoot();
  // getDefaultRoot() is typed to return a string; keep a runtime guard
  // but avoid template–literal interpolation to placate the linter.
  if (typeof baseRoot !== "string") {
    throw new Error("getDefaultRoot did not return a string value");
  }
  const [owner, repo] = pull.repo.split("/");
  const rootPath = `${baseRoot}/${repo}`;

  // ①  Fetch diff (may be large)
  let diff = await getPullRequestDiff(
    owner,
    repo,
    pull.number /*, pull.token_if_available */,
  ); // Consider passing token if available
  const DIFF_LIMIT = 8000; // keep URL safe
  if (diff.length > DIFF_LIMIT) {
    diff =
      diff.slice(0, DIFF_LIMIT) +
      "\n… (truncated, open PR in browser for full patch)";
  }

  // ②  Base prompt template
  const basePrompt = await getBasePrompt();

  // ③  Final prompt text
  const promptPayload = [
    "## SETUP",
    "```bash",
    `cd ${rootPath}`,
    "git fetch origin",
    `git checkout ${pull.branch}`, // ✅ branch is now a string
    "```",
    "",
    basePrompt,
    "",
    `### PR #${pull.number}: ${pull.title}`,
    "",
    pull.body ?? "",
    "",
    "### FULL DIFF",
    "```diff",
    diff.trimEnd(),
    "```",
    "",
    `🔗 ${pull.url}`,
  ].join("\n");

  const prompt = encodeURIComponent(promptPayload);

  // Encode **each** file but keep the commas intact (mirrors CLI behaviour)
  const files = pull.files.map((f) => encodeURIComponent(f)).join(",");
  const workspaceParam = `workspace=${encodeURIComponent(repo)}`; // Renamed from 'workspace' to avoid conflict

  // Keep the canonical "/" after …open/
  // const finalUrl = `repoprompt://open/${encodeURIComponent(
  //   rootPath,
  // )}?${workspaceParam}&focus=true&files=${files}&prompt=${prompt}`;

  // When we set workspace=…, drop the path component from the URL base.
  // RepoPrompt uses the workspace param to identify the window/project.
  const base = "repoprompt://open";
  const finalUrl = `${base}?${workspaceParam}&focus=true&files=${files}&prompt=${prompt}`;

  logRepoPromptCall({
    rootPath,
    workspace: repo,
    branch: pull.branch,
    files: pull.files,
    flags: { focus: true /* future: persist / ephemeral etc. */ },
    promptPreview:
      promptPayload.length > 120
        ? `${promptPayload.slice(0, 120)}…`
        : promptPayload,
  });

  return finalUrl;
}
