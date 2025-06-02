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
Binary files a/img.png and b/img.png differ
`;
const BINARY_DIFF = `${BINARY_DIFF_CONTENT}\n`;

const MULTI_FILE_DIFF = `${SIMPLE_DIFF}${BINARY_DIFF}`;

test("splitUnifiedDiff extracts per-file metadata", () => {
  const map = splitUnifiedDiff(MULTI_FILE_DIFF);

  expect(map["a.txt"]).toBeDefined();
  expect(map["a.txt"].path).toBe("a.txt");
  expect(map["a.txt"].lineCount).toBe(2); // +hello, +world
  expect(map["a.txt"].isBinary).toBe(false);
  expect(map["a.txt"].patch).toBe(SIMPLE_DIFF_CONTENT); // Check full patch content
  expect(map["a.txt"].byteCount).toBe(new TextEncoder().encode(SIMPLE_DIFF_CONTENT).length);

  expect(map["img.png"]).toBeDefined();
  expect(map["img.png"].path).toBe("img.png");
  expect(map["img.png"].lineCount).toBe(0); // Binary files have 0 line changes by this heuristic
  expect(map["img.png"].isBinary).toBe(true);
  expect(map["img.png"].patch).toBe(BINARY_DIFF_CONTENT);
  expect(map["img.png"].byteCount).toBe(new TextEncoder().encode(BINARY_DIFF_CONTENT).length);
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
  const allFilePaths = Object.keys(patches); // ["a.txt", "img.png"] or ["img.png", "a.txt"] depending on map order
                                          // buildClipboardPayload sorts them internally.

  const payload = buildClipboardPayload({
    selectedFiles: new Set(["a.txt"]),
    allFiles: allFilePaths,
    patches,
  });

  expect(payload).toMatch(/### files changed \(2\)/);
  // Order in header is sorted: a.txt then img.png
  expect(payload).toMatch(/- a\.txt\n- img\.png _\(binary file – diff omitted\)_/);
  expect(payload).toContain(SIMPLE_DIFF_CONTENT.trim());
  expect(payload).not.toContain("Binary files a/img.png and b/img.png differ");
});

test("buildClipboardPayload handles large text file omission", () => {
  const LARGE_TEXT_DIFF_CONTENT = `diff --git a/large.txt b/large.txt
--- a/large.txt
+++ b/large.txt
${Array(401).fill('+new line').join('\n')}
`;
  const patches: Record<string, PatchFileMetadata> = {
    "large.txt": {
      path: "large.txt",
      patch: LARGE_TEXT_DIFF_CONTENT,
      lineCount: 401,
      byteCount: new TextEncoder().encode(LARGE_TEXT_DIFF_CONTENT).length,
      isBinary: false,
    }
  };

  const payload = buildClipboardPayload({
    selectedFiles: new Set(), // Nothing selected
    allFiles: ["large.txt"],
    patches,
  });
  expect(payload).toMatch(/- large\.txt _\(401 lines – diff omitted\)_/);
  expect(payload).not.toContain("+new line");
});

test("buildClipboardPayload handles large byte size file omission", () => {
    const VERY_LONG_LINE_DIFF_CONTENT = `diff --git a/longline.js b/longline.js
--- a/longline.js
+++ b/longline.js
+${'a'.repeat(100_001)}
`;
  const patches: Record<string, PatchFileMetadata> = {
    "longline.js": {
      path: "longline.js",
      patch: VERY_LONG_LINE_DIFF_CONTENT,
      lineCount: 1,
      byteCount: 100_001 + 50, // approx byte count
      isBinary: false,
    }
  };
  const expectedKB = Math.round(patches["longline.js"].byteCount / 1024);

  const payload = buildClipboardPayload({
    selectedFiles: new Set(), // Nothing selected
    allFiles: ["longline.js"],
    patches,
  });
  const regex = new RegExp(`- longline\\.js _\\(${expectedKB} KB – diff omitted\\)_`);
  expect(payload).toMatch(regex);
});

test("buildClipboardPayload includes all selected files' patches", () => {
  const patches = splitUnifiedDiff(MULTI_FILE_DIFF);
  const allFilePaths = Object.keys(patches);

  const payload = buildClipboardPayload({
    selectedFiles: new Set(allFilePaths), // Select all
    allFiles: allFilePaths,
    patches,
  });

  expect(payload).toMatch(/- a\.txt\n- img\.png/);
  expect(payload).toContain(SIMPLE_DIFF_CONTENT.trim());
  expect(payload).toContain(BINARY_DIFF_CONTENT.trim());
});