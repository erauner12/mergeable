import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "../../src/lib/db";
import type { PromptMode } from "../../src/lib/repoprompt";
import {
  getPromptTemplate,
  setPromptTemplate,
  setBasePrompt, // For testing legacy interaction
  keyFor,
  getBasePrompt, // For testing legacy interaction
} from "../../src/lib/settings";
// ADDED: Mock templateMap
import * as templates from "../../src/lib/templates";

// Mock the templateMap from templates.ts
vi.mock("../../src/lib/templates", () => ({
  templateMap: {
    implement: "Implement MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM IMPLEMENT.MD",
    review: "Review MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM REVIEW.MD",
    "adjust-pr": "Adjust PR MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM ADJUST-PR.MD",
    respond: "Respond MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM RESPOND.MD",
  } as Record<PromptMode, string>,
}));


// REMOVED: Manually defined expectedDefaultPromptTemplates
// Defaults are now sourced from the mocked templateMap.

describe("settings prompt template helpers", () => {
  afterEach(async () => {
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  test.each([
    ["review" as PromptMode],
    ["adjust-pr" as PromptMode],
    ["respond" as PromptMode],
  ])("getPromptTemplate() returns default from templateMap for %s when no custom value is set", async (mode) => {
    await db.settings.clear(); // Ensure clean state
    const template = await getPromptTemplate(mode);
    // Compare against the mocked templateMap content
    expect(template).toBe(templates.templateMap[mode]);
  });

  test.each([
    ["review" as PromptMode, "CUSTOM_REVIEW_TEXT_FULL_TEMPLATE"],
    ["adjust-pr" as PromptMode, "CUSTOM_ADJUST_PR_TEXT_FULL_TEMPLATE"],
    ["respond" as PromptMode, "CUSTOM_RESPOND_TEXT_FULL_TEMPLATE"],
  ])("getPromptTemplate() returns custom value for %s when set", async (mode, customText) => {
    await db.settings.clear();
    await setPromptTemplate(mode, customText);
    const template = await getPromptTemplate(mode);
    expect(template).toBe(customText);
  });

  test("getPromptTemplate('implement') follows fallback chain: new key -> legacy key -> templateMap default", async () => {
    await db.settings.clear();

    // 1. Nothing in DB - should return default "implement" template from templateMap
    let implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe(templates.templateMap.implement);

    // 2. Only legacy key ('basePromptTemplate') present
    await db.settings.clear();
    await setBasePrompt("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");
    
    // Also check getBasePrompt directly - it should return the legacy value or templateMap.implement
    // Depending on its exact refined logic. For this test, we set it, so it should return it.
    expect(await getBasePrompt()).toBe("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");


    // 3. New key ('basePromptTemplate:implement') present - should override legacy
    await db.settings.clear();
    await setBasePrompt("LEGACY_STILL_HERE_BUT_OVERRIDDEN_FULL_TEMPLATE");
    await setPromptTemplate("implement", "NEW_IMPLEMENT_FULL_TEMPLATE_TEXT");
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("NEW_IMPLEMENT_FULL_TEMPLATE_TEXT");

    // Check that the legacy key was also updated by setPromptTemplate("implement", ...)
    const legacyValueAfterNewSet = await db.settings.get("basePromptTemplate");
    expect(legacyValueAfterNewSet?.value).toBe("NEW_IMPLEMENT_FULL_TEMPLATE_TEXT");
  });

  test("setPromptTemplate('implement', text) writes to both new key and legacy 'basePromptTemplate' key", async () => {
    await db.settings.clear();
    const syncText = "SYNCED_IMPLEMENT_FULL_TEMPLATE_TEXT";
    await setPromptTemplate("implement", syncText);

    const newKeyEntry = await db.settings.get(keyFor("implement"));
    const legacyKeyEntry = await db.settings.get("basePromptTemplate");

    expect(newKeyEntry?.value).toBe(syncText);
    expect(legacyKeyEntry?.value).toBe(syncText);
  });

  test("setPromptTemplate(mode, text) for non-'implement' modes only writes to new key", async () => {
    await db.settings.clear();
    const reviewText = "CUSTOM_REVIEW_ONLY_FULL_TEMPLATE_TEXT";
    await setPromptTemplate("review", reviewText);

    const reviewKeyEntry = await db.settings.get(keyFor("review"));
    const legacyKeyEntry = await db.settings.get("basePromptTemplate");

    expect(reviewKeyEntry?.value).toBe(reviewText);
    expect(legacyKeyEntry).toBeUndefined();
  });
});