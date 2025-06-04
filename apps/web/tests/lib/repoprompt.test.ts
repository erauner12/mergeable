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
import type { PromptMode } from "../../src/lib/repoprompt";
import type { TemplateMeta } from "../../src/lib/templates";

// Declare variables that will be initialized in beforeAll
let originalTemplateMapDeepCopy: Record<
  PromptMode,
  { body: string; meta: TemplateMeta }
>;
let actualAnalyseTemplateFn: (tpl: string) => TemplateMeta;
let actualIsStandardFn: (meta: TemplateMeta) => boolean;
let actualRequiredSlots: readonly string[];
const mutableMockedTemplateMap: Record<
  PromptMode,
  { body: string; meta: TemplateMeta }
> = {} as Record<PromptMode, { body: string; meta: TemplateMeta }>;

// Move the vi.mock for templates to the very top, before any imports that might transitively import it
vi.mock("../../src/lib/templates", () => ({
  __esModule: true,
  get templateMap() {
    return mutableMockedTemplateMap;
  },
  analyseTemplate: (...args: Parameters<typeof actualAnalyseTemplateFn>) =>
    actualAnalyseTemplateFn(...args),
  get isStandard() {
    return actualIsStandardFn;
  },
  get REQUIRED_SLOTS() {
    return actualRequiredSlots;
  },
}));

beforeAll(async () => {
  const actualTemplatesModule = await vi.importActual<
    typeof import("../../src/lib/templates")
  >("../../src/lib/templates");
  originalTemplateMapDeepCopy = structuredClone(
    actualTemplatesModule.templateMap,
  );
  actualAnalyseTemplateFn = actualTemplatesModule.analyseTemplate;
  actualIsStandardFn = actualTemplatesModule.isStandard;
  actualRequiredSlots = actualTemplatesModule.REQUIRED_SLOTS;

  // Populate mutableMockedTemplateMap after actuals are loaded
  const initialCopy = structuredClone(originalTemplateMapDeepCopy);
  for (const key in initialCopy) {
    if (key in initialCopy) {
      mutableMockedTemplateMap[key as PromptMode] =
        initialCopy[key as PromptMode];
    }
  }
});

// Now, other imports that might depend on the mocked "../../src/lib/templates" can follow
import * as gh from "../../src/lib/github/client"; // ← stub network call
import { buildRepoPromptUrl } from "../../src/lib/repoprompt";
import * as settings from "../../src/lib/settings";
import { mockPull } from "../testing";

