// ADD: Import the shared mock helper. Should be one of the first imports.
import "../__mocks__/templates.mock";
// ADD: Import utilities from the shared mock.
import { setMockTemplateBody } from "../__mocks__/templates.mock";

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
// Import * as templates will now correctly point to the mocked module
import * as templates from "../../src/lib/templates";
// REMOVE: import type { TemplateMeta } from "../../src/lib/templates"; // Already imported by mock or not directly used here

// REMOVE: Mock templateMap (mockTemplateBodiesForSettings and the vi.mock block)
// const mockTemplateBodiesForSettings: Record<PromptMode, string> = {
//   implement: "Implement MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM IMPLEMENT.MD",
//   review: "Review MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM REVIEW.MD",
//   "adjust-pr": "Adjust PR MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM ADJUST-PR.MD",
//   respond: "Respond MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM RESPOND.MD",
// };
// vi.mock("../../src/lib/templates", async () => { ... });


// Defaults are now sourced from the mocked templateMap, configured via setMockTemplateBody.

describe("settings prompt template helpers", () => {
  beforeEach(() => {
    // Configure the template bodies for this test suite
    setMockTemplateBody("implement", "Implement MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM IMPLEMENT.MD");
    setMockTemplateBody("review", "Review MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM REVIEW.MD");
    setMockTemplateBody("adjust-pr", "Adjust PR MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM ADJUST-PR.MD");
    setMockTemplateBody("respond", "Respond MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM RESPOND.MD");
  });

  afterEach(async () => {
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  test.each([
    ["review" as PromptMode],
    ["adjust-pr" as PromptMode],
    ["respond" as PromptMode],
  ])("getPromptTemplate() returns default from templateMap.body for %s when no custom value is set", async (mode) => {
    await db.settings.clear(); // Ensure clean state
    const template = await getPromptTemplate(mode);
    // Compare against the mocked templateMap content (which is now dynamically generated)
    // templates.templateMap[mode].body will correctly access the mocked value.
    expect(template).toBe(templates.templateMap[mode].body);
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

    // 1. Nothing in DB - should return default "implement" template from templateMap.body
    let implementTemplate = await getPromptTemplate("implement");
    // templates.templateMap.implement.body will correctly access the mocked value.
    expect(implementTemplate).toBe(templates.templateMap.implement.body);

    // 2. Only legacy key ('basePromptTemplate') present
    await db.settings.clear();
    await setBasePrompt("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");

    // Also check getBasePrompt directly - it should return the legacy value or templateMap.implement.body
    // templates.templateMap.implement.body will correctly access the mocked value if legacy is not set.
    expect(await getBasePrompt()).toBe("LEGACY_IMPLEMENT_FULL_TEMPLATE_TEXT");

    // 3. New key ('basePromptTemplate:implement') present - should override legacy
    await db.settings.clear();
    await setBasePrompt("LEGACY_STILL_HERE_BUT_OVERRIDDEN_FULL_TEMPLATE");
    await setPromptTemplate("implement", "NEW_IMPLEMENT_FULL_TEMPLATE_TEXT");
    implementTemplate = await getPromptTemplate("implement");
    expect(implementTemplate).toBe("NEW_IMPLEMENT_FULL_TEMPLATE_TEXT");

    // Check that the legacy key was also updated by setPromptTemplate("implement", ...)
    const legacyValueAfterNewSet = await db.settings.get("basePromptTemplate");
    expect(legacyValueAfterNewSet?.value).toBe(
      "NEW_IMPLEMENT_FULL_TEMPLATE_TEXT",
    );
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