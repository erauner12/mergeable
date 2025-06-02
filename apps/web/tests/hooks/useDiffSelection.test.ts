import { renderHook, act } from "@testing-library/react";
import { useDiffSelection } from "../../src/hooks/useDiffSelection"; // Corrected path
import { expect, test } from "vitest";

const FILES = ["foo.ts", "bar.js", "baz.md"];

test("initializes with defaultChecked true by default", () => {
  const { result } = renderHook(() => useDiffSelection(FILES));
  expect(result.current[0]).toEqual({
    "foo.ts": true,
    "bar.js": true,
    "baz.md": true,
  });
});

test("initializes with defaultChecked false when specified", () => {
  const { result } = renderHook(() =>
    useDiffSelection(FILES, /*defaultChecked=*/ false)
  );
  expect(result.current[0]).toEqual({
    "foo.ts": false,
    "bar.js": false,
    "baz.md": false,
  });
});

test("toggleFile correctly changes a single file's checked state", () => {
  const { result } = renderHook(() => useDiffSelection(FILES, true));

  act(() => {
    result.current[1]("bar.js"); // Toggle bar.js
  });
  expect(result.current[0]).toEqual({
    "foo.ts": true,
    "bar.js": false,
    "baz.md": true,
  });

  act(() => {
    result.current[1]("bar.js"); // Toggle bar.js again
  });
  expect(result.current[0]).toEqual({
    "foo.ts": true,
    "bar.js": true,
    "baz.md": true,
  });
});

test("setAllFiles checks all files when passed true", () => {
  const { result } = renderHook(() => useDiffSelection(FILES, false)); // Start with all unchecked

  act(() => {
    result.current[2](true); // Set all to true
  });
  expect(result.current[0]).toEqual({
    "foo.ts": true,
    "bar.js": true,
    "baz.md": true,
  });
});

test("setAllFiles unchecks all files when passed false", () => {
  const { result } = renderHook(() => useDiffSelection(FILES, true)); // Start with all checked

  act(() => {
    result.current[2](false); // Set all to false
  });
  expect(result.current[0]).toEqual({
    "foo.ts": false,
    "bar.js": false,
    "baz.md": false,
  });
});

test("updates state correctly if files prop changes", () => {
  const initialFiles = ["a.txt", "b.txt"];
  const { result, rerender } = renderHook(
    ({ files, defaultChecked }) => useDiffSelection(files, defaultChecked),
    { initialProps: { files: initialFiles, defaultChecked: true } }
  );

  expect(result.current[0]).toEqual({ "a.txt": true, "b.txt": true });

  const newFiles = ["b.txt", "c.txt"];
  rerender({ files: newFiles, defaultChecked: false });

  expect(result.current[0]).toEqual({ "b.txt": false, "c.txt": false });
});