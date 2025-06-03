#!/usr/bin/env node
import { analyseTemplate, type TemplateMeta } from '../src/lib/templates'; // Adjust path as needed

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

  // Rule 1: Never include both {{PR_DETAILS}} and {{prDetailsBlock}}.
  if (template.meta.expectsPrDetails && template.meta.expectsPrDetailsBlock) {
    console.error(`🛑 ${template.name} includes both {{PR_DETAILS}} and {{prDetailsBlock}}. Choose exactly one.`);
    hasErrors = true;
  } else {
    console.log(`  ✅ PR details token usage is valid.`);
  }

  // Rule 2: {{FILES_LIST}} and {{DIFF_CONTENT}} exclusivity (with exception for respond.md)
  // respond.md is allowed to have both because FILES_LIST is conditionally rendered.
  if (template.name === 'respond.md') {
    if (!template.meta.expectsFilesList || !template.meta.expectsDiffContent) {
        console.warn(`  ⚠️ ${template.name} is expected to have both {{FILES_LIST}} and {{DIFF_CONTENT}}. Currently: FILES_LIST=${template.meta.expectsFilesList}, DIFF_CONTENT=${template.meta.expectsDiffContent}`);
        // Not a hard error, but a warning if respond.md deviates from expectation.
    } else {
        console.log(`  ✅ ${template.name} specific token usage for FILES_LIST and DIFF_CONTENT is valid.`);
    }
  } else {
    if (template.meta.expectsFilesList && template.meta.expectsDiffContent) {
      console.error(`🛑 ${template.name} includes both {{FILES_LIST}} and {{DIFF_CONTENT}}. Choose exactly one, or use conditional rendering if appropriate (like respond.md).`);
      hasErrors = true;
    } else {
      console.log(`  ✅ FILES_LIST/DIFF_CONTENT token usage is valid.`);
    }
  }
}

if (hasErrors) {
  console.error('\nTemplate linting failed with errors.');
  process.exit(1);
} else {
  console.log('\nAll prompt templates passed linting.');
  process.exit(0);
}
