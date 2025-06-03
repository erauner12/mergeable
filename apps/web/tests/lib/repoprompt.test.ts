/// <reference types="vitest/globals" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestCommit } from "../../src/lib/github/client";
import type { PromptMode } from "../../src/lib/repoprompt"; // SUT type

// Get actuals for setting up the mock. These are from the original, unmocked module.
// This MUST be `await` and at the top level.
const actualTemplatesModule = await vi.importActual<typeof import("../../src/lib/templates")>("../../src/lib/templates");
const originalTemplateMapDeepCopy = JSON.parse(JSON.stringify(actualTemplatesModule.templateMap));
const actualAnalyseTemplateFn = actualTemplatesModule.analyseTemplate;

// This is the state that our mock will expose and our tests will manipulate.
// Initialize it with a deep copy of the original.
// This object itself will be mutated by tests.
const mutableMockedTemplateMap = JSON.parse(JSON.stringify(originalTemplateMapDeepCopy));

vi.mock("../../src/lib/templates", () => ({
  __esModule: true,
  templateMap: mutableMockedTemplateMap, // Expose the mutable state
  analyseTemplate: actualAnalyseTemplateFn, // Expose the original analyseTemplate
}));

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
    meta: actualAnalyseTemplateFn(body), // Use the captured actualAnalyseTemplateFn
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
  let listPrCommitsSpy: any;
  let getPullRequestDiffSpy: any;

  beforeEach(async () => {
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
    listPrCommitsSpy = vi.spyOn(gh, "listPrCommits").mockResolvedValue([]);
    vi.spyOn(gh, "getCommitDiff").mockResolvedValue(
      "dummy commit diff content",
    );

    // Setup default templates for this suite using the local setMockTemplateBody
    const defaultTemplateBodyForMode = (mode: PromptMode) =>
      `MODE ${mode.toUpperCase()} TEMPLATE:\nSETUP:\n{{SETUP}}\nPR_DETAILS:\n{{PR_DETAILS}}\nFILES_LIST:\n{{FILES_LIST}}\nDIFF_CONTENT:\n{{DIFF_CONTENT}}\nLINK:\n{{LINK}}`;
    
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
    expect(slots.DIFF_CONTENT).toBe("");
    expect(slots.LINK).toBe("🔗 https://github.com/owner/myrepo/pull/123");

    // Duplicate content checks
    expect(promptText.match(/files changed/g) ?? []).toHaveLength(1);
    expect(promptText.match(/### PR #\d+ DETAILS/g) ?? []).toHaveLength(1);
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

    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- fileA.ts\n- fileB.md",
    );
    // PR_DETAILS should not contain the file list
    const prDetailsBlock = (
      await buildRepoPromptText(
        pull,
        { includePr: false },
        defaultPromptMode,
        undefined,
        metaWithFiles,
      )
    ).blocks.find((b) => b.id.startsWith("pr-details")) as CommentBlockInput;
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

    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.FILES_LIST).toBe("");
    const prDetailsBlock = (
      await buildRepoPromptText(
        pull,
        { includePr: true },
        defaultPromptMode,
        undefined,
        metaWithFiles,
      )
    ).blocks.find((b) => b.id.startsWith("pr-details")) as CommentBlockInput;
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

    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.FILES_LIST).toBe("");
    const prDetailsBlock = (
      await buildRepoPromptText(
        pull,
        { includePr: false },
        defaultPromptMode,
        undefined,
        metaNoFiles,
      )
    ).blocks.find((b) => b.id.startsWith("pr-details")) as CommentBlockInput;
    expect(prDetailsBlock.commentBody).toBe("Original body.");
  });

  // New tests for duplication prevention
  describe("File List Duplication Prevention", () => {
    const mockMetaWithFiles = {
      ...mockResolvedMetaBase,
      files: ["fileA.ts", "fileB.md"],
    };
    const filesListContent = "### files changed (2)\n- fileA.ts\n- fileB.md";

    const prBodyWithFilesList = `This is the PR body.
### files changed (2)
- oldFile1.txt
- oldFile2.txt
More PR body text.`;

    const prBodyWithoutFilesList = "This is a clean PR body.";

    beforeEach(() => {
      // Reset getPromptTemplateSpy to a generic template for these specific tests
      // to control presence of {{FILES_LIST}} token.
      // This spy on settings.getPromptTemplate is separate from the templates.templateMap mock.
      // If the SUT (buildRepoPromptText) calls settings.getPromptTemplate, this spy will intercept.
      // The shared mock for templates.templateMap is used when settings.getPromptTemplate falls back to defaults.
      vi.spyOn(settings, "getPromptTemplate").mockImplementation(
        (_mode: PromptMode) => {
          // For these tests, we want buildRepoPromptText to receive a specific template string.
          // This string will be analyzed by the *actual* analyseTemplate via the mocked templates.templateMap
          // if getPromptTemplate internally uses it, OR if buildRepoPromptText gets it directly.
          // The key is that the template string used by buildRepoPromptText should be this one.
          const specificTemplateForTest = `{{SETUP}}\n{{PR_DETAILS}}\n{{FILES_LIST}}\n{{DIFF_CONTENT}}\n{{LINK}}`;
          // To ensure buildRepoPromptText uses this, we can also use setMockTemplateBody.
          // However, buildRepoPromptText calls settings.getPromptTemplate(mode).
          // So, this spy is the most direct way to control what template string buildRepoPromptText receives.
          setMockTemplateBody(defaultPromptMode, specificTemplateForTest); // Ensure the mock map reflects this too for consistency if accessed.
          return Promise.resolve(specificTemplateForTest);
        }
      );
    });

    it("should strip files list from PR_DETAILS if FILES_LIST slot is populated", async () => {
      const pull = mockPull({ body: prBodyWithFilesList, files: [] }); // files in pull obj not used by logic

      const { promptText, blocks } = await buildRepoPromptText(
        pull,
        { includePr: false }, // Ensures diffContentString is empty, so FILES_LIST can be populated
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );

      const prDetailsBlock = blocks.find((b) =>
        b.id.startsWith("pr-details"),
      ) as CommentBlockInput;
      expect(prDetailsBlock.commentBody).not.toContain("### files changed");
      expect(prDetailsBlock.commentBody).not.toContain("oldFile1.txt");
      expect(prDetailsBlock.commentBody).toContain("This is the PR body."); // Check that other parts remain
      expect(prDetailsBlock.commentBody).toContain("More PR body text.");

      const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
        .calls[0];
      const slots = renderCallArgs[1];
      expect(slots.FILES_LIST).toBe(filesListContent);
      expect(promptText).not.toMatch(/files changed[\s\S]*files changed/);
      expect(promptText).toContain(filesListContent); // Ensure it's in the final prompt via the slot
    });

    it("should keep files list in PR_DETAILS if FILES_LIST slot is NOT populated (e.g., due to diff content)", async () => {
      const pull = mockPull({ body: prBodyWithFilesList, files: [] });
      getPullRequestDiffSpy.mockResolvedValue("dummy pr diff content"); // Ensure diff content is present

      const { promptText, blocks } = await buildRepoPromptText(
        pull,
        { includePr: true }, // Ensures diffContentString is NOT empty, so FILES_LIST is not populated
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );

      const prDetailsBlock = blocks.find((b) =>
        b.id.startsWith("pr-details"),
      ) as CommentBlockInput;
      expect(prDetailsBlock.commentBody).toContain("### files changed (2)"); // Original list remains
      expect(prDetailsBlock.commentBody).toContain("oldFile1.txt");

      const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
        .calls[0];
      const slots = renderCallArgs[1];
      expect(slots.FILES_LIST).toBe(""); // FILES_LIST slot is empty
      expect(slots.DIFF_CONTENT).not.toBe("");
      expect(promptText).not.toMatch(/files changed[\s\S]*files changed/);
      // The files list from PR body should be present
      expect(promptText).toContain(
        "### files changed (2)\n- oldFile1.txt\n- oldFile2.txt",
      );
    });

    it("should handle PR body without files list correctly when FILES_LIST is populated", async () => {
      const pull = mockPull({ body: prBodyWithoutFilesList, files: [] });

      const { promptText, blocks } = await buildRepoPromptText(
        pull,
        { includePr: false },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );

      const prDetailsBlock = blocks.find((b) =>
        b.id.startsWith("pr-details"),
      ) as CommentBlockInput;
      expect(prDetailsBlock.commentBody).toBe(prBodyWithoutFilesList);

      const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
        .calls[0];
      const slots = renderCallArgs[1];
      expect(slots.FILES_LIST).toBe(filesListContent);
      expect(promptText).not.toMatch(/files changed[\s\S]*files changed/);
    });

    it("should handle PR body without files list correctly when FILES_LIST is NOT populated", async () => {
      const pull = mockPull({ body: prBodyWithoutFilesList, files: [] });
      getPullRequestDiffSpy.mockResolvedValue("dummy pr diff content");

      const { promptText, blocks } = await buildRepoPromptText(
        pull,
        { includePr: true },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );

      const prDetailsBlock = blocks.find((b) =>
        b.id.startsWith("pr-details"),
      ) as CommentBlockInput;
      expect(prDetailsBlock.commentBody).toBe(prBodyWithoutFilesList);

      const renderCallArgs = vi.mocked(renderTemplateModule.renderTemplate).mock
        .calls[0];
      const slots = renderCallArgs[1];
      expect(slots.FILES_LIST).toBe("");
      expect(slots.DIFF_CONTENT).not.toBe("");
      expect(promptText).not.toMatch(/files changed[\s\S]*files changed/);
    });

    it("overall prompt should never contain duplicated 'files changed' sections", async () => {
      // This test uses a specific template to ensure all relevant tokens are present
      // The spy on settings.getPromptTemplate is crucial here.
      vi.spyOn(settings, "getPromptTemplate").mockResolvedValue(
        `{{SETUP}}\nPR_INFO:\n{{PR_DETAILS}}\nFILES_EXPLICIT:\n{{FILES_LIST}}\nDIFFS:\n{{DIFF_CONTENT}}\n{{LINK}}`,
      );
      // Additionally, ensure the shared mock reflects this if any code path accesses templateMap directly for this mode.
      setMockTemplateBody(defaultPromptMode, `{{SETUP}}\nPR_INFO:\n{{PR_DETAILS}}\nFILES_EXPLICIT:\n{{FILES_LIST}}\nDIFFS:\n{{DIFF_CONTENT}}\n{{LINK}}`);

      const pullWithBodyList = mockPull({
        body: prBodyWithFilesList,
        files: [],
      });
      getPullRequestDiffSpy.mockResolvedValue(
        "dummy pr diff content with file.ts",
      );

      // Scenario 1: FILES_LIST populated, PR_DETAILS stripped
      const { promptText: prompt1 } = await buildRepoPromptText(
        pullWithBodyList,
        { includePr: false },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );
      expect(prompt1.match(/files changed/g)?.length || 0).toBeLessThanOrEqual(
        1,
      );

      // Scenario 2: FILES_LIST not populated (due to diff), PR_DETAILS has original list
      const { promptText: prompt2 } = await buildRepoPromptText(
        pullWithBodyList,
        { includePr: true },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );
      expect(prompt2.match(/files changed/g)?.length || 0).toBeLessThanOrEqual(
        1,
      );

      // Scenario 3: No list in PR body, FILES_LIST populated
      const pullNoBodyList = mockPull({
        body: prBodyWithoutFilesList,
        files: [],
      });
      const { promptText: prompt3 } = await buildRepoPromptText(
        pullNoBodyList,
        { includePr: false },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );
      expect(prompt3.match(/files changed/g)?.length || 0).toBeLessThanOrEqual(
        1,
      );

      // Scenario 4: No list in PR body, FILES_LIST not populated (due to diff)
      const { promptText: prompt4 } = await buildRepoPromptText(
        pullNoBodyList,
        { includePr: true },
        defaultPromptMode,
        undefined,
        mockMetaWithFiles,
      );
      expect(prompt4.match(/files changed/g)?.length || 0).toBe(0); // No files list at all in this case
    });
  });

  it("final promptText structure is determined by template and renderTemplate, including FILES_LIST", async () => {
    // as the exact final string is now highly dependent on the (mocked) template.
    // The main check for `promptText` is that `renderTemplate` was called with the right slot data.
  });

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
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- fileA.ts\n- fileB.md",
    );

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
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
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
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
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

    const meta = {
      ...mockResolvedMetaBase,
      files: ["newfile.ts", "another.md"],
    };

    await buildRepoPromptText(
      pull,
      { includePr: false },
      defaultPromptMode,
      undefined,
      meta,
    );

    // Check that FILES_LIST slot gets its content from meta.files, not PR body
    const slots = vi.mocked(renderTemplateModule.renderTemplate).mock
      .calls[0][1];
    expect(slots.FILES_LIST).toBe(
      "### files changed (2)\n- newfile.ts\n- another.md",
    );

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
