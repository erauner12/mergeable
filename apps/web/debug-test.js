// Quick debug script to test formatPromptBlock
import { formatPromptBlock } from './src/lib/repoprompt.js';

const blockB1 = {
  id: "b1",
  kind: "comment",
  header: "### B1",
  commentBody: "Block1",
  author: "a",
  timestamp: "2024-01-01T00:00:00Z",
};

console.log('Input block:', JSON.stringify(blockB1, null, 2));
const result = formatPromptBlock(blockB1);
console.log('formatPromptBlock result:');
console.log(JSON.stringify(result));
console.log('Raw result:');
console.log(result);
console.log('After trimEnd():');
console.log(result.trimEnd());
