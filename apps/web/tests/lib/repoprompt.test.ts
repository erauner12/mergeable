/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client"; // Import renamed type
import * as gh from "../../src/lib/github/client"; // ← stub network call
import {
  buildRepoPromptText,
  buildRepoPromptUrl,
  type ResolvedPullMeta,
  type CommentBlockInput,
} from "../../src/lib/repoprompt";
import * as repopromptModule from "../../src/lib/repoprompt"; // ADDED: Namespace import
import { isDiffBlock } from "../../src/lib/repoprompt.guards";
import * as settings from "../../src/lib/settings";
// Assuming mockPull is imported from a shared testing utility like "../testing"
import { mockPull } from "../testing";

// Mock logRepoPromptCall as it's now called by buildRepoPromptText or PullRow
// For these tests, we are testing buildRepoPromptUrl and buildRepoPromptText,
// so we don't want their internal/downstream calls to logRepoPromptCall to run.
// However, the plan is that PullRow calls logRepoPromptCall.
// For testing buildRepoPromptText, we might want to assert it *doesn't* call logRepoPromptCall.
// For testing buildRepoPromptUrl, it definitely doesn't call it.
// REMOVED: vi.mock for "../../src/lib/repoprompt"

// Mock fetchPullComments
// const mockFetchPullComments = vi.fn(); // OLD: Causes TDZ
// let mockFetchPullComments: ReturnType<typeof vi.fn>; // NEW: Declare with let
// We need this variable to exist *before* the hoisted factory runs, so use `var`
// (var-bindings are hoisted and initialised with `undefined`, removing the TDZ)
var mockFetchPullComments: ReturnType<typeof vi.fn>;

vi.mock("../../src/lib/github/client", async (importOriginal) => {
  const originalClient = await importOriginal<typeof import("../../src/lib/github/client")>();
  mockFetchPullComments = vi.fn(); // NEW: Initialize inside the factory
  return {
    ...originalClient,
    fetchPullComments: mockFetchPullComments, // Mock the new function
    // Keep existing mocks if gitHubClient instance is used directly, or mock its methods if used via instance
    // For this test, we are mocking specific functions from the module, so this should be fine.
    // If buildRepoPromptText uses an instance of gitHubClient, that instance's methods need mocking.
    // It seems buildRepoPromptText calls the module functions directly.
  };
});