// Mock renderTemplate to check its inputs and control its output
vi.mock("../../src/lib/renderTemplate", () => ({
  renderTemplate: vi.fn((template: string, slots: Record<string, unknown>) => {
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
          !/^\s*{{\s*\w+\s*}}\s*$/.test(line.trim()) && line.trim().length > 0,
      )
      .join("\n");
    return result.trim();
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

// Contract tests imports and tests
import { buildRepoPromptText } from "../../src/lib/repoprompt";
import { REQUIRED_SLOTS, isStandard } from "../../src/lib/templates";
import { stripFilesListSection } from "../../src/lib/utils/stripFilesList";
import { setupTestContext, type TestContext } from "../helpers/buildContext";

describe("buildRepoPromptText - Contract Tests", () => {
  let context: TestContext;

  beforeEach(() => {
    // Common setup is handled by setupTestContext, called within each test or describe.each
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress console.warn for cleaner test output
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test suite for each prompt mode
  describe.each([
    "implement",
    "review",
    "adjust-pr",
    "respond",
  ] as const)("Contract for '%s' template", (mode) => {
    beforeEach(() => {
      context = setupTestContext(mode);
      // Ensure the loaded template for the mode is standard
      expect(isStandard(context.currentModeTemplate.meta),
        `Template for mode "${mode}" is not standard according to isStandard helper. Check template file or isStandard logic.`)
        .toBe(true);
    });

    it("produces a prompt by calling renderTemplate once with all required non-empty slots, and has correct headers", async () => {
      const { mockPullInstance, mockMeta, spies } = context;
      const diffOptions = { includePr: true, includeComments: true };

      const { promptText, blocks } = await buildRepoPromptText(
        mockPullInstance,
        diffOptions, // Include options to exercise more code paths
        mode,
        { auth: "test-token", baseUrl: "https://api.github.com" }, // Mock endpoint
        mockMeta,
      );

      // 1. renderTemplate was called exactly once
      expect(spies.renderTemplateSpy).toHaveBeenCalledTimes(1);

      // 2. All mandatory slots were supplied to renderTemplate and were non-empty strings
      const renderCallArgs = spies.renderTemplateSpy.mock.calls[0];
      const templateBodyUsed = renderCallArgs?.[0] as string;
      const slotsSupplied = renderCallArgs?.[1] as Record<string, string>;

      expect(templateBodyUsed).toBe(context.currentModeTemplate.body);

      // Check REQUIRED_SLOTS (SETUP, LINK, FILES_LIST, DIFF_CONTENT)
      REQUIRED_SLOTS.forEach((slotKeyPartial) => {
        // Convert from PascalCase (like 'FilesList') to UPPER_SNAKE_CASE (like 'FILES_LIST')
        const slotKey = slotKeyPartial
          .replace(/([A-Z])/g, "_$1")
          .toUpperCase()
          .substring(1); // Remove leading underscore
        
        expect(slotsSupplied[slotKey], `Slot ${slotKey} should exist`).toBeDefined();
        expect(slotsSupplied[slotKey]?.trim(), `Slot ${slotKey} should not be empty`).not.toBe("");
      });
      
      // Check PR_DETAILS / prDetailsBlock logic
      const usesPrDetails = context.currentModeTemplate.meta.expectsPrDetails;
      const usesPrDetailsBlock = context.currentModeTemplate.meta.expectsPrDetailsBlock;

      expect(usesPrDetails || usesPrDetailsBlock, "Template meta should expect PR_DETAILS or prDetailsBlock").toBe(true);
      expect(usesPrDetails && usesPrDetailsBlock, "Template meta should not expect both PR_DETAILS and prDetailsBlock").toBe(false);

      if (usesPrDetails) {
        expect(slotsSupplied.PR_DETAILS, "Slot PR_DETAILS should exist and be non-empty").toBeDefined();
        expect(slotsSupplied.PR_DETAILS?.trim()).not.toBe("");
        expect(slotsSupplied.prDetailsBlock, "Slot prDetailsBlock should be empty if PR_DETAILS is used").toBe("");
      }
      if (usesPrDetailsBlock) {
        expect(slotsSupplied.prDetailsBlock, "Slot prDetailsBlock should exist and be non-empty").toBeDefined();
        expect(slotsSupplied.prDetailsBlock?.trim()).not.toBe("");
        // PR_DETAILS slot will still contain the full PR details string, but renderTemplate will effectively ignore it if not in template.
        expect(slotsSupplied.PR_DETAILS, "Slot PR_DETAILS should still be defined").toBeDefined();
      }

      // 3. Final promptText contains one ## SETUP and one ### files changed header
      //    (assuming templates correctly include these headers now)
      const setupHeaderCount = (promptText.match(/^## SETUP$/gm) ?? []).length;
      expect(setupHeaderCount, "Prompt text should contain exactly one '## SETUP' header").toBe(1);
      
      // The files list header might be slightly different in templates, e.g. "### files changed" vs "### Files Changed"
      // The standard is "### files changed" in the new templates.
      const filesListHeaderCount = (promptText.match(/^### files changed$/gm) ?? []).length;
      expect(filesListHeaderCount, "Prompt text should contain exactly one '### files changed' header").toBe(1);

      // 4. PR Details content check (from PR body, stripped)
      const strippedBody = stripFilesListSection(mockPullInstance.body ?? "");
      expect(strippedBody).not.toContain("### files changed"); // Ensure stripping worked
      
      // The PR details content (title + stripped body) should be in the prompt
      expect(promptText).toContain(mockPullInstance.title);
      // Be careful with matching multi-line bodies. Check for a significant part.
      if (strippedBody.includes("Test PR body content.")) {
         expect(promptText).toContain("Test PR body content.");
      }

      // 5. DIFF_CONTENT check (if includePr was true)
      if (mockMeta.files && mockMeta.files.length > 0) {
         expect(slotsSupplied.FILES_LIST).toContain(mockMeta.files[0]);
      } else {
         expect(slotsSupplied.FILES_LIST).toContain("No files changed");
      }
      
      expect(slotsSupplied.DIFF_CONTENT).toContain("diff --git a/file.ts b/file.ts"); // From mock getPullRequestDiff

      // 6. LINK check
      expect(slotsSupplied.LINK).toContain(mockPullInstance.url);

      // 7. Blocks array should NOT contain PR details block, but should contain other fetched blocks (e.g., comments if includeComments=true)
      const prDetailsBlockInArray = blocks.find(b => b.id.startsWith('pr-details-'));
      expect(prDetailsBlockInArray, "PR Details block should not be in the returned 'blocks' array").toBeUndefined();
      
      // If comments were included, they should be in the blocks array
      if (spies.fetchPullCommentsSpy.mock.calls.length > 0) {
        const mockComments = await spies.fetchPullCommentsSpy.mock.results[0].value;
        if (mockComments.length > 0) {
          expect(blocks.some(b => b.id === mockComments[0].id)).toBe(true);
        }
      }
      // Diff block should be present if includePr was true
      if (diffOptions.includePr) {
          const diffBlockInArray = blocks.find(b => b.kind === 'diff' && b.id.startsWith('diff-pr-'));
          expect(diffBlockInArray, "PR Diff block should be in the returned 'blocks' array if includePr is true").toBeDefined();
      }
    });

    it("throws an error if a non-standard template is forced (e.g. via bad custom template)", async () => {
        const { mockPullInstance, mockMeta, spies } = context;
        
        // Simulate a non-standard template being returned by settings
        const nonStandardTemplateBody = "This is {{SETUP}} but missing other requireds.";
        spies.getPromptTemplateSpy.mockResolvedValue(nonStandardTemplateBody);

        await expect(buildRepoPromptText(
            mockPullInstance, {}, mode, undefined, mockMeta
        )).rejects.toThrowError(/Template for mode ".*" is not standard/);
    });
  });
});