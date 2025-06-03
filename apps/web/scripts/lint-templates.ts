#!/usr/bin/env node
import { analyseTemplate, type TemplateMeta, isStandard, REQUIRED_SLOTS } from '../src/lib/templates'; // Adjust path as needed

// Import raw template strings
import adjustPrTemplate from '../src/prompt-templates/adjust-pr.md?raw';
import implementTemplate from '../src/prompt-templates/implement.md?raw';
import respondTemplate from '../src/prompt-templates/respond.md?raw';
import reviewTemplate from '../src/prompt-templates/review.md?raw';

interface TemplateInfo {
  name: string;
  content: string;
  meta: TemplateMeta;
}

const templates: TemplateInfo[] = [
  { name: 'implement.md', content: implementTemplate, meta: analyseTemplate(implementTemplate) },
  { name: 'review.md', content: reviewTemplate, meta: analyseTemplate(reviewTemplate) },
  { name: 'adjust-pr.md', content: adjustPrTemplate, meta: analyseTemplate(adjustPrTemplate) },
  { name: 'respond.md', content: respondTemplate, meta: analyseTemplate(respondTemplate) },
];

let hasErrors = false;

console.log('Linting prompt templates...');

for (const template of templates) {
  console.log(`\nLinting ${template.name}:`);

  // Rule 1: Check overall standardness (includes PR details token logic and all other required tokens)
  if (isStandard(template.meta)) {
    console.log(`  ✅ Template conforms to the standard contract.`);
  } else {
    console.error(`🛑 ${template.name} does not conform to the standard template contract.`);
    // Provide more specific feedback:
    REQUIRED_SLOTS.forEach(slotKeyPartial => {
      const slotKey = slotKeyPartial as keyof TemplateMeta; // e.g. "expectsSetup"
      if (!template.meta[`expects${slotKeyPartial}` as keyof TemplateMeta]) {
        console.error(`     Missing required token: {{${slotKeyPartial.replace(/([A-Z])/g, "_$1").toUpperCase().substring(1)}}} (expects${slotKeyPartial})`);
      }
    });
    if (!template.meta.expectsPrDetails && !template.meta.expectsPrDetailsBlock) {
      console.error(`     Missing PR details token: requires one of {{PR_DETAILS}} or {{prDetailsBlock}}.`);
    }
    if (template.meta.expectsPrDetails && template.meta.expectsPrDetailsBlock) {
      console.error(`     Includes both {{PR_DETAILS}} and {{prDetailsBlock}}. Choose exactly one.`);
    }
    hasErrors = true;
  }

  // Rule 2: (Old rule about FILES_LIST/DIFF_CONTENT exclusivity is removed as both are now required by isStandard)
  // isStandard already checks for expectsFilesList and expectsDiffContent.
  // No further specific checks needed here for those two unless there are mode-specific *additional* requirements.
  // The prompt was: "respond.md is allowed to have both because FILES_LIST is conditionally rendered."
  // This conditionality is gone. All templates must have both.

  // Example of a mode-specific check (if any were needed beyond `isStandard`):
  // if (template.name === 'respond.md') {
  //   // any respond.md specific checks
  // }
}

if (hasErrors) {
  console.error('\nTemplate linting failed with errors.');
  process.exit(1);
} else {
  console.log('\nAll prompt templates passed linting.');
  process.exit(0);
}