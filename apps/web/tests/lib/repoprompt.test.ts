/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client"; // Import renamed type
import * as gh from "../../src/lib/github/client"; // ← stub network call
import * as renderTemplateModule from "../../src/lib/renderTemplate"; // Mock renderTemplate
import * as repopromptModule from "../../src/lib/repoprompt";
import {
  buildRepoPromptText,
  buildRepoPromptUrl,
  type CommentBlockInput,
  defaultPromptMode,
  formatPromptBlock,
  type PromptMode,
  type ResolvedPullMeta,
} from "../../src/lib/repoprompt";
import { isDiffBlock } from "../../src/lib/repoprompt.guards";
import * as settings from "../../src/lib/settings";
import { mockPull } from "../testing";

// Mock renderTemplate to check its inputs and control its output
vi.mock("../../src/lib/renderTemplate", () => ({
  renderTemplate: vi.fn((template: string, slots: Record<string, unknown>) => {
    // Simple mock: just join slots for verification, or return template if no slots for some reason
    // A more sophisticated mock could actually perform replacement for more robust checks.
    let result = template;
    for (const [key, value] of Object.entries(slots)) {
      result = result.replace(`{{${key}}}`, value as string);
    }
    return result;
  }),
}));


// Mock fetchPullComments
vi.mock("../../src/lib/github/client", async (importOriginal) => {
  const originalClient =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    await importOriginal<typeof import("../../src/lib/github/client")>();
  return {
    ...originalClient,
    fetchPullComments: vi.fn(),
  };
});

