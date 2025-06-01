/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gh from "../../src/lib/github/client"; // ← stub network call
import { buildRepoPromptLink } from "../../src/lib/repoprompt";
import * as settings from "../../src/lib/settings";
// Assuming mockPull is imported from a shared testing utility like "../testing"
// If it's defined locally, ensure its signature matches the usage.
import { mockPull } from "../testing";

describe("buildRepoPromptLink", () => {
  beforeEach(() => {
    vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("dummy diff content");
    // Spy on settings functions for each test, will be restored in afterEach
    // Mock specific resolved values within each test as needed
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should build a valid repoprompt URL with default root", async () => {
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue("TEST_BASE_PROMPT");

    const pull = mockPull({
      repo: "owner/myrepo",
      number: 123,
      title: "My Test PR",
      body: "This is the body.",
      branch: "feature-branch",
      files: ["src/main.ts", "README.md"],
    });

    const link = await buildRepoPromptLink(pull, "workspace"); // Explicitly pass "workspace"

    expect(settings.getDefaultRoot).toHaveBeenCalled();
    // Ensure the URL starts with repoprompt://open?workspace=... and does not include the encoded path part
    // The repo name for "owner/myrepo" is "myrepo"
    // expect(link.startsWith(`repoprompt://open?workspace=${encodeURIComponent("myrepo")}`)).toBe(true); // Old assertion

    const urlObj = new URL(link);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.pathname).toBe(""); // Workspace mode deliberately omits the path

    const params = urlObj.searchParams;
    expect(params.get("workspace")).toBe("myrepo");
    expect(params.get("ephemeral")).toBe("false");
    expect(params.get("focus")).toBe("true");
    // files are URI-encoded individually; compare after decoding
    expect(params.get("files")!.split(",").map(decodeURIComponent)).toEqual([
      "src/main.ts",
      "README.md",
    ]);

    const decodedPrompt = params.get("prompt")!; // Value is already decoded by get()
    expect(decodedPrompt).toContain("## SETUP");
    expect(decodedPrompt).toContain("cd /tmp/myrepo");
    expect(decodedPrompt).toContain("git checkout feature-branch");
    expect(decodedPrompt).toContain("TEST_BASE_PROMPT");
    expect(decodedPrompt).toContain("### PR #123: My Test PR");
    expect(decodedPrompt).toContain("This is the body.");
    expect(decodedPrompt).toContain("### FULL DIFF");
    expect(decodedPrompt).toContain("dummy diff content");
    expect(decodedPrompt.trim().endsWith(`🔗 ${pull.url}`)).toBe(true);
  });

  it("should handle pull requests with no body", async () => {
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("~/git/work");
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue(
      "ANOTHER_BASE_PROMPT",
    );

    const pull = mockPull({
      repo: "another/repo",
      number: 42,
      title: "Simple PR",
      body: null, // Test null body
      branch: "fix-bug",
      files: ["path/to/file.js"],
    });

    const link = await buildRepoPromptLink(pull, "workspace"); // Explicitly pass "workspace"
    // Ensure the URL starts with repoprompt://open?workspace=...
    // The repo name for "another/repo" is "repo"
    // expect(link.startsWith(`repoprompt://open?workspace=${encodeURIComponent("repo")}`)).toBe(true); // Old assertion

    const urlObj = new URL(link);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.pathname).toBe(""); // Workspace mode deliberately omits the path

    const params = urlObj.searchParams;
    expect(params.get("workspace")).toBe("repo");
    expect(params.get("ephemeral")).toBe("false");
    expect(params.get("focus")).toBe("true");
    const decodedPrompt = params.get("prompt") || ""; // Value is already decoded by get()

    // files are URI-encoded individually; compare after decoding
    expect(params.get("files")!.split(",").map(decodeURIComponent)).toEqual([
      "path/to/file.js",
    ]);

    expect(decodedPrompt).toContain("## SETUP");
    expect(decodedPrompt).toContain("cd ~/git/work/repo");
    expect(decodedPrompt).toContain("git checkout fix-bug");
    expect(decodedPrompt).toContain("ANOTHER_BASE_PROMPT");
    expect(decodedPrompt).toContain("### PR #42: Simple PR");
    expect(decodedPrompt).not.toContain("null"); // Ensure null body is handled cleanly (empty string)
    expect(decodedPrompt).toContain("### FULL DIFF");
    expect(decodedPrompt).toContain("dummy diff content");
    expect(decodedPrompt.trim().endsWith(`🔗 ${pull.url}`)).toBe(true);
  });

  it("should handle special characters in paths, titles, and body", async () => {
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/projects");
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue(
      "SPECIAL_BASE_PROMPT",
    );

    const pull = mockPull({
      repo: "user/repo-name with spaces",
      number: 7,
      title: "PR with !@#$%^&*() characters",
      body: "Body with `backticks` and other symbols\nNewline here.",
      branch: "branch/with/slashes",
      files: ["file with spaces.txt", "another&file.py"],
    });

    const link = await buildRepoPromptLink(pull, "workspace"); // Explicitly pass "workspace"
    const rootPath = "/projects/repo-name with spaces";
    // Ensure the URL starts with repoprompt://open?workspace=...
    // The repo name for "user/repo-name with spaces" is "repo-name with spaces"
    // expect(link.startsWith(`repoprompt://open?workspace=${encodeURIComponent("repo-name with spaces")}`)).toBe(true); // Old assertion
    // The rootPath is still part of the prompt content, e.g. "cd /projects/repo-name with spaces"
    // expect(link).toContain(`repoprompt://open/${encodeURIComponent(rootPath)}`); // This assertion is no longer valid for the URL structure

    const urlObj = new URL(link);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.pathname).toBe(""); // Workspace mode deliberately omits the path

    const params = urlObj.searchParams;
    expect(params.get("workspace")).toBe("repo-name with spaces");
    expect(params.get("ephemeral")).toBe("false");
    expect(params.get("focus")).toBe("true");
    // files are URI-encoded individually; compare after decoding
    expect(params.get("files")!.split(",").map(decodeURIComponent)).toEqual([
      "file with spaces.txt",
      "another&file.py",
    ]);

    const decodedPrompt = params.get("prompt") || ""; // Value is already decoded by get()
    expect(decodedPrompt).toContain("## SETUP");
    expect(decodedPrompt).toContain(`cd ${rootPath}`); // rootPath already contains spaces
    expect(decodedPrompt).toContain("git checkout branch/with/slashes");
    expect(decodedPrompt).toContain("SPECIAL_BASE_PROMPT");
    expect(decodedPrompt).toContain("### PR #7: PR with !@#$%^&*() characters");
    expect(decodedPrompt).toContain(
      "Body with `backticks` and other symbols\nNewline here.",
    );
    expect(decodedPrompt).toContain("### FULL DIFF");
    expect(decodedPrompt).toContain("dummy diff content");
    expect(decodedPrompt.trim().endsWith(`🔗 ${pull.url}`)).toBe(true);
  });

  // ✅ NEW – verifies branch/files are fetched when missing
  it("fills missing branch & files via getPullRequestMeta()", async () => {
    // 1️⃣  Fake GitHub REST reply
    vi.spyOn(gh, "getPullRequestMeta").mockResolvedValue({
      branch: "fallback-branch",
      files: ["src/a.ts", "README.md"],
    });
    // Still stub the diff endpoint
    // getPullRequestDiff is already spied on in beforeEach, but it's fine to re-spy if needed,
    // or rely on the beforeEach spy. For clarity, let's assume beforeEach covers it.
    // If not, it would be: vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("dummy diff content");

    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue("BASE");

    // 2️⃣  Start with NO branch and NO files
    const pull = mockPull({
      repo: "owner/repo",
      number: 99,
      title: "Empty meta PR",
      body: "",
      branch: "", // intentionally empty
      files: [], // intentionally empty
    });

    const url = await buildRepoPromptLink(pull, "workspace"); // Explicitly pass "workspace"

    // 3️⃣  Expectations --------------------------------------------------------
    // helper must be called
    expect(gh.getPullRequestMeta).toHaveBeenCalledWith("owner", "repo", 99);

    const urlObj = new URL(url);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.pathname).toBe(""); // Workspace mode deliberately omits the path

    const params = urlObj.searchParams;
    expect(params.get("workspace")).toBe("repo");
    expect(params.get("ephemeral")).toBe("false");
    expect(params.get("focus")).toBe("true");
    expect(params.get("files")!.split(",").map(decodeURIComponent)).toEqual([
      "src/a.ts",
      "README.md",
    ]);
    const prompt = params.get("prompt")!;
    expect(prompt).toContain("git checkout fallback-branch");
  });

  it("builds folder-mode URL (ephemeral)", async () => {
    vi.spyOn(settings, "getDefaultRoot").mockResolvedValue("/tmp");
    vi.spyOn(settings, "getBasePrompt").mockResolvedValue("BASE");
    // getPullRequestDiff is spied in beforeEach
    // vi.spyOn(gh, "getPullRequestDiff").mockResolvedValue("diff");
    const pull = mockPull({
      repo: "acme/foo",
      number: 1,
      branch: "main",
      files: ["a.ts"],
    });

    const link = await buildRepoPromptLink(pull, "folder");

    const urlObj = new URL(link);
    expect(urlObj.protocol).toBe("repoprompt:");
    expect(urlObj.host).toBe("open");
    expect(urlObj.pathname).toBe("/%2Ftmp%2Ffoo"); // path segment present and encoded

    const params = urlObj.searchParams;
    expect(params.get("ephemeral")).toBe("true");
    expect(params.get("focus")).toBe("true");
    expect(params.has("workspace")).toBe(false); // no workspace flag
    expect(params.get("files")!.split(",").map(decodeURIComponent)).toEqual([
      "a.ts",
    ]);
    const prompt = params.get("prompt")!;
    expect(prompt).toContain("cd /tmp/foo");
    expect(prompt).toContain("git checkout main");
  });
});