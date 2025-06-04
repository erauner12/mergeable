import type { PromptMode } from "../../src/lib/repoprompt";
import type { TemplateMeta } from "../../src/lib/templates";
// Import the REAL analyseTemplate from the actual module
import { analyseTemplate as actualAnalyseTemplateOriginal } from "../../src/lib/templates";

// This is the mutable store for template bodies that tests can modify.
// Tests should call setMockTemplateBody to update these values.
export const mockableTemplateBodies: Record<PromptMode, string> = {
  implement: "Default Mock Implement Body from Helper",
  review: "Default Mock Review Body from Helper",
  "adjust-pr": "Default Mock Adjust PR Body from Helper",
  respond: "Default Mock Respond Body from Helper",
};

// Function for tests to call to change the template body for a mode.
export function setMockTemplateBody(mode: PromptMode, body: string): void {
  mockableTemplateBodies[mode] = body;
}

// Function for tests to get the real analyseTemplate if needed for ad-hoc analysis.
export { actualAnalyseTemplateOriginal as actualAnalyseTemplate };

// Vitest hoisted mock factory
// This mocks the module at "../../../src/lib/templates"
vi.mock("../../../src/lib/templates", async () => {
  // Import actual module to retain other exports and get its analyseTemplate
  const actualTemplatesModule = await vi.importActual<
    typeof import("../../src/lib/templates")
  >("../../src/lib/templates");

  return {
    ...actualTemplatesModule, // Spread all other exports from the original module
    // Override templateMap with a getter to allow dynamic updates via setMockTemplateBody
    get templateMap() {
      const newMap: Record<PromptMode, { body: string; meta: TemplateMeta }> =
        {} as any;
      // Use mockableTemplateBodies which can be changed by tests
      for (const modeKey in mockableTemplateBodies) {
        const mode = modeKey as PromptMode;
        const body = mockableTemplateBodies[mode];
        newMap[mode] = {
          body,
          // Use the analyseTemplate from the *actual* module for generating meta
          meta: actualTemplatesModule.analyseTemplate(body),
        };
      }
      return newMap;
    },
    // Ensure analyseTemplate export from the mock points to the original one.
    // Spreading actualTemplatesModule already does this if analyseTemplate is an export.
    // For clarity and safety, we can re-export it explicitly.
    analyseTemplate: actualTemplatesModule.analyseTemplate,
  };
});
