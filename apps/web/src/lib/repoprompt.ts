import { getPullRequestDiff, getPullRequestMeta } from "./github/client";
import type { Pull } from "./github/types";
import { getBasePrompt, getDefaultRoot } from "./settings";

export type LaunchMode = "workspace" | "folder";

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
  mode: LaunchMode = "workspace", // 👈 default keeps current behaviour
): Promise<string> {
  const baseRoot = await getDefaultRoot();
  // getDefaultRoot() is typed to return a string; keep a runtime guard
  // but avoid template–literal interpolation to placate the linter.
  if (typeof baseRoot !== "string") {
    throw new Error("getDefaultRoot did not return a string value");
  }
  const [owner, repo] = pull.repo.split("/");
  const rootPath = `${baseRoot}/${repo}`;

  // Ensure branch and files are populated
  let { branch, files } = pull; // Use local vars that might be updated

  if (!branch || files.length === 0) {
    // Fetch metadata if branch is empty or files list is empty
    const meta = await getPullRequestMeta(
      owner,
      repo,
      pull.number /*, token? */,
    );
    branch = branch || meta.branch; // If original branch was empty, use fetched.
    files = files.length ? files : meta.files; // If original files was empty, use fetched.
  }

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
    `git checkout ${branch}`, // Use local 'branch' variable
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
  const filesParamValue = files // Use local 'files' variable
    .map((f) => encodeURIComponent(f))
    .join(",");
  // const workspaceParam = `workspace=${encodeURIComponent(repo)}`; // Removed, handled by mode

  // When we set workspace=…, drop the path component from the URL base.
  // RepoPrompt uses the workspace param to identify the window/project.
  // const base = "repoprompt://open"; // Removed, handled by mode

  // const queryParamsArray: string[] = []; // Renamed to query
  // queryParamsArray.push(workspaceParam);
  // queryParamsArray.push("focus=true");

  // ──────────────────────────────────────────────────────────────
  // 5️⃣  Build query & base URL according to requested mode
  // ──────────────────────────────────────────────────────────────
  const query: string[] = ["focus=true"]; // common flag
  let base: string; // <—— was const

  if (mode === "workspace") {
    base = "repoprompt://open";
    query.push(`workspace=${encodeURIComponent(repo)}`);
    query.push("ephemeral=false"); // explicit – avoid surprises
  } else {
    //  mode === "folder"
    base = `repoprompt://open/${encodeURIComponent(rootPath)}`;
    query.push("ephemeral=true"); // throw-away session
  }

  if (files.length > 0) {
    // Use local 'files' variable
    query.push(`files=${filesParamValue}`);
  }
  // The prompt payload is URI encoded, so `prompt` variable will not be empty if payload is not empty.
  // However, `encodeURIComponent("")` results in `""`, so an empty promptPayload will result in an empty `prompt`.
  if (prompt.length) {
    query.push(`prompt=${prompt}`);
  }

  query.sort(); // deterministic ordering
  const finalUrl = `${base}?${query.join("&")}`;

  logRepoPromptCall({
    rootPath,
    workspace: repo,
    branch: branch, // Use local 'branch' variable
    files: files, // Use local 'files' variable
    flags: { focus: true /* future: persist / ephemeral etc. */ },
    promptPreview:
      promptPayload.length > 120
        ? `${promptPayload.slice(0, 120)}…`
        : promptPayload,
  });

  return finalUrl;
}
