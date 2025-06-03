import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import type { PromptMode } from "../../src/lib/repoprompt";
import {
  getPromptTemplate,
  setPromptTemplate,
  setBasePrompt, // For testing legacy interaction
  keyFor,
  // defaultPromptTemplates, // Removed import
  getBasePrompt, // For testing legacy interaction
} from "../../src/lib/settings";

// Manually define expected default strings for tests, matching those in settings.ts
const expectedDefaultPromptTemplates: Record<PromptMode, string> = {
  implement:
    "### TASK\nReview the following pull-request diff and propose improvements.",
  review:
    "### TASK\nYou are reviewing the following pull-request diff and associated comments. Please provide constructive feedback, identify potential issues, and suggest improvements. Focus on clarity, correctness, performance, and adherence to coding standards.",
  "adjust-pr":
    "### TASK\nThe PR title and/or body may be stale or incomplete. Based on the provided context (PR details, diffs), draft an improved PR title and body. The title should be concise and follow conventional commit guidelines if applicable. The body should clearly explain the purpose of the changes, how they were implemented, and any relevant context for reviewers.",
  respond:
    "### TASK\nDraft a reply to the following comment thread(s). Address the questions or concerns raised, provide clarifications, or discuss the proposed changes. Be clear, concise, and constructive.",
};


describe("settings prompt template helpers", () => {
  afterEach(async () => {
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  test.each([
    ["review" as PromptMode],
    ["adjust-pr" as PromptMode],
    ["respond" as PromptMode],
  ])("getPromptTemplate() returns default for %s when no custom value is set", async (mode) => {
    await db.settings.clear(); // Ensure clean state
    const template = await getPromptTemplate(mode);
    expect(template).toBe(expectedDefaultPromptTemplates[mode]); // Compare against known default string
  });

  test.each([
    ["review" as PromptMode, "CUSTOM_REVIEW_TEXT"],
    ["adjust-pr" as PromptMode, "CUSTOM_ADJUST_PR_TEXT"],
    ["respond" as PromptMode, "CUSTOM_RESPOND_TEXT"],
  ])("getPromptTemplate() returns custom value for %s when set", async (mode, customText) => {
    await db.settings.clear();
    await setPromptTemplate(mode, customText);
    const template = await getPromptTemplate(mode);
    expect(template).toBe(customText);
  });

  test("getPromptTemplate('implement') follows fallback chain: new key -> legacy key -> default", async () => {
    await db.settings.clear();

    // 1. Nothing in DB - should return default "implement" template
    let implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe(expectedDefaultPromptTemplates.implement); // Compare against known default string

    // 2. Only legacy key ('basePromptTemplate') present
    await db.settings.clear(); // Clear again for isolation
    await setBasePrompt("LEGACY_IMPLEMENT_TEXT"); // Uses the old setter
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("LEGACY_IMPLEMENT_TEXT");
    // also check getBasePrompt directly
    expect(await getBasePrompt()).toBe("LEGACY_IMPLEMENT_TEXT");


    // 3. New key ('basePromptTemplate:implement') present - should override legacy
    await db.settings.clear();
    await setBasePrompt("LEGACY_STILL_HERE_BUT_OVERRIDDEN");
    await setPromptTemplate("implement", "NEW_IMPLEMENT_TEXT"); // Uses the new setter for "implement"
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("NEW_IMPLEMENT_TEXT");

    // Check that the legacy key was also updated by setPromptTemplate("implement", ...)
    const legacyValueAfterNewSet = await db.settings.get("basePromptTemplate");
    expect(legacyValueAfterNewSet?.value).toBe("NEW_IMPLEMENT_TEXT");
  });

  test("setPromptTemplate('implement', text) writes to both new key and legacy 'basePromptTemplate' key", async () => {
    await db.settings.clear();
    const syncText = "SYNCED_IMPLEMENT_TEXT";
    await setPromptTemplate("implement", syncText);

    const newKeyEntry = await db.settings.get(keyFor("implement"));
    const legacyKeyEntry = await db.settings.get("basePromptTemplate");

    expect(newKeyEntry?.value).toBe(syncText);
    expect(legacyKeyEntry?.value).toBe(syncText);
  });

  test("setPromptTemplate(mode, text) for non-'implement' modes only writes to new key", async () => {
    await db.settings.clear();
    const reviewText = "CUSTOM_REVIEW_ONLY_TEXT";
    await setPromptTemplate("review", reviewText);

    const reviewKeyEntry = await db.settings.get(keyFor("review"));
    const legacyKeyEntry = await db.settings.get("basePromptTemplate");

    expect(reviewKeyEntry?.value).toBe(reviewText);
    expect(legacyKeyEntry).toBeUndefined(); // Legacy key should not be touched for "review" mode
  });
});