describe("buildRepoPromptUrl", () => {
  let logRepoPromptCallSpy: ReturnType<typeof vi.spyOn>; // ADDED: Spy variable

  beforeEach(() => {
    vi.spyOn(gh, "getPullRequestMeta").mockResolvedValue({
      branch: "fallback-branch",
      files: ["src/a.ts", "README.md"],
    });
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
    // No need to mock diff functions for buildRepoPromptUrl
    // ADDED: Initialize spy
    logRepoPromptCallSpy = vi
      .spyOn(repopromptModule, "logRepoPromptCall")
      .mockImplementation(() => {});
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
    expect(logRepoPromptCallSpy).not.toHaveBeenCalled(); // UPDATED: Use spy
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
      undefined, // Add undefined for baseUrl
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
  let logRepoPromptCallSpy: ReturnType<typeof vi.spyOn>; // ADDED: Spy variable
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
    mockFetchPullComments.mockResolvedValue([]); // Default mock for new function
    vi.spyOn(gh, "listPrCommits").mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );
    // Old: repoPrompt pulled base prompt through getBasePrompt()
    // jest.spyOn(settings, "getBasePrompt")
    //     .mockResolvedValue("TEST_BASE_PROMPT");
    // New: it uses getPromptTemplate(mode)
    vi.spyOn(settings, "getPromptTemplate")
        .mockResolvedValue("TEST_BASE_PROMPT");
    // getDefaultRoot is not called by buildRepoPromptText if meta (with rootPath) is passed
    // ADDED: Initialize spy
    logRepoPromptCallSpy = vi
      .spyOn(repopromptModule, "logRepoPromptCall")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("should build prompt text with only PR details if options are empty", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      url: "https://github.com/owner/myrepo/pull/123",
      branch: "feature-branch",
      files: ["src/main.ts", "README.md"],
      author: { id: "u1", name: "testauthor", avatarUrl: "avatar.url", bot: false },
      createdAt: "2024-01-01T00:00:00Z",
    });

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      {}, // No diffs, no comments requested
      undefined,
      mockResolvedMeta,
    );

    expect(blocks.length).toBe(1); // Only PR details block
    expect(blocks[0].kind).toBe("comment");
    expect(blocks[0].id).toBe(`pr-details-${pull.id}`);
    expect((blocks[0] as CommentBlockInput).header).toContain("### PR #123 DETAILS: My Test PR");
    expect((blocks[0] as CommentBlockInput).commentBody).toBe("PR Body here.");

    expect(promptText).toContain("## SETUP");
    expect(promptText).toContain("cd /tmp/myrepo");
    expect(promptText).toContain("git checkout feature-branch");
    expect(promptText).toContain("TEST_BASE_PROMPT");
    expect(promptText).toContain("### PR #123 DETAILS: My Test PR"); // From PR details block
    expect(promptText).toContain("> _testauthor · 2024-Jan-01_"); // Formatted author/date
    expect(promptText).toContain("PR Body here.");
    expect(promptText).toContain("🔗 https://github.com/owner/myrepo/pull/123");
    expect(promptText).not.toContain("### FULL PR DIFF");
    expect(promptText).not.toContain("### LAST COMMIT");
    expect(mockFetchPullComments).not.toHaveBeenCalled();
    expect(logRepoPromptCallSpy).not.toHaveBeenCalled(); // UPDATED: Use spy
  });

  it("should include comments if specified, potentially as threads", async () => {
    const pull = mockPull({ number: 123, repo: "owner/myrepo", branch: "feature-branch", files: [] });
    // This mock data now represents what fetchPullComments would return:
    // already processed blocks, some of which could be threads.
    const mockCommentBlocks: CommentBlockInput[] = [
      {
        id: "thread-1-comment-abc", kind: "comment",
        header: "### THREAD ON src/file.ts#L10 (1 comment)",
        commentBody: "> _@author1 · Jan 01, 2024 00:00 UTC_\n\nBody 1", // Formatted by makeThreadBlock
        author: "author1", timestamp: "2024-01-01T00:00:00Z",
        threadId: "review-thread-1", diffHunk: "@@ -1,1 +1,1 @@\n-old line\n+new line",
        filePath: "src/file.ts", line: 10,
      },
      {
        id: "issue-2", kind: "comment",
        header: "### ISSUE COMMENT by @author2",
        commentBody: "Just a top-level comment.",
        author: "author2", timestamp: "2024-01-02T00:00:00Z",
        // No threadId or diffHunk for simple issue comments
      }
    ];
    mockFetchPullComments.mockResolvedValue(mockCommentBlocks);
    const endpoint = { auth: "token", baseUrl: "url" };

    const { blocks, promptText } = await buildRepoPromptText(
      pull,
      { includeComments: true }, // Comments are not initially selected for promptText by default
      endpoint,
      mockResolvedMeta,
    );

    expect(mockFetchPullComments).toHaveBeenCalledWith(endpoint, "owner", "myrepo", 123);
    expect(blocks.length).toBe(1 + mockCommentBlocks.length); // PR Details + mocked comment blocks

    const threadBlock = blocks.find(b => b.id === "thread-1-comment-abc");
    expect(threadBlock).toBeDefined();
    expect(threadBlock?.kind).toBe("comment");
    if (threadBlock?.kind === "comment") {
      expect(threadBlock.header).toBe("### THREAD ON src/file.ts#L10 (1 comment)");
      expect(threadBlock.diffHunk).toBe("@@ -1,1 +1,1 @@\n-old line\n+new line");
      expect(threadBlock.commentBody).toContain("> _@author1"); // Check for formatted body
    }
    
    const issueBlock = blocks.find(b => b.id === "issue-2");
    expect(issueBlock).toBeDefined();
    if (issueBlock?.kind === "comment") {
      expect(issueBlock.header).toBe("### ISSUE COMMENT by @author2");
      expect(issueBlock.diffHunk).toBeUndefined();
    }

    // Comments are not initially selected for promptText by default, so promptText shouldn't contain them
    // unless specifically handled by initial selection logic (which is not the case here).
    // The PR details block IS initially selected.
    expect(promptText).toContain("### PR #123 DETAILS");
    expect(promptText).not.toContain("### THREAD ON src/file.ts#L10");
    expect(promptText).not.toContain("@@ -1,1 +1,1 @@");
    expect(promptText).not.toContain("### ISSUE COMMENT by @author2");
  });


  it("should include full PR diff if specified, after PR details", async () => {
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
      undefined, // Add undefined for baseUrl
    );
    expect(blocks.length).toBe(2); // PR Details + PR Diff
    const diffBlock = blocks.find(b => b.kind === "diff"); // Find by kind first
    expect(diffBlock).toBeDefined();
    if (diffBlock && isDiffBlock(diffBlock)) {
      expect(diffBlock.id).toContain("diff-pr");
      expect(diffBlock.header).toBe("### FULL PR DIFF");
      expect(diffBlock.patch).toBe("dummy pr diff content");
    } else {
      throw new Error("Diff block not found or not of correct type");
    }
    
    // promptText contains initially selected blocks (PR details + PR diff)
    expect(promptText).toContain("### PR #123 DETAILS");
    expect(promptText).toContain("### FULL PR DIFF");
    expect(promptText).toContain("dummy pr diff content");
  });

  it("should correctly order PR details, comments (including threads), and diff blocks in the 'allPromptBlocks' array", async () => {
    const pull = mockPull({ number: 789, repo: "owner/myrepo", branch: "feature-branch", files: [] });
    const mockThreadBlock: CommentBlockInput = {
      id: "thread-1-comment-xyz", kind: "comment",
      header: "### THREAD ON main.py#L5 (1 comment)",
      commentBody: "> _@commenter · Jan 02, 2024 00:00 UTC_\n\nComment body",
      author: "commenter", timestamp: "2024-01-02T00:00:00Z",
      threadId: "review-thread-for-ordering", diffHunk: "diff hunk content",
      filePath: "main.py", line: 5,
    };
    mockFetchPullComments.mockResolvedValue([mockThreadBlock]);
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("PR DIFF CONTENT");
    const endpoint = { auth: "token", baseUrl: "url" };

    const { blocks } = await buildRepoPromptText(
      pull,
      // includeComments: true means they are fetched and added to `allPromptBlocks`
      // includePr: true means PR diff is fetched and added to `allPromptBlocks` and `initiallySelectedBlocks`
      { includeComments: true, includePr: true },
      endpoint,
      mockResolvedMeta
    );

    // Order in allPromptBlocks: PR Details, then Comments, then Diffs
    expect(blocks.length).toBe(3); // PR Details, Comment Thread, PR Diff
    expect(blocks[0].id).toContain("pr-details"); // PR Details always first
    expect(blocks[1].id).toBe("thread-1-comment-xyz"); // Then comments
    expect(blocks[2].id).toContain("diff-pr"); // Then diffs
  });

