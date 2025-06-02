/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client"; // Import renamed type
import * as gh from "../../src/lib/github/client"; // ← stub network call
import {
  buildRepoPromptText,
  buildRepoPromptUrl,
  logRepoPromptCall,
  type ResolvedPullMeta,
} from "../../src/lib/repoprompt";
import * as settings from "../../src/lib/settings";
// Assuming mockPull is imported from a shared testing utility like "../testing"
// If it's defined locally, ensure its signature matches the usage.
import { mockPull } from "../testing";

// Mock logRepoPromptCall as it's now called by buildRepoPromptText or PullRow
// For these tests, we are testing buildRepoPromptUrl and buildRepoPromptText,
// so we don't want their internal/downstream calls to logRepoPromptCall to run.
// However, the plan is that PullRow calls logRepoPromptCall.
// For testing buildRepoPromptText, we might want to assert it *doesn't* call logRepoPromptCall.
// For testing buildRepoPromptUrl, it definitely doesn't call it.
// Let's mock it here to prevent actual logging during tests.
vi.mock("../../src/lib/repoprompt", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/repoprompt")>();
  return {
    ...original,
    logRepoPromptCall: vi.fn(),
  };
});


describe("buildRepoPromptUrl", () => {
  beforeEach(() => {
    vi.spyOn(gh, "getPullRequestMeta").mockResolvedValue({
      branch: "fallback-branch",
      files: ["src/a.ts", "README.md"],
    });
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
    // No need to mock diff functions for buildRepoPromptUrl
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks(); // Clear all mocks, including logRepoPromptCall
  });

  it("should build a URL without prompt parameter", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      branch: "feature-branch",
      files: ["src/main.ts", "README.md"],
    });

    const { url } = await buildRepoPromptUrl(pull, "workspace", undefined);
    const urlObj = new URL(url);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.searchParams.has("prompt")).toBe(false);
    expect(urlObj.searchParams.get("workspace")).toBe("myrepo");
    // Updated expectation: URLSearchParams.get() decodes the value.
    expect(urlObj.searchParams.get("files")).toBe("src/main.ts,README.md");
    expect(logRepoPromptCall).not.toHaveBeenCalled();
  });

  it("should resolve metadata and include it in the return", async () => {
    const pull = mockPull({
      repo: "owner/anotherrepo",
      number: 456,
      branch: "", // To trigger meta fetch
      files: [], // To trigger meta fetch
    });
    vi.spyOn(gh, "getPullRequestMeta").mockResolvedValue({
      branch: "fetched-branch",
      files: ["file1.txt", "file2.js"],
    });

    const { url, resolvedMeta } = await buildRepoPromptUrl(
      pull,
      "folder",
      undefined,
    );

    expect(gh.getPullRequestMeta).toHaveBeenCalledWith(
      "owner",
      "anotherrepo",
      456,
      undefined,
    );
    expect(resolvedMeta.branch).toBe("fetched-branch");
    expect(resolvedMeta.files).toEqual(["file1.txt", "file2.js"]);
    expect(resolvedMeta.owner).toBe("owner");
    expect(resolvedMeta.repo).toBe("anotherrepo");
    expect(resolvedMeta.rootPath).toBe("/tmp/anotherrepo");

    const urlObj = new URL(url);
    expect(urlObj.pathname).toBe("/%2Ftmp%2Fanotherrepo"); // for folder mode
    expect(urlObj.searchParams.get("ephemeral")).toBe("true");
    // Updated expectation: URLSearchParams.get() decodes the value.
    expect(urlObj.searchParams.get("files")).toBe("file1.txt,file2.js");
  });
});

