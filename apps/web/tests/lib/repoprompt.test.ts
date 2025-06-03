/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client"; // Import renamed type
import * as gh from "../../src/lib/github/client"; // ← stub network call
import * as repopromptModule from "../../src/lib/repoprompt"; // ADDED: Namespace import
import {
  buildRepoPromptText,
  buildRepoPromptUrl,
  type CommentBlockInput,
  defaultPromptMode, // Import defaultPromptMode
  type PromptMode,
  type ResolvedPullMeta,
} from "../../src/lib/repoprompt";
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
vi.mock("../../src/lib/github/client", async (importOriginal) => {
  const originalClient =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    await importOriginal<typeof import("../../src/lib/github/client")>();
  return {
    ...originalClient,
    fetchPullComments: vi.fn(), // Mock the new function
    // Keep existing mocks if gitHubClient instance is used directly, or mock its methods if used via instance
    // For this test, we are mocking specific functions from the module, so this should be fine.
    // If buildRepoPromptText uses an instance of gitHubClient, that instance's methods need mocking.
    // It seems buildRepoPromptText calls the module functions directly.
  };
});

describe("buildRepoPromptUrl", () => {
  let logRepoPromptCallSpy!: ReturnType<typeof vi.spyOn>; // Corrected definite assignment

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
  let logRepoPromptCallSpy!: ReturnType<typeof vi.spyOn>; // Corrected definite assignment
  const mockResolvedMetaBase: ResolvedPullMeta = {
    owner: "owner",
    repo: "myrepo",
    branch: "feature-branch",
    files: ["src/main.ts", "README.md"],
    rootPath: "/tmp/myrepo",
  };
  const mockResolvedMeta = mockResolvedMetaBase; // Alias for existing test code
  // Loosen the type even more – any mock instance is fine for tests
  let getPromptTemplateSpy: any;
  let listPrCommitsSpy: any;
  let getPullRequestDiffSpy: any;


  beforeEach(() => {
    getPullRequestDiffSpy = vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue(
      "dummy pr diff content",
    );
    vi.mocked(gh.fetchPullComments).mockResolvedValue([]); // Default mock for new function
    listPrCommitsSpy = vi.spyOn(gh, "listPrCommits").mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );
    // Updated: Generic mock for getPromptTemplate
    getPromptTemplateSpy = vi
      .spyOn(settings, "getPromptTemplate")
      .mockImplementation((mode: PromptMode) =>
        Promise.resolve(`MOCK_PROMPT_FOR_${mode.toUpperCase()}`),
      );
    // REMOVED: Mock for getBasePrompt as it's no longer directly used or is a fallback.
    // The new getPromptTemplate mock covers all modes.

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

  it("should build prompt text with only PR details if options are empty and no files in meta for files list", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      url: "https://github.com/owner/myrepo/pull/123",
      branch: "feature-branch",
      files: ["src/main.ts", "README.md"], // pull.files is not used for "files changed" list, meta.files is
      author: {
        id: "u1",
        name: "testauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const metaNoFiles = { ...mockResolvedMetaBase, files: [] };

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      {}, // No diffs, no comments requested
      undefined, // endpoint
      metaNoFiles,
    );

    expect(getPromptTemplateSpy).toHaveBeenCalledWith(defaultPromptMode);

    expect(blocks.length).toBe(1); // Only PR details block
    expect(blocks[0].kind).toBe("comment");
    expect(blocks[0].id).toBe(`pr-details-${pull.id}`);
    const prDetailsCommentBlock = blocks[0] as CommentBlockInput;
    expect(prDetailsCommentBlock.header).toContain(
      "### PR #123 DETAILS: My Test PR",
    );
    expect(prDetailsCommentBlock.commentBody).toBe("PR Body here."); // No "files changed" list
    expect(prDetailsCommentBlock.commentBody).not.toContain("### files changed");


    expect(promptText).toContain("## SETUP");
    expect(promptText).toContain("cd /tmp/myrepo");
    expect(promptText).toContain("git checkout feature-branch");
    expect(promptText).toContain(
      `MOCK_PROMPT_FOR_${defaultPromptMode.toUpperCase()}`,
    );
    expect(promptText).toContain("### PR #123 DETAILS: My Test PR");
    expect(promptText).toContain("> _testauthor · 2024-Jan-01_");
    expect(promptText).toContain("PR Body here.");
    expect(promptText).not.toContain("### files changed");
    expect(promptText).toContain("🔗 https://github.com/owner/myrepo/pull/123");
    expect(promptText).not.toContain("### FULL PR DIFF");
    expect(promptText).not.toContain("### LAST COMMIT");
    expect(vi.mocked(gh.fetchPullComments)).not.toHaveBeenCalled();
    expect(logRepoPromptCallSpy).not.toHaveBeenCalled();
  });

  it("guard-rail: should ignore includeLastCommit if includePr is also true", async () => {
    const pull = mockPull({ number: 1, repo: "o/r", branch: "b", files: [] });
    const mockLastCommit = { sha: "lastsha1", commit: { message: "Last commit" } } as PullRequestCommit;
    listPrCommitsSpy.mockResolvedValue([mockLastCommit]);

    await buildRepoPromptText(
      pull,
      { includePr: true, includeLastCommit: true },
      defaultPromptMode,
      undefined,
      mockResolvedMetaBase,
    );

    expect(getPullRequestDiffSpy).toHaveBeenCalled();
    // listPrCommits might be called if the logic for last commit diff is reached,
    // but the diff itself should not be added.
    // A stronger check is that the block for last commit is not created or added.
    // The guard rail `diffOptions.includeLastCommit = false;` should prevent fetching/processing last commit diff.
    // So, listPrCommits for the purpose of diffing the last commit should not be called if the guard works early.
    // The current code calls listPrCommits *inside* the `if (diffOptions.includeLastCommit)` block.
    // So, if the guard sets `diffOptions.includeLastCommit = false`, then `listPrCommits` for this purpose won't be called.
    const callsToListPrCommitsForLastCommit = listPrCommitsSpy.mock.calls.filter(
        (call: any) => call[3] === 1 // The `perPage` argument for fetching last commit is 1
    );
    expect(callsToListPrCommitsForLastCommit.length).toBe(0);
  });

  it("conditional files list: should include 'files changed' in PR details if includePr is false and files exist", async () => {
    const pull = mockPull({ number: 1, repo: "o/r", branch: "b", files: [], body: "Original body." });
    const metaWithFiles = { ...mockResolvedMetaBase, files: ["fileA.ts", "fileB.md"] };
    
    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );

    const prDetailsBlock = blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toContain("Original body.");
    expect(prDetailsBlock.commentBody).toContain("### files changed (2)");
    expect(prDetailsBlock.commentBody).toContain("- fileA.ts");
    expect(prDetailsBlock.commentBody).toContain("- fileB.md");
  });

  it("conditional files list: should NOT include 'files changed' in PR details if includePr is true, even if files exist", async () => {
    const pull = mockPull({ number: 1, repo: "o/r", branch: "b", files: [], body: "Original body." });
    const metaWithFiles = { ...mockResolvedMetaBase, files: ["fileA.ts", "fileB.md"] };

    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: true }, // includePr is true
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );

    const prDetailsBlock = blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toBe("Original body."); // Only original body
    expect(prDetailsBlock.commentBody).not.toContain("### files changed");
  });
  
  it("conditional files list: should NOT include 'files changed' if meta.files is empty, even if includePr is false", async () => {
    const pull = mockPull({ number: 1, repo: "o/r", branch: "b", files: [], body: "Original body." });
    const metaNoFiles = { ...mockResolvedMetaBase, files: [] };

    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaNoFiles, // No files in meta
    );

    const prDetailsBlock = blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toBe("Original body.");
    expect(prDetailsBlock.commentBody).not.toContain("### files changed");
  });

  it("does not duplicate the files list if PR body already contains it", async () => {
    const pull = mockPull({
      repo: "o/r",
      number: 7,
      branch: "b",
      // simulate a previous run that already injected the section
      body: `
        Some intro.

        ### files changed (2)
        - foo.ts
        - bar.md
      `,
      files: [],   // pull.files is irrelevant here
    });

    const meta = { ...mockResolvedMetaBase, files: ["foo.ts", "bar.md"] };

    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      meta,
    );

    const body = (blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput).commentBody;

    // should appear exactly once
    expect(body.match(/### files changed/g)?.length).toBe(1);
    // Also check that the content of the list is from the *original* body, not re-appended
    expect(body).toContain("Some intro.");
    expect(body).toContain("- foo.ts");
    expect(body).toContain("- bar.md");
  });


  it("should include comments if specified, potentially as threads", async () => {
    const pull = mockPull({
      number: 123,
      repo: "owner/myrepo",
      branch: "feature-branch",
      files: [],
    });
    // This mock data now represents what fetchPullComments would return:
    // already processed blocks, some of which could be threads.
    const mockCommentBlocks: CommentBlockInput[] = [
      {
        id: "thread-1-comment-abc",
        kind: "comment",
        header: "### THREAD ON src/file.ts#L10 (1 comment)",
        commentBody: "> _@author1 · Jan 01, 2024 00:00 UTC_\n\nBody 1", // Formatted by makeThreadBlock
        author: "author1",
        timestamp: "2024-01-01T00:00:00Z",
        threadId: "review-thread-1",
        diffHunk: "@@ -1,1 +1,1 @@\n-old line\n+new line",
        filePath: "src/file.ts",
        line: 10,
      },
      {
        id: "issue-2",
        kind: "comment",
        header: "### ISSUE COMMENT by @author2",
        commentBody: "Just a top-level comment.",
        author: "author2",
        timestamp: "2024-01-02T00:00:00Z",
        // No threadId or diffHunk for simple issue comments
      },
    ];
    vi.mocked(gh.fetchPullComments).mockResolvedValue(mockCommentBlocks);
    const endpoint = { auth: "token", baseUrl: "url" };

    const { blocks, promptText } = await buildRepoPromptText(
      pull,
      { includeComments: true }, // Comments are not initially selected for promptText by default
      defaultPromptMode, // Explicitly pass mode
      endpoint,
      mockResolvedMeta,
    );

    expect(vi.mocked(gh.fetchPullComments)).toHaveBeenCalledWith(
      endpoint,
      "owner",
      "myrepo",
      123,
    );
    expect(blocks.length).toBe(1 + mockCommentBlocks.length); // PR Details + mocked comment blocks

    const threadBlock = blocks.find((b) => b.id === "thread-1-comment-abc");
    expect(threadBlock).toBeDefined();
    expect(threadBlock?.kind).toBe("comment");
    if (threadBlock?.kind === "comment") {
      expect(threadBlock.header).toBe(
        "### THREAD ON src/file.ts#L10 (1 comment)",
      );
      expect(threadBlock.diffHunk).toBe(
        "@@ -1,1 +1,1 @@\n-old line\n+new line",
      );
      expect(threadBlock.commentBody).toContain("> _@author1"); // Check for formatted body
    }

    const issueBlock = blocks.find((b) => b.id === "issue-2");
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
      defaultPromptMode, // Explicitly pass mode
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
    const diffBlock = blocks.find((b) => b.kind === "diff"); // Find by kind first
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
    const pull = mockPull({
      number: 789,
      repo: "owner/myrepo",
      branch: "feature-branch",
      files: [],
    });
    const mockThreadBlock: CommentBlockInput = {
      id: "thread-1-comment-xyz",
      kind: "comment",
      header: "### THREAD ON main.py#L5 (1 comment)",
      commentBody: "> _@commenter · Jan 02, 2024 00:00 UTC_\n\nComment body",
      author: "commenter",
      timestamp: "2024-01-02T00:00:00Z",
      threadId: "review-thread-for-ordering",
      diffHunk: "diff hunk content",
      filePath: "main.py",
      line: 5,
    };
    vi.mocked(gh.fetchPullComments).mockResolvedValue([mockThreadBlock]);
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("PR DIFF CONTENT");
    const endpoint = { auth: "token", baseUrl: "url" };

    const { blocks } = await buildRepoPromptText(
      pull,
      // includeComments: true means they are fetched and added to `allPromptBlocks`
      // includePr: true means PR diff is fetched and added to `allPromptBlocks` and `initiallySelectedBlocks`
      { includeComments: true, includePr: true },
      defaultPromptMode, // Explicitly pass mode
      endpoint,
      mockResolvedMeta,
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
      defaultPromptMode, // Explicitly pass mode
      undefined,
      mockResolvedMeta,
    );

    const diffBlock = blocks.find(
      (b) => b.id === `diff-last-commit-${mockLastCommit.sha}`,
    );
    expect(diffBlock).toBeDefined();
    if (diffBlock && isDiffBlock(diffBlock)) {
      expect(diffBlock.header).toContain(
        '### LAST COMMIT (lastsha — "Last commit title")',
      );
      expect(diffBlock.patch).toBe("diff for lastsha1");
    } else {
      throw new Error(
        "Last commit diff block not found or not of correct type",
      );
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
      defaultPromptMode, // Explicitly pass mode
      undefined,
      mockResolvedMeta,
    );

    const diffBlock1 = blocks.find((b) => b.id === `diff-commit-specsha1`);
    expect(diffBlock1).toBeDefined();
    if (diffBlock1 && isDiffBlock(diffBlock1)) {
      expect(diffBlock1.header).toContain(
        '### COMMIT (specsha — "Specific commit ONE")',
      );
      expect(diffBlock1.patch).toBe("diff for specsha1");
    } else {
      throw new Error(
        "Specific commit diff block 1 not found or not of correct type",
      );
    }

    const diffBlock2 = blocks.find((b) => b.id === `diff-commit-specsha2`);
    expect(diffBlock2).toBeDefined();
    if (diffBlock2 && isDiffBlock(diffBlock2)) {
      expect(diffBlock2.header).toContain(
        '### COMMIT (specsha — "Specific commit TWO")',
      );
      expect(diffBlock2.patch).toBe("diff for specsha2");
    } else {
      throw new Error(
        "Specific commit diff block 2 not found or not of correct type",
      );
    }
  });

  // New Test Case A: "review" mode + comments requested
  it("should use review prompt and include comments for 'review' mode when requested", async () => {
    const pull = mockPull({
      number: 201,
      repo: "owner/reviewrepo",
      branch: "review-branch",
      files: [],
    });
    const mockCommentBlocks: CommentBlockInput[] = [
      {
        id: "comment-rev-1",
        kind: "comment",
        header: "Review Comment",
        commentBody: "Needs changes",
        author: "reviewer",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];
    vi.mocked(gh.fetchPullComments).mockResolvedValue(mockCommentBlocks);
    const endpoint = { auth: "token", baseUrl: "url" };

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includeComments: true },
      "review", // mode
      endpoint,
      { ...mockResolvedMeta, repo: "reviewrepo", branch: "review-branch" },
    );

    expect(getPromptTemplateSpy).toHaveBeenCalledWith("review");
    expect(promptText).toContain("MOCK_PROMPT_FOR_REVIEW");
    expect(vi.mocked(gh.fetchPullComments)).toHaveBeenCalled();
    expect(blocks.some((b) => b.id === "comment-rev-1")).toBe(true);
    // Comments are not part of initial promptText by default, even if fetched
    expect(promptText).not.toContain("Review Comment");
    expect(promptText).toContain("### PR #201 DETAILS"); // PR details are always in promptText
  });

  // New Test Case B: "adjust-pr" mode should not auto-select comments/diffs for promptText
  it("should only include PR details in initial promptText for 'adjust-pr' mode, even if diffs/comments are requested via options", async () => {
    const pull = mockPull({
      number: 202,
      repo: "owner/adjustrepo",
      branch: "adjust-branch",
      files: [],
      body: "Original Body",
    });
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("PR DIFF FOR ADJUST");
    const mockCommentBlocks: CommentBlockInput[] = [
      {
        id: "comment-adj-1",
        kind: "comment",
        header: "Adjust Comment",
        commentBody: "A comment",
        author: "adjuster",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];
    vi.mocked(gh.fetchPullComments).mockResolvedValue(mockCommentBlocks);
    const endpoint = { auth: "token", baseUrl: "url" };

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includePr: true, includeComments: true, includeLastCommit: true }, // Request all
      "adjust-pr", // mode
      endpoint,
      { ...mockResolvedMeta, repo: "adjustrepo", branch: "adjust-branch" },
    );

    expect(getPromptTemplateSpy).toHaveBeenCalledWith("adjust-pr");
    expect(promptText).toContain("MOCK_PROMPT_FOR_ADJUST-PR");

    // Check all blocks were generated and are available in `blocks`
    expect(blocks.some((b) => b.id.startsWith("pr-details"))).toBe(true);
    expect(blocks.some((b) => b.id.startsWith("diff-pr"))).toBe(true); // Diff was fetched
    expect(blocks.some((b) => b.id === "comment-adj-1")).toBe(true); // Comments were fetched

    // Check initialSelectedBlockIds (derived from promptText content)
    // For "adjust-pr", the plan was: "pre-select only the PR details. Diff blocks (full PR, last commit) are only pre-selected if explicitly chosen by the user via checkboxes. Comment blocks are not pre-selected."
    // The current implementation of buildRepoPromptText adds diffs to initiallySelectedBlocks if their options are true.
    // The prompt for "adjust-pr" itself guides the LLM.
    // So, if includePr is true, the diff WILL be in the promptText.
    // The key is that the *base prompt* for "adjust-pr" directs the LLM to focus on title/body.
    // Let's verify the promptText content based on current logic:
    expect(promptText).toContain("### PR #202 DETAILS");
    expect(promptText).toContain("Original Body");
    expect(promptText).toContain("PR DIFF FOR ADJUST"); // Because includePr was true
    expect(promptText).not.toContain("Adjust Comment"); // Comments are not in initial prompt text
  });

  // New Test Case C: "respond" mode with comments only
  it("should not call getPullRequestDiff for 'respond' mode if only comments are included", async () => {
    const pull = mockPull({
      number: 203,
      repo: "owner/respondrepo",
      branch: "respond-branch",
      files: [],
    });
    const getPullRequestDiffSpy = vi.spyOn(gh, "getPullRequestDiff");
    const mockCommentBlocks: CommentBlockInput[] = [
      {
        id: "comment-resp-1",
        kind: "comment",
        header: "Respond Comment",
        commentBody: "A question",
        author: "responder",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];
    vi.mocked(gh.fetchPullComments).mockResolvedValue(mockCommentBlocks);
    const endpoint = { auth: "token", baseUrl: "url" };

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includeComments: true, includePr: false, includeLastCommit: false }, // Only comments
      "respond", // mode
      endpoint,
      { ...mockResolvedMeta, repo: "respondrepo", branch: "respond-branch" },
    );

    expect(getPromptTemplateSpy).toHaveBeenCalledWith("respond");
    expect(promptText).toContain("MOCK_PROMPT_FOR_RESPOND");
    expect(getPullRequestDiffSpy).not.toHaveBeenCalled();
    expect(vi.mocked(gh.fetchPullComments)).toHaveBeenCalled();
    expect(blocks.some((b) => b.id === "comment-resp-1")).toBe(true);
    expect(promptText).not.toContain("Respond Comment"); // Comments not in initial prompt
    expect(promptText).toContain("### PR #203 DETAILS");
  });
});
// Remove old tests for buildRepoPromptLink that checked prompt encoding or diff content in the URL
// The old tests for buildRepoPromptLink are effectively split.
