import type { PromptMode } from "../../src/lib/repoprompt";

// Import raw template strings directly, similar to src/lib/templates.ts
import adjustPrTemplate from '../../src/prompt-templates/adjust-pr.md?raw';
import implementTemplate from '../../src/prompt-templates/implement.md?raw';
import respondTemplate from '../../src/prompt-templates/respond.md?raw';
import reviewTemplate from '../../src/prompt-templates/review.md?raw';

const rawTemplateMap: Record<PromptMode, string> = {
  "implement": implementTemplate,
  "review": reviewTemplate,
  "adjust-pr": adjustPrTemplate,
  "respond": respondTemplate,
};

/**
 * Loads the raw string content of a specified prompt template.
 * @param mode The prompt mode for which to load the template.
 * @returns The raw string content of the template.
 */
export function loadTemplate(mode: PromptMode): string {
  const templateContent = rawTemplateMap[mode];
  if (templateContent === undefined) {
    throw new Error(`Test helper loadTemplate: No template found for mode "${mode}"`);
  }
  return templateContent;
}