describe("buildRepoPromptText", () => {
  const mockResolvedMeta: ResolvedPullMeta = {
    owner: "owner",
    repo: "myrepo",
    branch: "feature-branch",
    files: ["src/main.ts", "README.md"],
    rootPath: "/tmp/myrepo",
  };

  beforeEach(() => {
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue(
      "dummy pr diff content",
    );
    // getPullRequestMeta is not called by buildRepoPromptText if meta is passed
    vi.spyOn(gh, "listPrCommits").mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue("TEST_BASE_PROMPT");
    // getDefaultRoot is not called by buildRepoPromptText if meta (with rootPath) is passed
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("should build prompt text with no diffs if options are empty", async () => {
    const pull = mockPull({
      repo: "owner/myrepo", // owner/repo here must match mockResolvedMeta for consistency
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      // Ensure mockPull provides a URL that might need fixing, or test will be trivial for the link part
      url: "https://github.com/owner/myrepo/123", // Example of a potentially incomplete URL
      branch: "feature-branch", // Must match mockResolvedMeta
      files: ["src/main.ts", "README.md"], // Must match mockResolvedMeta
    });

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      {},
      undefined,
      mockResolvedMeta,
    );

    expect(blocks.length).toBe(0);
    expect(promptText).toContain("## SETUP");
    expect(promptText).toContain("cd /tmp/myrepo");
    expect(promptText).toContain("git checkout feature-branch");
    expect(promptText).toContain("TEST_BASE_PROMPT");
    expect(promptText).toContain("### PR #123: My Test PR");
    expect(promptText).toContain("PR Body here.");
    // Expectation for the corrected link format
    expect(promptText).toContain("🔗 https://github.com/owner/myrepo/pull/123");
    expect(promptText).not.toContain("### FULL PR DIFF");
    expect(promptText).not.toContain("### LAST COMMIT");
    expect(promptText).not.toContain("dummy pr diff content");
    expect(promptText).not.toContain(
      "… (truncated, open PR in browser for full patch)",
    ); // No truncation
    expect(logRepoPromptCall).not.toHaveBeenCalled(); // buildRepoPromptText itself does not call logRepoPromptCall
  });

  it("should include full PR diff if specified", async () => {
    const pull = mockPull({
      number: 123,
      repo: "owner/myrepo",
      branch: "feature-branch",
      files: [],
    });
    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includePr: true },
      undefined,
      mockResolvedMeta,
    );

    expect(gh.getPullRequestDiff).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      123,
      undefined,
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0].header).toBe("### FULL PR DIFF");
    expect(blocks[0].patch).toBe("dummy pr diff content");
    expect(promptText).toContain("### FULL PR DIFF");
    expect(promptText).toContain("dummy pr diff content");
  });

  it("should include last commit diff if specified", async () => {
    const mockLastCommit = {
      sha: "lastsha1",
      commit: { message: "Last commit title" },
    } as PullRequestCommit;
    vi.spyOn(gh, "listPrCommits").mockResolvedValue([mockLastCommit]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue("diff for lastsha1");
    const pull = mockPull({
      number: 102,
      repo: "owner/myrepo",
      branch: "feature-branch",
      files: [],
    });

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includeLastCommit: true },
      undefined,
      mockResolvedMeta,
    );

    expect(gh.listPrCommits).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      102,
      1,
      undefined,
    );
    expect(gh.getCommitDiff).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      "lastsha1",
      undefined,
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0].header).toContain(
      '### LAST COMMIT (lastsha — "Last commit title")',
    );
    expect(blocks[0].patch).toBe("diff for lastsha1");
    expect(promptText).toContain(
      '### LAST COMMIT (lastsha — "Last commit title")',
    );
    expect(promptText).toContain("diff for lastsha1");
  });

  it("should include specific commits diff if specified", async () => {
    const specificCommits: PullRequestCommit[] = [
      { sha: "specsha1", commit: { message: "Specific commit ONE" } },
      { sha: "specsha2", commit: { message: "Specific commit TWO" } },
    ] as PullRequestCommit[];
    vi.spyOn(gh, "listPrCommits").mockResolvedValue(specificCommits);

    vi.spyOn(gh, "getCommitDiff")
      .mockResolvedValueOnce("diff for specsha1")
      .mockResolvedValueOnce("diff for specsha2");

    const pull = mockPull({
      repo: "owner/myrepo",
      number: 103,
      branch: "feature-branch",
      files: [],
    });
    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { commits: ["specsha1", "specsha2"] },
      undefined,
      mockResolvedMeta,
    );

    expect(gh.listPrCommits).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      103,
      250,
      undefined,
    );
    expect(gh.getCommitDiff).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      "specsha1",
      undefined,
    );
    expect(gh.getCommitDiff).toHaveBeenCalledWith(
      "owner",
      "myrepo",
      "specsha2",
      undefined,
    );
    expect(blocks.length).toBe(2);
    expect(promptText).toContain(
      '### COMMIT (specsha — "Specific commit ONE")',
    );
    expect(promptText).toContain("diff for specsha1");
    expect(promptText).toContain(
      '### COMMIT (specsha — "Specific commit TWO")',
    );
    expect(promptText).toContain("diff for specsha2");
  });

  it("should correctly order multiple diff blocks and not truncate", async () => {
    const mockCommitsForMessages: PullRequestCommit[] = [
      { sha: "lastsha", commit: { message: "Last commit title" } },
      { sha: "specsha", commit: { message: "Specific commit title" } },
    ] as PullRequestCommit[];
    // Mock for last commit call
    vi.spyOn(gh, "listPrCommits").mockImplementation(
      async (_owner, _repo, _pullNumber, limit) => {
        if (limit === 1)
          return [mockCommitsForMessages.find((c) => c.sha === "lastsha")!];
        return mockCommitsForMessages; // For specific commits message lookup
      },
    );

    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue(
      "FULL PR DIFF CONTENT",
    );
    vi.spyOn(gh, "getCommitDiff").mockImplementation(
      async (_owner, _repo, sha, _token) => {
        if (sha === "lastsha") return "LAST COMMIT DIFF CONTENT";
        if (sha === "specsha") return "SPECIFIC COMMIT DIFF CONTENT";
        return "";
      },
    );

    const longContent = "long content ".repeat(1000); // > 8000 chars
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue(longContent);

    const pull = mockPull({
      repo: "owner/myrepo",
      number: 300,
      branch: "feature-branch",
      files: [], // files array is empty, testing the removal of the guard
      url: "https://github.com/owner/myrepo/pull/300" // Provide a complete URL for this test case
    });
    const result = await buildRepoPromptText(
      pull,
      {
        includePr: true,
        includeLastCommit: true,
        commits: ["specsha"],
      },
      undefined,
      mockResolvedMeta,
    );
    const { promptText } = result;

    const fullPrIndex = promptText.indexOf("### FULL PR DIFF");
    const lastCommitIndex = promptText.indexOf("### LAST COMMIT (lastsha");
    const specificCommitIndex = promptText.indexOf("### COMMIT (specsha");

    expect(fullPrIndex).toBeGreaterThan(-1);
    expect(lastCommitIndex).toBeGreaterThan(-1);
    expect(specificCommitIndex).toBeGreaterThan(-1);

    expect(fullPrIndex).toBeLessThan(lastCommitIndex);
    expect(lastCommitIndex).toBeLessThan(specificCommitIndex);

    expect(promptText).toContain(longContent); // Check for full long content
    expect(promptText).not.toContain(
      "… (truncated, open PR in browser for full patch)",
    );
    expect(promptText).toContain("LAST COMMIT DIFF CONTENT");
    expect(promptText).toContain("SPECIFIC COMMIT DIFF CONTENT");
  });
});
// Remove old tests for buildRepoPromptLink that checked prompt encoding or diff content in the URL
// The old tests for buildRepoPromptLink are effectively split.
// Some parts are now covered by buildRepoPromptUrl (URL structure, no prompt).
// Other parts (diff content, prompt structure) are covered by buildRepoPromptText.
// The test "fills missing branch & files via getPullRequestMeta() and includes PR diff"
// would now be two separate tests:
// 1. buildRepoPromptUrl calls getPullRequestMeta if branch/files missing.
// 2. buildRepoPromptText (when meta is passed) correctly uses that meta, and if includePr, fetches diff.
// The provided tests for buildRepoPromptUrl and buildRepoPromptText cover these aspects.