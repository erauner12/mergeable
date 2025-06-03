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