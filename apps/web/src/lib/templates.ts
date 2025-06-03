import type { PromptMode } from "./repoprompt";

// Using direct import for simplicity in this example.
// In a real Vite project, ensure your tsconfig and Vite setup allow these ?raw imports.
import implementTemplate from "../prompt-templates/implement.md?raw";
import reviewTemplate from "../prompt-templates/review.md?raw";
import adjustPrTemplate from "../prompt-templates/adjust-pr.md?raw";
import respondTemplate from "../prompt-templates/respond.md?raw";

export const templateMap: Record<PromptMode, string> = {
  implement: implementTemplate,
  review: reviewTemplate,
  "adjust-pr": adjustPrTemplate,
  respond: respondTemplate,
};