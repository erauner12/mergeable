/// <reference types="vitest/globals" />

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client";
import type { PromptMode } from "../../src/lib/repoprompt"; // SUT type

// Declare variables that will be initialized in beforeAll
let originalTemplateMapDeepCopy: any;
let actualAnalyseTemplateFn: any;
const mutableMockedTemplateMap: any = {}; // Initialize as an empty object

// Move the vi.mock for templates to the very top, before any imports that might transitively import it
vi.mock("../../src/lib/templates", () => ({
  __esModule: true,
  get templateMap() {
    return mutableMockedTemplateMap;
  },
  analyseTemplate: (...args: any[]) => actualAnalyseTemplateFn(...args),
}));

beforeAll(async () => {
  const actualTemplatesModule = await vi.importActual<
    typeof import("../../src/lib/templates")
  >("../../src/lib/templates");
  originalTemplateMapDeepCopy = JSON.parse(
    JSON.stringify(actualTemplatesModule.templateMap),
  );
  actualAnalyseTemplateFn = actualTemplatesModule.analyseTemplate;

  // Populate mutableMockedTemplateMap after actuals are loaded
  const initialCopy = JSON.parse(JSON.stringify(originalTemplateMapDeepCopy));
  for (const key in initialCopy) {
    mutableMockedTemplateMap[key] = initialCopy[key];
  }
});

// Now, other imports that might depend on the mocked "../../src/lib/templates" can follow
import * as gh from "../../src/lib/github/client"; // ← stub network call
import * as renderTemplateModule from "../../src/lib/renderTemplate"; // Mock renderTemplate
import {
  buildRepoPromptText,
  buildRepoPromptUrl,
  type CommentBlockInput,
  defaultPromptMode,
  formatPromptBlock,
  type ResolvedPullMeta,
} from "../../src/lib/repoprompt";
import { isDiffBlock } from "../../src/lib/repoprompt.guards";
import * as settings from "../../src/lib/settings";
import { mockPull } from "../testing";

// Local helper to modify the mock's state
function setMockTemplateBody(mode: PromptMode, body: string) {
  mutableMockedTemplateMap[mode] = {
    body,
    meta: actualAnalyseTemplateFn(body), // Ensure actualAnalyseTemplateFn is defined and called
  };
}

