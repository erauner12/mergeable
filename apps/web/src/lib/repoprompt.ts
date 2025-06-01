import type { Pull } from "./github/types";
import { getDefaultRoot } from "./settings";

export async function buildRepoPromptLink(pull: Pull): Promise<string> {
  const baseRoot = await getDefaultRoot(); // e.g., "~/git/work"
  const repoName = pull.repo.split("/")[1]; // owner/repo → repo
  const rootPath = `${baseRoot}/${repoName}`;

  const files = encodeURIComponent(pull.files.join(","));
  const prompt = encodeURIComponent(
    [
      "## Sync to PR branch",
      "```bash",
      `cd ${rootPath}`,
      "git fetch origin",
      `git checkout ${pull.branch}`,
      "```",
      "",
      `# PR ${pull.number}: ${pull.title}`,
      "",
      pull.body ?? "",
      "",
      `🔗 ${pull.url}`,
    ].join("\n"),
  );

  return `repoprompt://open/${encodeURIComponent(rootPath)}?files=${files}&prompt=${prompt}`;
}