// ... (keep and adapt other diff-related tests, ensuring they check for block.kind === 'diff' and correct IDs) ...

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

    const { blocks } = await buildRepoPromptText(
      pull,
      { includeLastCommit: true },
      undefined,
      mockResolvedMeta,
    );
    
    const diffBlock = blocks.find(b => b.id === `diff-last-commit-${mockLastCommit.sha}`);
    expect(diffBlock).toBeDefined();
    if (diffBlock && isDiffBlock(diffBlock)) {
      expect(diffBlock.header).toContain('### LAST COMMIT (lastsha — "Last commit title")');
      expect(diffBlock.patch).toBe("diff for lastsha1");
    } else {
      throw new Error("Last commit diff block not found or not of correct type");
    }
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
    const { blocks } = await buildRepoPromptText(
      pull,
      { commits: ["specsha1", "specsha2"] },
      undefined,
      mockResolvedMeta,
    );

    const diffBlock1 = blocks.find(b => b.id === `diff-commit-specsha1`);
    expect(diffBlock1).toBeDefined();
    if (diffBlock1 && isDiffBlock(diffBlock1)) {
      expect(diffBlock1.header).toContain('### COMMIT (specsha — "Specific commit ONE")');
      expect(diffBlock1.patch).toBe("diff for specsha1");
    } else {
      throw new Error("Specific commit diff block 1 not found or not of correct type");
    }

    const diffBlock2 = blocks.find(b => b.id === `diff-commit-specsha2`);
    expect(diffBlock2).toBeDefined();
    if (diffBlock2 && isDiffBlock(diffBlock2)) {
      expect(diffBlock2.header).toContain('### COMMIT (specsha — "Specific commit TWO")');
      expect(diffBlock2.patch).toBe("diff for specsha2");
    } else {
      throw new Error("Specific commit diff block 2 not found or not of correct type");
    }
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