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
import type { TemplateMeta } from "../../src/lib/templates"; // Import TemplateMeta

// Mock the templateMap from templates.ts
// Use the actual analyseTemplate to create valid meta objects for the mock bodies
const mockTemplateBodies: Record<PromptMode, string> = {
  implement: "Implement MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM IMPLEMENT.MD",
  review: "Review MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM REVIEW.MD",
  "adjust-pr": "Adjust PR MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM ADJUST-PR.MD",
  respond: "Respond MD Template {{SETUP}} {{PR_DETAILS}} {{DIFF_CONTENT}} {{LINK}} ### TASK FROM RESPOND.MD",
};

// Define a simple default meta object for the mock
const mockDefaultMetaForSettingsTest: TemplateMeta = {
  expectsFilesList: true,
  expectsDiffContent: true,
  expectsSetup: true,
  expectsLink: true,
  expectsPrDetails: true,
  expectsPrDetailsBlock: false,
};

vi.mock("../../src/lib/templates", async () => {
  const actualTemplates = await vi.importActual<typeof import("../../src/lib/templates")>("../../src/lib/templates");
  const mockedMap: Record<PromptMode, { body: string; meta: TemplateMeta }> = {} as any;
  for (const mode in mockTemplateBodies) {
    const body = mockTemplateBodies[mode as PromptMode];
    // For this mock, we can use actualAnalyseTemplate if it's safe,
    // or fall back to a simpler predefined meta if issues persist.
    // Given the error, it's safer to use a predefined or very simple meta here.
    // The key is that the `templateMap` export is immediately valid.
    mockedMap[mode as PromptMode] = {
      body,
      // Using actualAnalyseTemplate here is fine as long as this mock factory itself
      // isn't circularly depended upon by the `actualTemplates` import in a problematic way.
      // The original error was in repoprompt.test.ts's mock structure.
      // Let's keep using actualAnalyseTemplate for accuracy in this file's mock,
      // as settings.ts doesn't directly use analyseTemplate, only templateMap.
      meta: actualTemplates.analyseTemplate(body),
    };
  }
  return {
    ...actualTemplates,
    templateMap: mockedMap,
  };
});


// REMOVED: Manually defined expectedDefaultPromptTemplates