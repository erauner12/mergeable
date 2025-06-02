import { IconNames } from "@blueprintjs/icons"; // For finding buttons by icon
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { PromptCopyDialog } from "../../src/components/PromptCopyDialog";
import * as DiffUtils from "../../src/lib/github/diffUtils"; // To mock buildClipboardPayload
import type { PromptBlock } from "../../src/lib/repoprompt";

// Mock FileDiffPicker to control its behavior
vi.mock("../../src/components/FileDiffPicker", () => ({
  FileDiffPicker: vi.fn(({ isOpen, onConfirm, onCancel, files, title }) => {
    if (!isOpen) return null;
    return (
      <div>
        <span>FileDiffPickerMock</span>
        <p>Title: {title}</p>
        <button
          onClick={() =>
            onConfirm(
              new Set(files.slice(0, 1).map((f: { path: string }) => f.path)),
            )
          }
        >
          Confirm Picker (1 file)
        </button>
        <button
          onClick={() =>
            onConfirm(new Set(files.map((f: { path: string }) => f.path)))
          }
        >
          Confirm Picker (all files)
        </button>
        <button onClick={onCancel}>Cancel Picker</button>
      </div>
    );
  }),
}));

const mockCopyToClipboard = vi.fn();

const SIMPLE_DIFF_PATCH = `diff --git a/file1.txt b/file1.txt
index 0000000..1111111 100644
--- a/file1.txt
+++ b/file1.txt
@@ -0,0 +1 @@
+content1
diff --git a/file2.txt b/file2.txt
index 0000000..2222222 100644
--- a/file2.txt
+++ b/file2.txt
@@ -0,0 +1 @@
+content2
`;

const MOCK_BLOCKS_WITH_DIFF: PromptBlock[] = [
  {
    id: "1",
    kind: "comment",
    header: "### General Comment",
    commentBody: "A general comment.",
    author: "user",
    timestamp: new Date().toISOString(),
  },
  {
    id: "diff-1",
    kind: "diff",
    header: "### PR Diff",
    patch: SIMPLE_DIFF_PATCH,
  },
  {
    id: "3",
    kind: "comment",
    header: "### Another Comment",
    commentBody: "Another comment.",
    author: "user",
    timestamp: new Date().toISOString(),
  },
];

