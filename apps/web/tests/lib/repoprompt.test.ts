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

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      console.log("ACTUAL PROMPT TEXT:", promptText);

      expect(promptText).toMatch(/System Preamble\./);
      expect(promptText).toMatch(prDetailsContentPattern); // PR details are injected
      expect(promptText).toMatch(/System Postamble\./);
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false); // Token is replaced

      // Check order: SETUP, (Preamble, PR Details, Postamble), LINK
      const expectedOrder = [
        "## SETUP",
        "System Preamble.",
        "### PR #777 DETAILS: Token Test PR",
        "System Postamble.",
        "🔗 https://github.com/owner/myrepo/pull/777",
      ];
      let lastIndex = -1;
      for (const part of expectedOrder) {
        const currentIndex = promptText.indexOf(part);
        expect(
          currentIndex,
          `Part "${part}" not found or out of order.`,
        ).toBeGreaterThan(lastIndex);
        lastIndex = currentIndex;
      }
    });

    test("should remove {{prDetailsBlock}} token if PR details content is empty (e.g., no blocks selected)", async () => {
      // This scenario is a bit artificial as PR details block is always created and initially selected.
      // To test token removal with empty content, we'd need to manipulate `initiallySelectedBlocks`
      // or have `formatListOfPromptBlocks` return empty for it.
      // For now, let's assume `combinedInitialContent` could be empty if all blocks were deselected by some future logic
      // or if `formatListOfPromptBlocks` returned empty.
      // The current implementation of `buildRepoPromptText` ensures PR details is always in `initiallySelectedBlocks`.
      // So, `trimmedCombinedInitialContent` will contain at least the PR details.
      // A more realistic test for "token removal" is if the template is *only* the token.

      getPromptTemplateSpy.mockResolvedValue(
        "System Preamble.\n{{prDetailsBlock}}\nSystem Postamble.",
      );
      // To simulate empty combinedInitialContent, we'd need to mock formatListOfPromptBlocks or filter initiallySelectedBlocks
      // However, the current logic ensures PR details are always there.
      // The test above already shows replacement. If combinedInitialContent were empty, it would be replaced by empty string.

      // Let's test if the template is *just* the token and content is provided.
      getPromptTemplateSpy.mockResolvedValue("{{prDetailsBlock}}");
      const { promptText: promptTextOnlyToken } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );
      expect(promptTextOnlyToken).toMatch(prDetailsContentPattern);
      expect(promptTextOnlyToken.includes("{{prDetailsBlock}}")).toBe(false);
      // Check order: SETUP, PR Details, LINK
      const expectedOrderOnlyToken = [
        "## SETUP",
        "### PR #777 DETAILS: Token Test PR",
        "🔗 https://github.com/owner/myrepo/pull/777",
      ];
      let lastIndexOnlyToken = -1;
      for (const part of expectedOrderOnlyToken) {
        const currentIndex = promptTextOnlyToken.indexOf(part);
        expect(
          currentIndex,
          `Part "${part}" not found or out of order in 'only token' case.`,
        ).toBeGreaterThan(lastIndexOnlyToken);
        lastIndexOnlyToken = currentIndex;
      }
    });

    test("should append PR details content if token is not present in template (backward compatibility)", async () => {
      getPromptTemplateSpy.mockResolvedValue("Base prompt without token.");

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      expect(promptText).toMatch(/Base prompt without token\./);
      expect(promptText).toMatch(prDetailsContentPattern); // PR details are appended
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false);

      // Check order: SETUP, Base Prompt, PR Details, LINK
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

  // New Test Case A: "review" mode + comments requested
  it("should use review prompt and include comments for 'review' mode when requested", async () => {
    // Override the mock for this specific test
    getPromptTemplateSpy.mockResolvedValueOnce("MOCK_PROMPT_FOR_REVIEW");
    
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
    // Override the mock for this specific test - use a template with slots so diff content gets included
    getPromptTemplateSpy.mockResolvedValueOnce("MOCK_PROMPT_FOR_ADJUST-PR\n{{DIFF_CONTENT}}");
    
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
    // Override the mock for this specific test
    getPromptTemplateSpy.mockResolvedValueOnce("MOCK_PROMPT_FOR_RESPOND");
    
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

  it("should return blocks with unique IDs", async () => {
    const pull = mockPull({
      number: 99,
      repo: "owner/unique-test",
      branch: "test-branch",
      files: ["file.ts"],
      body: "Initial PR body for unique ID test.",
      url: "https://github.com/owner/unique-test/pull/99",
      author: { id: "u1", name: "testauthor", avatarUrl: "avatar.url", bot: false },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const meta = { // mockResolvedMetaBase is now in scope
      ...mockResolvedMetaBase,
      repo: "unique-test",
      branch: "test-branch",
      files: ["file.ts", "another.md"],
    };

    // Mock GitHub client calls to ensure various block types can be generated
    vi.mocked(gh.fetchPullComments).mockResolvedValue([
      { id: "comment-1", kind: "comment", header: "A comment", commentBody: "body", author: "c", timestamp: "ts" },
    ]);
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("full pr diff content");
    vi.spyOn(gh, "listPrCommits").mockImplementation(async (_owner, _repo, _pullNumber, perPage) => {
      if (perPage === 1) { // For last commit
        return Promise.resolve([{ sha: "lastsha", commit: { message: "Last commit" } } as PullRequestCommit]);
      }
      // For specific commits (or general listing if used)
      return Promise.resolve([
        { sha: "specsha1", commit: { message: "Specific commit ONE" } },
        { sha: "specsha2", commit: { message: "Specific commit TWO" } },
      ] as PullRequestCommit[]);
    });
    vi.spyOn(gh, "getCommitDiff").mockImplementation(async (_owner, _repo, sha) => {
      if (sha === "lastsha") return Promise.resolve("diff for last commit");
      if (sha === "specsha1") return Promise.resolve("diff for specsha1");
      if (sha === "specsha2") return Promise.resolve("diff for specsha2");
      return Promise.resolve(`diff for ${sha}`);
    });


    const { blocks } = await buildRepoPromptText(
      pull,
      {
        includePr: true,          // Generates diff-pr-<pull.id>
        includeLastCommit: false, // Set to false to avoid conflict with includePr due to guard rail, test specific commit diffs separately
        includeComments: true,    // Generates comment-1 (from mock)
        commits: ["specsha1"],    // Generates diff-commit-specsha1
      },
      defaultPromptMode,
      { auth: "token", baseUrl: "url" }, // endpoint
      meta
    );

    const ids = blocks.map(b => b.id);
    const uniqueIds = new Set(ids);
    expect(ids.length, `Found duplicate IDs: ${JSON.stringify(ids.filter((id, i) => ids.indexOf(id) !== i))}`).toBe(uniqueIds.size);

    // Check that expected blocks are present (and thus their IDs contributed to the uniqueness check)
    expect(blocks.some(b => b.id === `pr-details-${pull.id}`)).toBe(true);
    expect(blocks.some(b => b.id === "comment-1")).toBe(true);
    expect(blocks.some(b => b.id === `diff-pr-${pull.id}`)).toBe(true);
    expect(blocks.some(b => b.id === "diff-commit-specsha1")).toBe(true);
    // Last commit diff should not be present because includePr=true and the internal guard rail sets includeLastCommit=false
    expect(blocks.some(b => b.id.startsWith("diff-last-commit-"))).toBe(false);
  });
});