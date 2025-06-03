import { expect, test } from "vitest";
import { joinBlocks, SECTION_SEPARATOR } from "../../src/lib/utils/promptFormat";

test("joinBlocks removes empties and uses canonical separator", () => {
  const out = joinBlocks(["A", "", "B\n", " ", "C"]);
  expect(out).toBe(`A${SECTION_SEPARATOR}B${SECTION_SEPARATOR}C`);
});

test("joinBlocks handles all empty or whitespace strings correctly", () => {
  expect(joinBlocks(["", "  ", ""])).toBe(""); // filter(part => part && part.trim()) removes "  "
  expect(joinBlocks([])).toBe("");
  expect(joinBlocks(["", ""])).toBe("");
});

test("joinBlocks with single element", () => {
  expect(joinBlocks(["A"])).toBe("A");
  expect(joinBlocks(["  "])).toBe(""); // filter(part => part && part.trim()) removes "  "
});

test("joinBlocks with multiple elements", () => {
  expect(joinBlocks(["A", "B", "C"])).toBe(`A${SECTION_SEPARATOR}B${SECTION_SEPARATOR}C`);
});

test("joinBlocks with elements containing newlines", () => {
  expect(joinBlocks(["A\n", "\nB", "C"])).toBe(`A${SECTION_SEPARATOR}\nB${SECTION_SEPARATOR}C`);
});