describe("PromptCopyDialog with FileDiffPicker integration", () => {
  let originalClipboard: typeof navigator.clipboard;
  let originalExecCommand: (
    commandId: string,
    showUI?: boolean,
    value?: string,
  ) => boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    originalClipboard = navigator.clipboard;
    // @ts-expect-error - mocking clipboard
    navigator.clipboard = {
      writeText: vi.fn(async (text) => {
        mockCopyToClipboard(text);
        return Promise.resolve();
      }),
    };
    originalExecCommand = document.execCommand;
    document.execCommand = vi.fn((command) => {
      if (command === "copy") {
        const tempTextArea = document.body.querySelector(
          "textarea[style*='fixed']",
        ) as HTMLTextAreaElement; // More specific selector
        if (tempTextArea) mockCopyToClipboard(tempTextArea.value);
        return true;
      }
      return false;
    });
  });

  afterEach(() => {
    // @ts-expect-error - restoring clipboard
    navigator.clipboard = originalClipboard;
    document.execCommand = originalExecCommand;
  });

  test("renders 'Choose files...' button and selection label for diff blocks", () => {
    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={() => {}}
        prTitle="Test PR"
      />,
    );

    expect(screen.getByText("### PR Diff")).toBeInTheDocument();
    expect(screen.getByText("Choose files…")).toBeInTheDocument();
    expect(screen.getByText("(All 2 files)")).toBeInTheDocument(); // file1.txt, file2.txt
  });

  test("FileDiffPicker opens with correct title and onConfirm updates selection label", async () => {
    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={() => {}}
        prTitle="My Awesome PR"
      />,
    );

    fireEvent.click(screen.getByText("Choose files…"));
    expect(screen.getByText("FileDiffPickerMock")).toBeInTheDocument();
    expect(
      screen.getByText("Title: Choose files for: My Awesome PR"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));

    await waitFor(() => {
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
    });
  });

  test("'Copy Selected' uses buildClipboardPayload for selected diff block", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={() => {}}
      />,
    );

    // Open picker and select 1 file
    fireEvent.click(screen.getByText("Choose files…"));
    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // Ensure all blocks are selected (default behavior)
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeChecked());

    fireEvent.click(screen.getByText("Copy Selected"));

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledTimes(1);
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]),
        allFiles: ["file1.txt", "file2.txt"],
      }),
    );

    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    expect(copiedText).toContain("### General Comment"); // Formatted block
    expect(copiedText).toContain("### Another Comment"); // Formatted block
    // The diff block's content will be the result of buildClipboardPayload
    // We don't check its exact content here, just that the spy was called.

    buildClipboardPayloadSpy.mockRestore();
  });

  test("Per-block copy for diff block uses selected files from picker", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Choose files…"));
    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    const diffBlockElement = screen
      .getByText("### PR Diff")
      .closest('div[class*="promptBlock"]');
    expect(diffBlockElement).toBeInTheDocument();

    // Find the copy button within this block. It has a tooltip like "Copy section: ### PR Diff..."
    // Blueprint buttons with only icons might not have a direct 'name' via aria-label from the icon itself.
    // The tooltip provides the accessible name.
    // We need to find the button that, when hovered, would show this tooltip.
    // A more robust way is to find all buttons in the actions div and pick the one with the clipboard icon.
    const actionsDiv = diffBlockElement!.querySelector(
      'div[class*="blockActions"]',
    );
    expect(actionsDiv).toBeInTheDocument();
    const copyButton = actionsDiv!
      .querySelector(`button [data-icon="${IconNames.CLIPBOARD}"]`)
      ?.closest("button");
    expect(copyButton).toBeInTheDocument();

    fireEvent.click(copyButton!);

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledTimes(1);
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]),
      }),
    );
    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    expect(copiedText).toContain("### PR Diff\n"); // Header should be prepended, followed by payload

    buildClipboardPayloadSpy.mockRestore();
  });

  test("Content of diff block in Collapse updates based on picker selection", async () => {
    const buildClipboardPayloadSpy = vi
      .spyOn(DiffUtils, "buildClipboardPayload")
      .mockReturnValueOnce("PAYLOAD_FOR_ALL_FILES_RENDER") // First render (all files)
      .mockReturnValueOnce("PAYLOAD_FOR_ONE_FILE_RENDER"); // Second render (after picker)

    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={() => {}}
      />,
    );

    const diffBlockDiv = screen
      .getByText("### PR Diff")
      .closest('div[class*="promptBlock"]');
    expect(diffBlockDiv).toBeInTheDocument();

    // Check initial content (assuming it's expanded and selected)
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(preElement).toHaveTextContent("PAYLOAD_FOR_ALL_FILES_RENDER");
    });

    fireEvent.click(screen.getByText("Choose files…"));
    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // Collapse content should update
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(preElement).toHaveTextContent("PAYLOAD_FOR_ONE_FILE_RENDER");
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledTimes(2); // Once for initial, once after picker
    buildClipboardPayloadSpy.mockRestore();
  });

  test("Dialog closes and resets diff state", () => {
    const mockOnClose = vi.fn();
    const { rerender } = render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    expect(screen.getByText("Choose files…")).toBeInTheDocument();

    // Close the dialog
    fireEvent.click(screen.getByText("Close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Re-render as closed (simulating parent component behavior)
    // The internal state reset happens when isOpen becomes false.
    // We need to ensure the useEffect for isOpen, blocks, initialSelectedBlockIds
    // correctly resets diffPatchData, selectedFilePaths, isFileDiffPickerOpen.
    // This is hard to directly test from outside without inspecting internal state.
    // A functional test would be to reopen it and see if it's reset.

    rerender(
      <PromptCopyDialog
        isOpen={false} // Now closed
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    rerender(
      <PromptCopyDialog
        isOpen={true} // Reopen
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF} // Same blocks
        onClose={mockOnClose}
      />,
    );
    // Should re-initialize to all files selected
    expect(screen.getByText("(All 2 files)")).toBeInTheDocument();
  });

  test("Handles no diff block gracefully", () => {
    const blocksWithoutDiff: PromptBlock[] = [
      {
        id: "1",
        kind: "comment",
        header: "### Comment Only",
        commentBody: "No diff here.",
        author: "user",
        timestamp: new Date().toISOString(),
      },
    ];
    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={blocksWithoutDiff}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Choose files…")).not.toBeInTheDocument();
    expect(screen.queryByText("(All 0 files)")).not.toBeInTheDocument(); // Or similar label
    // FileDiffPicker should not be rendered or attempted to be used
    expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();

    // Copy selected should still work
    fireEvent.click(screen.getByText("Copy Selected"));
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("### Comment Only"),
    );
  });
});