// Mock renderTemplate to check its inputs and control its output
vi.mock("../../src/lib/renderTemplate", () => ({
  renderTemplate: vi.fn(
    (template: string, slots: Record<string, unknown>, _opts?: any) => {
      // Add _opts
      // Simple mock: just join slots for verification, or return template if no slots for some reason
      // A more sophisticated mock could actually perform replacement for more robust checks.
      let result = template;
      for (const [key, value] of Object.entries(slots)) {
        result = result.replace(`{{${key}}}`, String(value ?? "")); // Ensure value is string
      }
      // Basic simulation of line removal for empty tokens for testing purposes
      result = result
        .split("\n")
        .filter(
          (line) =>
            !/^\s*{{\s*\w+\s*}}\s*$/.test(line.trim()) &&
            line.trim().length > 0,
        )
        .join("\n");
      return result.trim();
    },
  ),
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

// REMOVE: Mock templates.templateMap (mockTemplateMapInstance, actualAnalyseTemplateFn, mockDefaultMeta)
// let mockTemplateMapInstance: Record<PromptMode, { body: string; meta: TemplateMeta }>;
// let actualAnalyseTemplateFn: (tpl: string) => TemplateMeta;
// const mockDefaultMeta: TemplateMeta = { ... };
// vi.mock("../../src/lib/templates", async () => { ... });

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
  let getPullRequestDiffSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mutableMockedTemplateMap to a fresh copy of the original for test isolation
    const freshCopy = JSON.parse(JSON.stringify(originalTemplateMapDeepCopy));
    // Clear current keys from the mutable object
    for (const key in mutableMockedTemplateMap) {
      delete mutableMockedTemplateMap[key];
    }
    // Repopulate the mutable object with fresh copy
    for (const key in freshCopy) {
      mutableMockedTemplateMap[key] = freshCopy[key];
    }

    getPullRequestDiffSpy = vi
      .spyOn(gh, "getPullRequestDiff")
      .mockResolvedValue("dummy pr diff content");
    vi.mocked(gh.fetchPullComments).mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );

    // Setup default templates for this suite using the local setMockTemplateBody
    const defaultTemplateBodyForMode = (mode: PromptMode) =>
      `MODE ${mode.toUpperCase()} TEMPLATE:\nSETUP:\n{{SETUP}}\nPR_DETAILS:\n{{PR_DETAILS}}\nFILES_LIST:\n{{FILES_LIST}}\nLINK:\n{{LINK}}`;

    setMockTemplateBody("implement", defaultTemplateBodyForMode("implement"));
    setMockTemplateBody("review", defaultTemplateBodyForMode("review"));
    setMockTemplateBody("adjust-pr", defaultTemplateBodyForMode("adjust-pr"));
    setMockTemplateBody("respond", defaultTemplateBodyForMode("respond"));
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
      files: ["src/main.ts", "README.md"],
      author: {
        id: "u1",
        name: "testauthor",
        avatarUrl: "avatar.url",
        bot: false,
      },
      createdAt: "2024-01-01T00:00:00Z",
    });
    const meta = { ...mockResolvedMetaBase, files: ["fileA.ts", "fileB.ts"] };

    // Configure templateMap for this test if specific meta needed (e.g. expectsFilesList = true)
    const currentMode = defaultPromptMode;
    const templateBody = `MODE ${currentMode.toUpperCase()} TEMPLATE:\n{{SETUP}}\n{{PR_DETAILS}}\n{{FILES_LIST}}\n{{DIFF_CONTENT}}\n{{LINK}}`;
    // Use setMockTemplateBody to update the template. Meta is auto-generated.
    setMockTemplateBody(currentMode, templateBody);

    const { promptText } = await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      meta,
    );

    expect(
      vi.mocked(renderTemplateModule.renderTemplate),
    ).toHaveBeenCalledTimes(1);

    const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0];
    expect(renderCallArgs[0]).toBe(templateBody); // Check the body passed to renderTemplate

    const slots = renderCallArgs[1];
    expect(slots.SETUP).toContain("cd /tmp/myrepo");
    expect(slots.SETUP).toContain("git checkout feature-branch");

    const prDetailsBlock = {
      id: `pr-details-${pull.id}`,
      kind: "comment",
      header: `### PR #${pull.number} DETAILS: ${pull.title}`,
      commentBody: "PR Body here.",
      author: "testauthor",
      authorAvatarUrl: "avatar.url",
      timestamp: "2024-01-01T00:00:00Z",
    } as CommentBlockInput;
    expect(slots.PR_DETAILS).toBe(formatPromptBlock(prDetailsBlock));
    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- fileA.ts\n- fileB.ts",
    );
    expect(slots.DIFF_CONTENT ?? "").toBe(""); // DIFF_CONTENT is now always empty or undefined
    expect(slots.LINK).toBe("🔗 https://github.com/owner/myrepo/pull/123");

    // Duplicate content checks
    expect(promptText.match(/files changed/g) ?? []).toHaveLength(1);
    expect(promptText.match(/### PR #\d+ DETAILS/g) ?? []).toHaveLength(1);
  });

  it("should call renderTemplate with correct slots, including FILES_LIST and DIFF_CONTENT", async () => {
    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "PR Body here.", // This body will be used verbatim
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
    const meta = { ...mockResolvedMetaBase, files: ["fileA.ts", "fileB.ts"] };
    getPullRequestDiffSpy.mockResolvedValue(
      "diff --git a/fileA.ts b/fileA.ts\n--- a/fileA.ts\n+++ b/fileA.ts\n@@ -1 +1 @@\n-old\n+new",
    );

    const currentMode = defaultPromptMode;
    // Template that uses all relevant slots
    const templateBody = `SETUP:\n{{SETUP}}\nPR_DETAILS:\n{{PR_DETAILS}}\nFILES_LIST:\n{{FILES_LIST}}\nDIFF_CONTENT:\n{{DIFF_CONTENT}}\nLINK:\n{{LINK}}`;
    setMockTemplateBody(currentMode, templateBody);

    await buildRepoPromptText(
      pull,
      { includePr: true }, // To populate DIFF_CONTENT
      defaultPromptMode,
      undefined, // endpoint
      meta, // meta
    );

    expect(
      vi.mocked(renderTemplateModule.renderTemplate),
    ).toHaveBeenCalledTimes(1);

    const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0];
    expect(renderCallArgs[0]).toBe(templateBody);

    const slots = renderCallArgs[1];
    expect(slots.SETUP).toContain("cd /tmp/myrepo");
    expect(slots.SETUP).toContain("git checkout feature-branch");

    const prDetailsBlockInput: CommentBlockInput = {
      id: `pr-details-${pull.id}`,
      kind: "comment",
      header: `### PR #${pull.number} DETAILS: ${pull.title}`,
      commentBody: "PR Body here.",
      author: "testauthor",
      authorAvatarUrl: "avatar.url",
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(slots.PR_DETAILS).toBe(formatPromptBlock(prDetailsBlockInput));

    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- fileA.ts\n- fileB.ts",
    );

    const expectedDiffBlock = {
      id: `diff-pr-${pull.id}`,
      kind: "diff" as const,
      header: "### FULL PR DIFF",
      patch:
        "diff --git a/fileA.ts b/fileA.ts\n--- a/fileA.ts\n+++ b/fileA.ts\n@@ -1 +1 @@\n-old\n+new",
    };
    expect(slots.DIFF_CONTENT).toBe(formatPromptBlock(expectedDiffBlock));
    expect(slots.LINK).toBe("🔗 https://github.com/owner/myrepo/pull/123");

    // The final promptText will contain these parts, structured by the template.
    // We don't need to check for "duplicate content" in promptText as PR body is verbatim.
  });

  it("FILES_LIST slot is populated if template expects it and files exist, independently of PR body content", async () => {
    const pullWithFilesListInBody = mockPull({
      repo: "o/r",
      number: 7,
      branch: "b",
      body: `Some intro.\n\n### files changed (2)\n- foo.ts\n- bar.md`, // PR body has its own list
      files: [],
    });

    const metaForSlot = {
      ...mockResolvedMetaBase,
      files: ["newfile.ts", "another.md"],
    };

    // Template expects FILES_LIST
    setMockTemplateBody(
      defaultPromptMode,
      "Template: {{PR_DETAILS}}\nSlot: {{FILES_LIST}}",
    );

    await buildRepoPromptText(
      pullWithFilesListInBody,
      { includePr: false }, // diffOptions
      defaultPromptMode,
      undefined, // endpoint
      metaForSlot, // meta
    );

    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    // FILES_LIST slot gets content from meta.files
    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- newfile.ts\n- another.md",
    );

    // PR_DETAILS slot contains the verbatim PR body
    const prDetailsBlockInput: CommentBlockInput = {
      id: `pr-details-${pullWithFilesListInBody.id}`,
      kind: "comment",
      header: `### PR #${pullWithFilesListInBody.number} DETAILS: ${pullWithFilesListInBody.title}`,
      commentBody: `Some intro.\n\n### files changed (2)\n- foo.ts\n- bar.md`,
      author: pullWithFilesListInBody.author?.name ?? "unknown",
      authorAvatarUrl: pullWithFilesListInBody.author?.avatarUrl,
      timestamp: pullWithFilesListInBody.createdAt,
    };
    expect(slots.PR_DETAILS).toBe(formatPromptBlock(prDetailsBlockInput));
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
      mockResolvedMetaBase,
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
    expect(promptText).not.toContain("@@ -1,1,1 @@");
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
      mockResolvedMetaBase,
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
      mockResolvedMetaBase,
    );

    // Order in allPromptBlocks: PR Details, then Comments, then Diffs
    expect(blocks.length).toBe(3); // PR Details, Comment Thread, PR Diff
    expect(blocks[0].id).toContain("pr-details"); // PR Details always first
    expect(blocks[1].id).toBe("thread-1-comment-xyz"); // Then comments
    expect(blocks[2].id).toContain("diff-pr"); // Then diffs
  });

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

    test("should replace {{prDetailsBlock}} token with PR details content (non-standard template)", async () => {
      const body = "System Preamble.\n{{prDetailsBlock}}\nSystem Postamble.";
      // Use setMockTemplateBody to set the template for the current mode.
      setMockTemplateBody(defaultPromptMode, body);
      // The meta will be derived by the actualAnalyseTemplate in the shared mock.
      // Old: mockTemplateMapInstance[defaultPromptMode] = { body, meta: actualAnalyseTemplateFn(body) };

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      // Check structure passed to renderTemplate for non-standard
      const renderCall = vi
        .mocked(renderTemplateModule.renderTemplate)
        .mock.calls.find((call) => call[0] === body);
      expect(renderCall).toBeDefined();
      if (renderCall) {
        const slotsForUserFragment = renderCall[1];
        expect(slotsForUserFragment.prDetailsBlock).toMatch(
          prDetailsContentPattern,
        );
        expect(slotsForUserFragment.DIFF_CONTENT ?? "").toBe(""); // DIFF_CONTENT is now always empty or undefined
      }

      // Check final promptText (relies on mock renderTemplate's behavior)
      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nSystem Preamble\./m);
      expect(promptText).toMatch(prDetailsContentPattern);
      expect(promptText).toMatch(
        /System Postamble\.\n([\s\S]*?)\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777$/m,
      );
      expect(
        promptText.match(new RegExp(prDetailsContentPattern.source, "g"))
          ?.length,
      ).toBe(1);
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false);
    });

    test("should replace {{PR_DETAILS}} token with PR details content (non-standard template)", async () => {
      const body = "System Preamble.\n{{PR_DETAILS}}\nSystem Postamble.";
      setMockTemplateBody(defaultPromptMode, body);
      // Old: mockTemplateMapInstance[defaultPromptMode] = { body, meta: actualAnalyseTemplateFn(body) };

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      const renderCall = vi
        .mocked(renderTemplateModule.renderTemplate)
        .mock.calls.find((call) => call[0] === body);
      expect(renderCall).toBeDefined();
      if (renderCall) {
        const slotsForUserFragment = renderCall[1];
        expect(slotsForUserFragment.PR_DETAILS).toMatch(
          prDetailsContentPattern,
        );
        expect(slotsForUserFragment.prDetailsBlock).toBe(""); // As PR_DETAILS is present in template
        expect(slotsForUserFragment.DIFF_CONTENT ?? "").toBe(""); // DIFF_CONTENT is now always empty or undefined
      }

      expect(promptText).toMatch(/^## SETUP\n([\s\S]*?)\nSystem Preamble\./m);
      expect(promptText).toMatch(prDetailsContentPattern);
      expect(promptText).toMatch(
        /System Postamble\.\n([\s\S]*?)\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777$/m,
      );
      expect(
        promptText.match(new RegExp(prDetailsContentPattern.source, "g"))
          ?.length,
      ).toBe(1);
      expect(promptText.includes("{{PR_DETAILS}}")).toBe(false);
    });

    test("should handle both {{PR_DETAILS}} and {{prDetailsBlock}} tokens, rendering PR details only once (standard template)", async () => {
      const body =
        "{{SETUP}}\n{{PR_DETAILS}}\nAlso here: {{prDetailsBlock}}\n{{LINK}}";
      setMockTemplateBody(defaultPromptMode, body);
      // Old: mockTemplateMapInstance[defaultPromptMode] = { body, meta: actualAnalyseTemplateFn(body) };

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      const renderCall = vi.mocked(renderTemplateModule.renderTemplate).mock
        .calls[0];
      expect(renderCall[0]).toBe(body); // Standard template, body is passed directly
      const slots = renderCall[1];
      expect(slots.PR_DETAILS).toMatch(prDetailsContentPattern);
      expect(slots.prDetailsBlock).toBe(""); // Because PR_DETAILS is in template

      expect(promptText).toMatch(prDetailsContentPattern);
      expect(
        promptText.match(new RegExp(prDetailsContentPattern.source, "g"))
          ?.length,
      ).toBe(1);
      expect(promptText.includes("{{PR_DETAILS}}")).toBe(false);
      expect(promptText.includes("{{prDetailsBlock}}")).toBe(false);
      // Check that "Also here: " is followed by a newline directly to LINK,
      // meaning the {{prDetailsBlock}} line was removed by the (mocked) renderTemplate.
      // This depends on the mock renderTemplate's line removal logic.
      expect(promptText).toMatch(
        /Also here:\s*\n🔗 https:\/\/github\.com\/owner\/myrepo\/pull\/777/m,
      );
    });

    test("should append PR details content if no PR token is present in template (non-standard)", async () => {
      const body = "Base prompt without token."; // No PR_DETAILS or prDetailsBlock
      setMockTemplateBody(defaultPromptMode, body);
      // Old: mockTemplateMapInstance[defaultPromptMode] = { body, meta: actualAnalyseTemplateFn(body) };

      const { promptText } = await buildRepoPromptText(
        pull,
        {},
        defaultPromptMode,
        undefined,
        meta,
      );

      expect(promptText).toMatch(
        /^## SETUP\n([\s\S]*?)\nBase prompt without token\./m,
      );
      expect(promptText).toMatch(prDetailsContentPattern); // PR details are appended
      expect(
        promptText.match(new RegExp(prDetailsContentPattern.source, "g"))
          ?.length,
      ).toBe(1);

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
          `Part "${part}" not found or out of order.`,
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
      mockResolvedMetaBase,
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
      mockResolvedMetaBase,
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
});
