import { render, screen, fireEvent } from "@testing-library/react";
import { FileDiffPicker } from "../../../src/components/FileDiffPicker";
import { vi, test, expect, beforeEach } from "vitest";
import type { PatchFileMetadata } from "../../../src/lib/github/diffUtils";

const MOCK_FILES_UNSORTED: PatchFileMetadata[] = [
  { path: "zebra.js", patch: "diff z", lineCount: 10, byteCount: 100, isBinary: false },
  { path: "apple.ts", patch: "diff a", lineCount: 5, byteCount: 50, isBinary: false },
  { path: "banana.md", patch: "diff b", lineCount: 500, byteCount: 1000, isBinary: false }, // Large line count
  { path: "image.png", patch: "diff img", lineCount: 0, byteCount: 120_000, isBinary: true }, // Binary and large byte count
];

const MOCK_FILES_SORTED_PATHS = ["apple.ts", "banana.md", "image.png", "zebra.js"];


test("renders sorted checkboxes with correct labels and hints", () => {
  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );

  const checkboxes = screen.getAllByRole("checkbox");
  expect(checkboxes.length).toBe(MOCK_FILES_UNSORTED.length);

  // Check if files are sorted by path and hints are present
  expect(checkboxes[0].closest('label')!.textContent).toContain("apple.ts"); // No hint for small file
  expect(checkboxes[1].closest('label')!.textContent).toContain("banana.md (500 lines)");
  expect(checkboxes[2].closest('label')!.textContent).toContain("image.png (binary)");
  expect(checkboxes[3].closest('label')!.textContent).toContain("zebra.js"); // No hint

  // All should be checked by default
  checkboxes.forEach(cb => expect(cb).toBeChecked());
});

test("confirm button calls onConfirm with selected files", () => {
  const mockOnConfirm = vi.fn();
  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED}
      onConfirm={mockOnConfirm}
      onCancel={() => {}}
      defaultChecked={true} // Explicitly set for clarity
    />
  );

  // Uncheck 'apple.ts' (first in sorted list)
  const appleCheckbox = screen.getByLabelText(/^apple\.ts/);
  fireEvent.click(appleCheckbox);

  // Uncheck 'image.png' (third in sorted list)
  const imageCheckbox = screen.getByLabelText(/^image\.png/);
  fireEvent.click(imageCheckbox);
  
  const confirmButton = screen.getByText(/^Copy 2 files$/); // zebra.js, banana.md remain
  fireEvent.click(confirmButton);

  const expectedSelected = new Set(["zebra.js", "banana.md"]);
  expect(mockOnConfirm).toHaveBeenCalledWith(expectedSelected);
});

test("cancel button calls onCancel", () => {
  const mockOnCancel = vi.fn();
  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED}
      onConfirm={() => {}}
      onCancel={mockOnCancel}
    />
  );

  fireEvent.click(screen.getByText("Cancel"));
  expect(mockOnCancel).toHaveBeenCalledTimes(1);
});

test("select all / select none buttons work", () => {
  const mockOnConfirm = vi.fn();
   render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED}
      onConfirm={mockOnConfirm}
      onCancel={() => {}}
      defaultChecked={false} // Start with none checked
    />
  );

  let checkboxes = screen.getAllByRole("checkbox");
  checkboxes.forEach(cb => expect(cb).not.toBeChecked());
  expect(screen.getByText(/^Copy 0 files$/)).toBeDisabled();


  fireEvent.click(screen.getByText("Select all"));
  checkboxes.forEach(cb => expect(cb).toBeChecked());
  expect(screen.getByText(/^Copy 4 files$/)).not.toBeDisabled();
  
  fireEvent.click(screen.getByText("Select none"));
  checkboxes.forEach(cb => expect(cb).not.toBeChecked());
  expect(screen.getByText(/^Copy 0 files$/)).toBeDisabled();

  // Check one manually
  fireEvent.click(checkboxes[0]); // apple.ts
  expect(screen.getByText(/^Copy 1 file$/)).not.toBeDisabled();
  fireEvent.click(screen.getByText(/^Copy 1 file$/));
  
  expect(mockOnConfirm).toHaveBeenCalledWith(new Set([MOCK_FILES_SORTED_PATHS[0]]));
});

test("FileDiffPicker is not rendered when isOpen is false", () => {
  const { container } = render(
    <FileDiffPicker
      isOpen={false}
      files={MOCK_FILES_UNSORTED}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
  expect(container.firstChild).toBeNull();
});

test("displays correct pluralization for 'Copy N file(s)' button", () => {
  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED.slice(0, 1)} // Only one file
      defaultChecked={true}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText("Copy 1 file")).toBeInTheDocument();

  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED.slice(0,2)} // Two files
      defaultChecked={true}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText("Copy 2 files")).toBeInTheDocument();
  
  render(
    <FileDiffPicker
      isOpen={true}
      files={MOCK_FILES_UNSORTED.slice(0,1)} // One file, but uncheck it
      defaultChecked={false}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByText("Copy 0 files")).toBeInTheDocument();
});