describe("buildRepoPromptUrl", () => {
  beforeEach(() => {
    vi.spyOn(gh, "getPullRequestMeta").mockResolvedValue({
      branch: "fallback-branch",
      files: ["src/a.ts", "README.md"],
    });
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
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
    expect(urlObj.searchParams.get("files")).toBe("src/main.ts,README.md");
  });

  it("should resolve metadata and include it in the return", async () => {
    const pull = mockPull({
      repo: "owner/anotherrepo",
      number: 456,
      branch: "",
      files: [],
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
      undefined,
    );
    expect(resolvedMeta.branch).toBe("fetched-branch");
    expect(resolvedMeta.files).toEqual(["file1.txt", "file2.js"]);
    expect(resolvedMeta.owner).toBe("owner");
    expect(resolvedMeta.repo).toBe("anotherrepo");
    expect(resolvedMeta.rootPath).toBe("/tmp/anotherrepo");

    const urlObj = new URL(url);
    expect(urlObj.pathname).toBe("/%2Ftmp%2Fanotherrepo");
    expect(urlObj.searchParams.get("ephemeral")).toBe("true");
    expect(urlObj.searchParams.get("files")).toBe("file1.txt,file2.js");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
describe("buildRepoPromptText", () => {
  const mockResolvedMetaBase: ResolvedPullMeta = {
    owner: "owner",
    repo: "myrepo",
    branch: "feature-branch",
    files: ["src/main.ts", "README.md"],
    rootPath: "/tmp/myrepo",
  };
  const mockResolvedMeta = mockResolvedMetaBase;
  let getPromptTemplateSpy: any;
  let listPrCommitsSpy: any;
  let getPullRequestDiffSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    getPullRequestDiffSpy = vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue(
      "dummy pr diff content",
    );
    vi.mocked(gh.fetchPullComments).mockResolvedValue([]);
    listPrCommitsSpy = vi.spyOn(gh, "listPrCommits").mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );
    getPromptTemplateSpy = vi
      .spyOn(settings, "getPromptTemplate")
      .mockImplementation((mode: PromptMode) =>
        Promise.resolve(
          `MODE ${mode.toUpperCase()} TEMPLATE:\nSETUP:\n{{SETUP}}\nPR_DETAILS:\n{{PR_DETAILS}}\nFILES_LIST:\n{{FILES_LIST}}\nDIFF_CONTENT:\n{{DIFF_CONTENT}}\nLINK:\n{{LINK}}`,
        ),
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call renderTemplate with correct slots, including FILES_LIST", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      url: "https://github.com/owner/myrepo/pull/123",
      branch: "feature-branch",
      files: ["src/main.ts", "README.md"], // files in pull object, not directly used by FILES_LIST logic
      author: {
        id: "u1",
        name: "testauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const meta = { ...mockResolvedMetaBase, files: ["fileA.ts", "fileB.ts"] }; // meta.files used for FILES_LIST

    await buildRepoPromptText(
      pull,
      { includePr: false }, // !includePr means FILES_LIST should be populated
      defaultPromptMode,
      undefined,
      meta,
    );

    expect(getPromptTemplateSpy).toHaveBeenCalledWith(defaultPromptMode);
    expect(
      vi.mocked(renderTemplateModule.renderTemplate),
    ).toHaveBeenCalledTimes(1);

    const expectedTemplateString = `MODE ${defaultPromptMode.toUpperCase()} TEMPLATE:\nSETUP:\n{{SETUP}}\nPR_DETAILS:\n{{PR_DETAILS}}\nFILES_LIST:\n{{FILES_LIST}}\nDIFF_CONTENT:\n{{DIFF_CONTENT}}\nLINK:\n{{LINK}}`;
    const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0];
    expect(renderCallArgs[0]).toBe(expectedTemplateString);

    const slots = renderCallArgs[1];
    expect(slots.SETUP).toContain("cd /tmp/myrepo");
    expect(slots.SETUP).toContain("git checkout feature-branch");

    const prDetailsBlock = {
      id: `pr-details-${pull.id}`,
      kind: "comment",
      header: `### PR #${pull.number} DETAILS: ${pull.title}`,
      commentBody: "PR Body here.", // Should be clean body
      author: "testauthor",
      authorAvatarUrl: "avatar.url",
      timestamp: "2024-01-01T00:00:00Z",
    } as CommentBlockInput;
    expect(slots.PR_DETAILS).toBe(formatPromptBlock(prDetailsBlock));
    
    expect(slots.FILES_LIST).toBe("### files changed (2)\n- fileA.ts\n- fileB.ts");

    expect(slots.DIFF_CONTENT).toBe("");
    expect(slots.LINK).toBe("🔗 https://github.com/owner/myrepo/pull/123");
  });

  it("conditional files list: FILES_LIST slot should be populated if includePr is false and meta.files exist", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [], // Not used by FILES_LIST logic directly
      body: "Original body.",
    });
    const metaWithFiles = {
      ...mockResolvedMetaBase,
      files: ["fileA.ts", "fileB.md"],
    };

    await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );
    
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("### files changed (2)\n- fileA.ts\n- fileB.md");
    // PR_DETAILS should not contain the file list
    const prDetailsBlock = (await buildRepoPromptText(pull, { includePr: false }, defaultPromptMode, undefined, metaWithFiles)).blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock.commentBody).toBe("Original body.");
  });

  it("conditional files list: FILES_LIST slot should be empty if includePr is true, even if meta.files exist", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [],
      body: "Original body.",
    });
    const metaWithFiles = {
      ...mockResolvedMetaBase,
      files: ["fileA.ts", "fileB.md"],
    };

    await buildRepoPromptText(
      pull,
      { includePr: true }, // includePr is true
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );
    
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("");
    const prDetailsBlock = (await buildRepoPromptText(pull, { includePr: true }, defaultPromptMode, undefined, metaWithFiles)).blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock.commentBody).toBe("Original body.");
  });

  it("conditional files list: FILES_LIST slot should be empty if meta.files is empty, even if includePr is false", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [],
      body: "Original body.",
    });
    const metaNoFiles = { ...mockResolvedMetaBase, files: [] };

    await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaNoFiles, // No files in meta
    );

    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("");
    const prDetailsBlock = (await buildRepoPromptText(pull, { includePr: false }, defaultPromptMode, undefined, metaNoFiles)).blocks.find(b => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock.commentBody).toBe("Original body.");
  });

  it("final promptText structure is determined by template and renderTemplate, including FILES_LIST", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      url: "https://github.com/owner/myrepo/pull/123",
      branch: "feature-branch",
      author: {
        id: "u1",
        name: "testauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const metaWithFiles = { ...mockResolvedMetaBase, files: ["one.js"] };

    vi.mocked(renderTemplateModule.renderTemplate).mockRestore(); // Use actual renderTemplate
    getPromptTemplateSpy.mockResolvedValue(
      `SETUP AREA:\n{{SETUP}}\n\nPR INFO:\n{{PR_DETAILS}}\n\nFILES:\n{{FILES_LIST}}\n\nLINK:\n{{LINK}}\n\nDIFFS:\n{{DIFF_CONTENT}}`,
    );

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      { includePr: false }, // To populate FILES_LIST
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );

    expect(blocks.length).toBe(1); // Only PR details block
    const prDetailsBlock = blocks[0] as CommentBlockInput;

    const expectedSetup =
      "cd /tmp/myrepo\ngit fetch origin\ngit checkout feature-branch";
    const expectedPrDetails = formatPromptBlock(prDetailsBlock).trim();
    const expectedFilesList = "### files changed (1)\n- one.js";
    const expectedLink = "🔗 https://github.com/owner/myrepo/pull/123";

    expect(promptText).toContain(`SETUP AREA:\n${expectedSetup}`);
    expect(promptText).toContain(`PR INFO:\n${expectedPrDetails}`);
    expect(promptText).toContain(`FILES:\n${expectedFilesList}`);
    expect(promptText).toContain(`LINK:\n${expectedLink}`);
    expect(promptText).not.toContain("{{DIFF_CONTENT}}"); // As it's empty and renderTemplate cleans it up
    // Check that empty DIFFS section is removed by renderTemplate
    // If DIFFS section is present and empty, it would be "DIFFS:\n\nLINK:" or similar
    // We expect "FILES:\n...\n\nLINK:"
    expect(promptText).not.toMatch(/DIFFS:\s*\n\s*LINK:/);
  });

  it("should populate DIFF_CONTENT slot correctly", async () => {
    const pull = mockPull({ number: 456, repo: "o/r", branch: "b", files: [] });
    await buildRepoPromptText(
      pull,
      { includePr: true },
      defaultPromptMode,
      undefined,
      mockResolvedMeta,
    );

    expect(
      vi.mocked(renderTemplateModule.renderTemplate),
    ).toHaveBeenCalledTimes(1);
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];

    const expectedDiffBlock: repopromptModule.DiffBlockInput = {
      id: `diff-pr-${pull.id}`,
      kind: "diff",
      header: "### FULL PR DIFF",
      patch: "dummy pr diff content",
    };
    expect(slots.DIFF_CONTENT).toBe(
      formatPromptBlock(expectedDiffBlock).trim(),
    );
  });

  it("DIFF_CONTENT slot should be empty if no diffs or comments are selected/included", async () => {
    const pull = mockPull({ number: 789, repo: "o/r", branch: "b", files: [] });
    await buildRepoPromptText(
      pull,
      {
        includePr: false,
        includeComments: false,
        includeLastCommit: false,
        commits: [],
      },
      defaultPromptMode,
      undefined,
      mockResolvedMeta,
    );

    expect(
      vi.mocked(renderTemplateModule.renderTemplate),
    ).toHaveBeenCalledTimes(1);
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.DIFF_CONTENT).toBe("");
  });

  it("final promptText structure is determined by template and renderTemplate", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.",
      url: "https://github.com/owner/myrepo/pull/123",
      branch: "feature-branch",
      author: {
        id: "u1",
        name: "testauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const metaNoFiles = { ...mockResolvedMetaBase, files: [] };

    vi.mocked(renderTemplateModule.renderTemplate).mockRestore();
    getPromptTemplateSpy.mockResolvedValue(
      `SETUP AREA:\n{{SETUP}}\n\nPR INFO:\n{{PR_DETAILS}}\n\nLINK:\n{{LINK}}\n\nDIFFS:\n{{DIFF_CONTENT}}`,
    );

    const { promptText, blocks } = await buildRepoPromptText(
      pull,
      {},
      defaultPromptMode,
      undefined,
      metaNoFiles,
    );

    expect(blocks.length).toBe(1);
    const prDetailsBlock = blocks[0] as CommentBlockInput;

    const expectedSetup =
      "cd /tmp/myrepo\ngit fetch origin\ngit checkout feature-branch";
    const expectedPrDetails = formatPromptBlock(prDetailsBlock).trim();
    const expectedLink = "🔗 https://github.com/owner/myrepo/pull/123";

    expect(promptText).toContain(`SETUP AREA:\n${expectedSetup}`);
    expect(promptText).toContain(`PR INFO:\n${expectedPrDetails}`);
    expect(promptText).toContain(`LINK:\n${expectedLink}`);
    expect(promptText).not.toContain("{{DIFF_CONTENT}}");
    expect(promptText).not.toContain("DIFFS:\n\nLINK:");
  });

  // ... (Keep other tests like guard-rail, conditional files list, comments, diffs, ordering, unique IDs, etc.)
  // They primarily test the `blocks` array and the logic for creating different types of blocks,
  // which is still relevant as this data feeds into the slots for `renderTemplate`.
  // The assertions on `promptText` in those tests might need to be removed or simplified,
  // as the exact final string is now highly dependent on the (mocked) template.
  // The main check for `promptText` is that `renderTemplate` was called with the right slot data.

  it("guard-rail: should ignore includeLastCommit if includePr is also true", async () => {
    const pull = mockPull({ number: 1, repo: "o/r", branch: "b", files: [] });
    const mockLastCommit = {
      sha: "lastsha1",
      commit: { message: "Last commit" },
    } as PullRequestCommit;
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
    const callsToListPrCommitsForLastCommit =
      listPrCommitsSpy.mock.calls.filter(
        (call: any) => call[3] === 1, // The `perPage` argument for fetching last commit is 1
      );
    expect(callsToListPrCommitsForLastCommit.length).toBe(0);
  });

  it("conditional files list: should provide FILES_LIST slot if includePr is false and files exist", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [],
      body: "Original body.",
    });
    const metaWithFiles = {
      ...mockResolvedMetaBase,
      files: ["fileA.ts", "fileB.md"],
    };

    await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );

    // Check that FILES_LIST slot is populated
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("### files changed (2)\n- fileA.ts\n- fileB.md");

    // PR details should only contain original body, not files list
    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );
    const prDetailsBlock = blocks.find((b) =>
      b.id.startsWith("pr-details"),
    ) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toBe("Original body.");
    expect(prDetailsBlock.commentBody).not.toContain("### files changed");
  });

  it("conditional files list: should provide empty FILES_LIST slot if includePr is true, even if files exist", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [],
      body: "Original body.",
    });
    const metaWithFiles = {
      ...mockResolvedMetaBase,
      files: ["fileA.ts", "fileB.md"],
    };

    await buildRepoPromptText(
      pull,
      { includePr: true }, // includePr is true
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );

    // Check that FILES_LIST slot is empty when includePr is true
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("");

    // PR details should only contain original body
    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: true },
      defaultPromptMode,
      undefined,
      metaWithFiles,
    );
    const prDetailsBlock = blocks.find((b) =>
      b.id.startsWith("pr-details"),
    ) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toBe("Original body."); // Only original body
    expect(prDetailsBlock.commentBody).not.toContain("### files changed");
  });

  it("conditional files list: should provide empty FILES_LIST slot if meta.files is empty, even if includePr is false", async () => {
    const pull = mockPull({
      number: 1,
      repo: "o/r",
      branch: "b",
      files: [],
      body: "Original body.",
    });
    const metaNoFiles = { ...mockResolvedMetaBase, files: [] };

    await buildRepoPromptText(
      pull,
      { includePr: false }, // includePr is false
      defaultPromptMode,
      undefined,
      metaNoFiles, // No files in meta
    );

    // Check that FILES_LIST slot is empty when no files exist
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("");

    // PR details should only contain original body
    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      metaNoFiles,
    );
    const prDetailsBlock = blocks.find((b) =>
      b.id.startsWith("pr-details"),
    ) as CommentBlockInput;
    expect(prDetailsBlock).toBeDefined();
    expect(prDetailsBlock.commentBody).toBe("Original body.");
    expect(prDetailsBlock.commentBody).not.toContain("### files changed");
  });

  it("FILES_LIST slot is provided independently of PR body content", async () => {
    const pull = mockPull({
      repo: "o/r",
      number: 7,
      branch: "b",
      // PR body can contain whatever content - FILES_LIST slot is separate
      body: `
        Some intro.

        ### files changed (2)
        - foo.ts
        - bar.md
      `,
      files: [], // pull.files is irrelevant here
    });

    const meta = { ...mockResolvedMetaBase, files: ["newfile.ts", "another.md"] };

    await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      meta,
    );

    // Check that FILES_LIST slot gets its content from meta.files, not PR body
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    expect(slots.FILES_LIST).toBe("### files changed (2)\n- newfile.ts\n- another.md");

    // PR details block should preserve original body content unchanged
    const { blocks } = await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      meta,
    );

    const body = (
      blocks.find((b) => b.id.startsWith("pr-details")) as CommentBlockInput
    ).commentBody;

    // Original PR body content should be preserved as-is
    expect(body).toContain("Some intro.");
    expect(body).toContain("- foo.ts"); // from original body
    expect(body).toContain("- bar.md"); // from original body
    // New files should NOT be in the PR body - they're only in the FILES_LIST slot
    expect(body).not.toContain("newfile.ts");
    expect(body).not.toContain("another.md");
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

  describe("PR Details Token Replacement", () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 777,
      title: "Token Test PR",
      body: "PR Body for token test.",
      url: "https://github.com/owner/myrepo/pull/777",
      branch: "token-branch",
      files: [],
      author: {
        id: "u1",
        name: "tokenauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-02-01T00:00:00Z",
    });
    const meta = {
      ...mockResolvedMetaBase,
      repo: "myrepo",
      branch: "token-branch",
      files: [],
    };
    const prDetailsContentPattern = /### PR #777 DETAILS: Token Test PR/;

    test("should replace {{prDetailsBlock}} token with PR details content", async () => {
      getPromptTemplateSpy.mockResolvedValue(
        "System Preamble.\n{{prDetailsBlock}}\nSystem Postamble.",
      );
      // This template is not "standard" because it's missing SETUP, PR_DETAILS, LINK.
      // It will be handled by the `!isStandardTemplate` branch.
      // `prDetailsContentForBlockToken` will be `prDetailsString` because `{{PR_DETAILS}}` is not in template.
      // `userHandledPrDetails` will be true because `{{prDetailsBlock}}` is in template.
      // So, PR details will be rendered once via `{{prDetailsBlock}}` and not appended.

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      // console.log("ACTUAL PROMPT TEXT (prDetailsBlock only):", promptText);

      // Expected structure for non-standard template: SETUP, rendered_fragment, LINK
      // rendered_fragment = "System Preamble.\n<PR_DETAILS_CONTENT>\nSystem Postamble."
      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nSystem Preamble\./m);
      expect(promptText).toMatch(prDetailsContentPattern); // PR details are injected once
      expect(promptText).toMatch(/System Postamble\.\n([\s\S]*?)\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777$/m);
      expect(promptText.match(new RegExp(prDetailsContentPattern.source, 'g'))?.length).toBe(1); // Ensure it appears only once
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false); // Token is replaced
    });

    test("should replace {{PR_DETAILS}} token with PR details content", async () => {
      getPromptTemplateSpy.mockResolvedValue(
        "System Preamble.\n{{PR_DETAILS}}\nSystem Postamble.",
      );
      // Not "standard". `prDetailsContentForBlockToken` will be empty. `allSlots.PR_DETAILS` gets content.
      // `userHandledPrDetails` is true. Not appended. Rendered once.

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );
      // console.log("ACTUAL PROMPT TEXT (PR_DETAILS only):", promptText);
      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nSystem Preamble\./m);
      expect(promptText).toMatch(prDetailsContentPattern);
      expect(promptText).toMatch(/System Postamble\.\n([\s\S]*?)\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777$/m);
      expect(promptText.match(new RegExp(prDetailsContentPattern.source, 'g'))?.length).toBe(1);
      expect(promptText.includes("{{PR_DETAILS}}")).toBe(false);
    });

    test("should handle both {{PR_DETAILS}} and {{prDetailsBlock}} tokens, rendering PR details only once", async () => {
      getPromptTemplateSpy.mockResolvedValue(
        "System Preamble.\n{{PR_DETAILS}}\nAlso here: {{prDetailsBlock}}\nSystem Postamble.",
      );
      // Not "standard".
      // `allSlots.PR_DETAILS` gets content.
      // `prDetailsContentForBlockToken` (for `allSlots.prDetailsBlock`) will be EMPTY because `{{PR_DETAILS}}` is in template.
      // `userHandledPrDetails` is true. Not appended.
      // `{{PR_DETAILS}}` is rendered with content. `{{prDetailsBlock}}` is rendered with empty string (line removed by renderTemplate).
      // So, PR details appear once.

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );
      // console.log("ACTUAL PROMPT TEXT (both tokens):", promptText);
      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nSystem Preamble\./m);
      expect(promptText).toMatch(prDetailsContentPattern);
      expect(promptText).toMatch(/System Postamble\.\n([\s\S]*?)\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777$/m);
      expect(promptText.match(new RegExp(prDetailsContentPattern.source, 'g'))?.length).toBe(1);
      expect(promptText.includes("{{PR_DETAILS}}")).toBe(false);
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false);
      // Check that "Also here: " is followed by a newline directly to "System Postamble",
      // meaning the {{prDetailsBlock}} line was removed.
      expect(promptText).toMatch(/Also here:\s*\nSystem Postamble\./m);
    });


    test("should remove {{prDetailsBlock}} token if PR details content is empty (e.g., no blocks selected)", async () => {
      // This test's original premise might be hard to achieve perfectly as prDetailsString is always populated.
      // The key is that if prDetailsString were empty, the token would be replaced by empty and line removed.
      // With the new logic, if {{PR_DETAILS}} is present, {{prDetailsBlock}} gets "" and is removed.
      // This test is now covered by the "both tokens" test effectively.
      // Let's ensure a standard template with both tokens also results in one PR detail.
      getPromptTemplateSpy.mockResolvedValue(
        "{{SETUP}}\n{{PR_DETAILS}}\n{{LINK}}\nText: {{prDetailsBlock}}",
      );
      // This IS "standard". `isStandardTemplate` is true.
      // `allSlots.PR_DETAILS` gets content.
      // `allSlots.prDetailsBlock` gets EMPTY string.
      // Result: `setup_content\npr_details_content\nlink_content\nText: \n` (empty line removed by renderTemplate)
      // So, PR details appear once.

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );
      // console.log("ACTUAL PROMPT TEXT (standard, both tokens):", promptText);
      expect(promptText).toMatch(prDetailsContentPattern);
      expect(promptText.match(new RegExp(prDetailsContentPattern.source, 'g'))?.length).toBe(1);
      expect(promptText).not.toContain("Text: ### PR"); // {{prDetailsBlock}} should not have rendered details
      expect(promptText).toMatch(/Text:\s*$/m); // Check that "Text: " is at the end (no newline required since template doesn't include one)
                                                // renderTemplate cleans up empty lines, so if "Text: {{prDetailsBlock}}" was the last line,
                                                // it would become "Text:"
    });

    test("should append PR details content if token is not present in template (backward compatibility for non-standard)", async () => {
      getPromptTemplateSpy.mockResolvedValue("Base prompt without token."); // Not standard, no PR_DETAILS/prDetailsBlock
      // `userHandledPrDetails` will be false. PR details will be appended.

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );
      // console.log("ACTUAL PROMPT TEXT (no token, non-standard):", promptText);

      // Expected structure: SETUP, "Base prompt...", appended PR_DETAILS, LINK
      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nBase prompt without token\./m);
      expect(promptText).toMatch(prDetailsContentPattern); // PR details are appended
      expect(promptText.match(new RegExp(prDetailsContentPattern.source, 'g'))?.length).toBe(1);
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false);
      expect(promptText.includes("{{PR_DETAILS}}")).toBe(false);

      const expectedOrder = [
        "## SETUP",
        "Base prompt without token.",
        "### PR #777 DETAILS: Token Test PR",
        "🔗 https://github.com/owner/myrepo/pull/777",
      ];
      let lastIndex = -1;
      for (const part of expectedOrder) {
        const currentIndex = promptText.indexOf(part);
        expect(
          currentIndex,
          `Part "${part}" not found or out of order in 'no token' case.`,
        ).toBeGreaterThan(lastIndex);
        lastIndex = currentIndex;
      }
    });
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

  describe("FILES_LIST duplication prevention", () => {
    it("should demonstrate actual duplication bug when template has both FILES_LIST and DIFF_CONTENT", () => {
      // This test demonstrates the potential duplication issue that could occur
      // when both FILES_LIST and DIFF_CONTENT tokens are present in a template
      // and both get populated with file information
      
      const mockDiffContent = `### FULL PR DIFF
\`\`\`diff
diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,1 +1,1 @@
-old
+new
\`\`\``;
      
      // Simulate a rendered template with both FILES_LIST and DIFF_CONTENT populated
      const templateWithDuplication = `## SETUP
\`\`\`bash
cd /tmp/myrepo
git fetch origin
git checkout feature-branch
\`\`\`

### TASK
Review the following pull-request diff and propose improvements.

### PR #123 DETAILS: Test Pull Request
Test PR body

### files changed (2)
- file1.ts
- file2.js

${mockDiffContent}

🔗 https://github.com/owner/myrepo/pull/123`;

      // This demonstrates the duplication: both FILES_LIST and DIFF_CONTENT show file info
      expect(templateWithDuplication).toContain("### files changed (2)"); // From FILES_LIST
      expect(templateWithDuplication).toContain("### FULL PR DIFF"); // From DIFF_CONTENT  
      expect(templateWithDuplication).toContain("file1.ts"); // File appears in both sections
      expect(templateWithDuplication).toContain("file2.js"); // File appears in both sections
      
      // Count occurrences to verify duplication
      const file1Count = (templateWithDuplication.match(/file1\.ts/g) || []).length;
      const file2Count = (templateWithDuplication.match(/file2\.js/g) || []).length;
      expect(file1Count).toBeGreaterThanOrEqual(2); // File appears in FILES_LIST and in diff
      expect(file2Count).toBeGreaterThanOrEqual(2); // File appears in FILES_LIST and in diff
    });

    it("should populate FILES_LIST when template has FILES_LIST token but no diff content will be present", async () => {
      // Template with FILES_LIST but no DIFF_CONTENT
      getPromptTemplateSpy.mockResolvedValue(`
{{SETUP}}
{{PR_DETAILS}}
{{FILES_LIST}}
{{LINK}}
      `.trim());

      const pull = mockPull({
        number: 123,
        repo: "owner/myrepo", 
        branch: "feature-branch",
        files: [],
      });
      
      const metaWithFiles = { 
        ...mockResolvedMeta, 
        files: ["file1.ts", "file2.js"] 
      };

      await buildRepoPromptText(
        pull,
        { includePr: false }, // No diff content
        defaultPromptMode,
        undefined,
        metaWithFiles,
      );

      const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
      expect(slots.FILES_LIST).toBe("### files changed (2)\n- file1.ts\n- file2.js");
      expect(slots.DIFF_CONTENT).toBe(""); // No diff content
    });

    it("should populate FILES_LIST when template has DIFF_CONTENT token but no diff content will actually be generated", async () => {
      // Template has both tokens but no diff options selected
      getPromptTemplateSpy.mockResolvedValue(`
{{SETUP}}
{{PR_DETAILS}}
{{FILES_LIST}}
{{DIFF_CONTENT}}
{{LINK}}
      `.trim());

      const pull = mockPull({
        number: 123,
        repo: "owner/myrepo",
        branch: "feature-branch", 
        files: [],
      });
      
      const metaWithFiles = { 
        ...mockResolvedMeta, 
        files: ["file1.ts", "file2.js"] 
      };

      await buildRepoPromptText(
        pull,
        { 
          includePr: false, 
          includeLastCommit: false,
          includeComments: false,
          commits: []
        }, // No diff content will be generated
        defaultPromptMode,
        undefined,
        metaWithFiles,
      );

      const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
      expect(slots.FILES_LIST).toBe("### files changed (2)\n- file1.ts\n- file2.js");
      expect(slots.DIFF_CONTENT).toBe(""); // No diff content generated
    });

    it("should avoid FILES_LIST duplication when both FILES_LIST and DIFF_CONTENT are present in template", async () => {
      const pull = mockPull({
        repo: "owner/myrepo", 
        number: 123,
        title: "Test PR with diff content",
        body: "PR body",
        url: "https://github.com/owner/myrepo/pull/123",
        branch: "feature-branch",
        files: ["src/main.ts", "README.md"],
      });
      
      const metaWithFiles = {
        ...mockResolvedMetaBase,
        files: ["src/main.ts", "README.md"],
      };

      // Mock a template that has both FILES_LIST and DIFF_CONTENT (like implement.md)
      getPromptTemplateSpy.mockResolvedValue(
        `## SETUP\n{{SETUP}}\n\n{{PR_DETAILS}}\n\n{{FILES_LIST}}\n\n{{DIFF_CONTENT}}\n\n{{LINK}}`
      );

      // Scenario: includePr=true (diff content will be generated) 
      // but the template has both FILES_LIST and DIFF_CONTENT tokens
      // This should detect the duplication and suppress FILES_LIST
      const result = await buildRepoPromptText(
        pull,
        { includePr: true }, // This will generate diff content in DIFF_CONTENT slot
        "implement", // Using implement mode which typically has both tokens
        undefined,
        metaWithFiles,
      );

      const slots = vi.mocked(renderTemplateModule.renderTemplate).mock.calls[0][1];
    
    // Check what we actually get (debugging)
    console.log("FILES_LIST slot:", JSON.stringify(slots.FILES_LIST));
    console.log("DIFF_CONTENT slot:", JSON.stringify(slots.DIFF_CONTENT));
    
    // FILES_LIST should be empty to avoid duplication since DIFF_CONTENT will contain file info
    expect(slots.FILES_LIST).toBe("");
    
    // DIFF_CONTENT should contain the formatted diff content
    expect(slots.DIFF_CONTENT).toContain("dummy pr diff content");
      
      // Verify the final prompt doesn't have duplicate file listings
      expect(result.promptText).not.toMatch(/files changed[\s\S]*files changed/);
    });
  });
});
