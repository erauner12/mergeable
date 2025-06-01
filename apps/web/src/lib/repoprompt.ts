import { getPullRequestDiff } from "./github/client";
import type { Pull } from "./github/types";
import { getBasePrompt, getDefaultRoot } from "./settings";

// Assuming 'Pull' type and 'getDefaultRoot' are defined or imported
// export interface Pull { ... }
// export async function getDefaultRoot(): Promise<string> { ... }

export async function buildRepoPromptLink(pull: Pull): Promise<string> {
  const baseRoot = await getDefaultRoot();
  if (typeof baseRoot !== "string") {
    throw new Error(`getDefaultRoot did not return a string: ${baseRoot}`);
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
    `git checkout ${pull.branch}`,
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
  const files = encodeURIComponent(pull.files.join(","));
  const workspace = `workspace=${encodeURIComponent(repo)}`;

  // Construct the final URL
  // Note: The original implementation might have been different. This replaces it.
  return [
    "repoprompt://open",
    encodeURIComponent(rootPath), // Path part of the URL
    `?${workspace}&focus=true&files=${files}&prompt=${prompt}`, // Query parameters
  ].join("");
}
