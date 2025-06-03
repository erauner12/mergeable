import { expect, test } from "vitest";
import { splitUnifiedDiff, buildClipboardPayload, type PatchFileMetadata } from "../../../src/lib/github/diffUtils"; // Corrected path

const SIMPLE_DIFF_CONTENT = `diff --git a/a.txt b/a.txt
index 0000000..1111111 100644
--- a/a.txt
+++ b/a.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
const SIMPLE_DIFF = `${SIMPLE_DIFF_CONTENT}\n`; // Ensure trailing newline for consistency if splitUnifiedDiff expects it

const BINARY_DIFF_CONTENT = `diff --git a/img.png b/img.png
index 0000000..2222222 100644
Binary files a/img.png and b/img.png differ`; // Removed explicit \n here, will add to BINARY_DIFF

const BINARY_DIFF = `${BINARY_DIFF_CONTENT}\n`; // Add newline here for consistency with SIMPLE_DIFF

const MULTI_FILE_DIFF = `${SIMPLE_DIFF}${BINARY_DIFF}`;

test("splitUnifiedDiff extracts per-file metadata", () => {
  const map = splitUnifiedDiff(MULTI_FILE_DIFF);

  expect(map["a.txt"]).toBeDefined();
  expect(map["a.txt"].path).toBe("a.txt");
  expect(map["a.txt"].lineCount).toBe(2); // +hello, +world
  expect(map["a.txt"].isBinary).toBe(false);
  expect(map["a.txt"].patch).toBe(SIMPLE_DIFF_CONTENT); // Correct: non-last patch content
  expect(map["a.txt"].byteCount).toBe(new TextEncoder().encode(SIMPLE_DIFF_CONTENT).length);

  expect(map["img.png"]).toBeDefined();
  expect(map["img.png"].path).toBe("img.png");
  expect(map["img.png"].lineCount).toBe(0); // Binary files have 0 line changes by this heuristic
  expect(map["img.png"].isBinary).toBe(true);
  // Corrected: The last patch from a newline-terminated multi-diff will include its trailing newline.
  // BINARY_DIFF is defined as BINARY_DIFF_CONTENT + '\n'.
  expect(map["img.png"].patch).toBe(BINARY_DIFF);
  expect(map["img.png"].byteCount).toBe(new TextEncoder().encode(BINARY_DIFF).length);
});

test("splitUnifiedDiff handles empty or whitespace-only diff string", () => {
  expect(splitUnifiedDiff("")).toEqual({});
  expect(splitUnifiedDiff("   \n   ")).toEqual({});
});

test("splitUnifiedDiff handles diff with only one file", () => {
  const map = splitUnifiedDiff(SIMPLE_DIFF);
  expect(Object.keys(map).length).toBe(1);
  expect(map["a.txt"]).toBeDefined();
  expect(map["a.txt"].path).toBe("a.txt");
  expect(map["a.txt"].lineCount).toBe(2);
});


test("buildClipboardPayload respects selection & omission reasons", () => {
  const patches = splitUnifiedDiff(MULTI_FILE_DIFF);
  const allFilePaths = Object.keys(patches).sort(); // Ensure consistent order

  // Case 1: Select only a.txt
  const payloadOneSelected = buildClipboardPayload({
    selectedFiles: new Set(["a.txt"]),
    allFiles: allFilePaths,
    patches,
  });
  // patches["a.txt"].patch is SIMPLE_DIFF_CONTENT. .trim() is a no-op here.
  expect(payloadOneSelected).toBe(SIMPLE_DIFF_CONTENT.trim());
  expect(payloadOneSelected).not.toContain("img.png");
  expect(payloadOneSelected).not.toMatch(/### files changed/); // Ensure no header

  // Case 2: Select only img.png
  const payloadImgSelected = buildClipboardPayload({
    selectedFiles: new Set(["img.png"]),
    allFiles: allFilePaths,
    patches,
  });
  // patches["img.png"].patch is BINARY_DIFF (BINARY_DIFF_CONTENT + '\n'). .trim() removes the newline.
  expect(payloadImgSelected).toBe(BINARY_DIFF_CONTENT.trim());
  expect(payloadImgSelected).not.toContain("a.txt");
  expect(payloadImgSelected).not.toMatch(/### files changed/); // Ensure no header

  // Case 3: Select none
  const payloadNoneSelected = buildClipboardPayload({
    selectedFiles: new Set(),
    allFiles: allFilePaths,
    patches,
  });
  expect(payloadNoneSelected).toBe("");
  expect(payloadNoneSelected).not.toMatch(/### files changed/); // Ensure no header
});

test("buildClipboardPayload includes all selected files' patches", () => {
  const patches = splitUnifiedDiff(MULTI_FILE_DIFF);
  const allFilePaths = Object.keys(patches).sort(); // Ensures ["a.txt", "img.png"]

  const payload = buildClipboardPayload({
    selectedFiles: new Set(allFilePaths), // Select all
    allFiles: allFilePaths,
    patches,
  });

  // patches["a.txt"].patch.trim() is SIMPLE_DIFF_CONTENT
  // patches["img.png"].patch.trim() is BINARY_DIFF_CONTENT
  const expectedSortedPatchesContent = allFilePaths
    .map(p => (p === "a.txt" ? SIMPLE_DIFF_CONTENT.trim() : BINARY_DIFF_CONTENT.trim()))
    .join('\n');

  expect(payload).toBe(expectedSortedPatchesContent);
  expect(payload).toContain(SIMPLE_DIFF_CONTENT.trim());
  expect(payload).toContain(BINARY_DIFF_CONTENT.trim());
  expect(payload).not.toMatch(/### files changed/); // Ensure no header
  expect(payload).not.toMatch(/- a\.txt/); // Ensure no file list items
  expect(payload).not.toMatch(/- img\.png/);
});