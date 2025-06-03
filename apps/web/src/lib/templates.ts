import type { PromptMode } from "./repoprompt";

// Using direct import for simplicity in this example.
// In a real Vite project, ensure your tsconfig and Vite setup allow these ?raw imports.
import adjustPrTemplate from "../prompt-templates/adjust-pr.md?raw";
import implementTemplate from "../prompt-templates/implement.md?raw";
import respondTemplate from "../prompt-templates/respond.md?raw";
import reviewTemplate from "../prompt-templates/review.md?raw";

export interface TemplateMeta {
  expectsFilesList: boolean;
  expectsSetup: boolean;
  expectsLink: boolean;
  expectsPrDetails: boolean;
  expectsPrDetailsBlock: boolean;
  expectsDiffContent: boolean;
}

export function analyseTemplate(tpl: string): TemplateMeta {
  return {
    expectsFilesList: tpl.includes("{{FILES_LIST}}"),
    expectsSetup: tpl.includes("{{SETUP}}"),
    expectsLink: tpl.includes("{{LINK}}"),
    expectsPrDetails: tpl.includes("{{PR_DETAILS}}"),
    expectsPrDetailsBlock: tpl.includes("{{prDetailsBlock}}"),
    expectsDiffContent: tpl.includes("{{DIFF_CONTENT}}"),
  };
}

// Defines tokens that are strictly required in a standard template,
// besides the PR_DETAILS/prDetailsBlock pair.
export const REQUIRED_SLOTS = [
  "Setup",
  "Link",
  "FilesList",
  "DiffContent",
] as const; // Use PascalCase to match TemplateMeta properties like 'expectsSetup'

/**
 * Checks if a template's metadata conforms to the standard template contract.
 * A standard template must expect:
 * - SETUP, LINK, FILES_LIST, DIFF_CONTENT
 * - Exactly one of PR_DETAILS or prDetailsBlock
 */
export function isStandard(meta: TemplateMeta): boolean {
  const hasAllRequiredSlots = REQUIRED_SLOTS.every(
    (slot) => meta[`expects${slot}` as keyof TemplateMeta],
  );
  const hasOnePrDetailsToken =
    (meta.expectsPrDetails && !meta.expectsPrDetailsBlock) ||
    (!meta.expectsPrDetails && meta.expectsPrDetailsBlock);

  return hasAllRequiredSlots && hasOnePrDetailsToken;
}


export const templateMap: Record<
  PromptMode,
  { body: string; meta: TemplateMeta }
> = {
  implement: {
    body: implementTemplate,
    meta: analyseTemplate(implementTemplate),
  },
  review: { body: reviewTemplate, meta: analyseTemplate(reviewTemplate) },
  "adjust-pr": {
    body: adjustPrTemplate,
    meta: analyseTemplate(adjustPrTemplate),
  },
  respond: { body: respondTemplate, meta: analyseTemplate(respondTemplate) },
};