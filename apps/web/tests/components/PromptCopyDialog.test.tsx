import { IconNames } from "@blueprintjs/icons"; // For finding buttons by icon
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PromptCopyDialog } from "../../src/components/PromptCopyDialog";
import * as DiffUtils from "../../src/lib/github/diffUtils"; // To mock buildClipboardPayload
import type { PromptBlock } from "../../src/lib/repoprompt";
import { formatPromptBlock } from "../../src/lib/repoprompt"; // ADDED IMPORT
import { normaliseWS } from "../testingUtils"; // ADDED IMPORT

// ADD HELPER FUNCTION HERE
function getCopyButton() {
  return screen.getByRole("button", { name: /Copy Selected|Copied!/i });
}

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
    // expect(screen.getByText("Choose files…")).toBeInTheDocument(); // Original
    expect(screen.getByTestId("choose-files-diff-1")).toBeInTheDocument(); // MODIFIED
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

    fireEvent.click(screen.getByTestId("choose-files-diff-1")); // MODIFIED
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
    fireEvent.click(screen.getByTestId("choose-files-diff-1")); // MODIFIED
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
    // MODIFIED: Use formatPromptBlock for comment block expectations
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF.find(
      (b) => b.id === "1",
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF.find(
      (b) => b.id === "3",
    )!;
    expect(copiedText).toContain(formatPromptBlock(generalCommentBlock).trimEnd());
    expect(copiedText).toContain(formatPromptBlock(anotherCommentBlock).trimEnd());
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

    fireEvent.click(screen.getByTestId("choose-files-diff-1")); // MODIFIED
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
      // .mockReturnValueOnce("PAYLOAD_FOR_ALL_FILES_RENDER") // No longer called for initial display
      .mockReturnValue("PAYLOAD_FOR_ONE_FILE_RENDER"); // Called after picker interaction

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

    // Initial Render: Should display raw patch content
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(normaliseWS(preElement!.textContent!)).toBe(
        normaliseWS(SIMPLE_DIFF_PATCH),
      ); // Check against raw patch
    });

    fireEvent.click(screen.getByTestId("choose-files-diff-1")); // Use data-testid
    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // After Picker Interaction: Collapse content should update to show buildClipboardPayload output
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(preElement).toHaveTextContent("PAYLOAD_FOR_ONE_FILE_RENDER");
    });

    // buildClipboardPayloadSpy is now called once for the display after picker interaction.
    // It might also be called by copy actions, so check count carefully or make spy more specific if needed.
    // For this specific display update, it's called once.
    // It may run more than once because React can re-render; we only
    // care that it *was* run for the updated diff content.
    expect(buildClipboardPayloadSpy).toHaveBeenCalled();
    buildClipboardPayloadSpy.mockRestore();
  });

  test("Dialog closes and resets diff state, including hasPickedFiles", async () => {
    const mockOnClose = vi.fn();
    const { rerender } = render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    // Interact with picker to set hasPickedFiles to true
    fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    await waitFor(() =>
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument(),
    );

    // Verify content is from buildClipboardPayload
    const buildClipboardPayloadSpy = vi
      .spyOn(DiffUtils, "buildClipboardPayload")
      .mockReturnValue("PICKED_FILES_PAYLOAD");
    // Force a re-render to ensure the content updates if it hadn't already fully processed
    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    await waitFor(() => {
      const diffBlockDiv = screen
        .getByText("### PR Diff")
        .closest('div[class*="promptBlock"]');
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(preElement).toHaveTextContent("PICKED_FILES_PAYLOAD");
    });
    buildClipboardPayloadSpy.mockRestore();

    // Close the dialog
    fireEvent.click(screen.getByText("Close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Re-render as closed (simulating parent component behavior)
    rerender(
      <PromptCopyDialog
        isOpen={false} // Now closed
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    // Reopen
    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText=""
        blocks={MOCK_BLOCKS_WITH_DIFF}
        onClose={mockOnClose}
      />,
    );
    // Should re-initialize to all files selected for the label
    expect(screen.getByText("(All 2 files)")).toBeInTheDocument();
    // And content should be raw patch again (hasPickedFiles is false)
    const diffBlockDivReopened = screen
      .getByText("### PR Diff")
      .closest('div[class*="promptBlock"]');
    await waitFor(() => {
      const preElement = diffBlockDivReopened!.querySelector("pre");
      expect(normaliseWS(preElement!.textContent!)).toBe(
        normaliseWS(SIMPLE_DIFF_PATCH),
      );
    });
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
    // MODIFIED: Use formatPromptBlock for expectation
    const commentOnlyBlock = blocksWithoutDiff[0];
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      formatPromptBlock(commentOnlyBlock).trimEnd(),
    );
  });
});

// ADD NEW TEST SUITE BELOW

// Helper function to check the order of substrings
function expectOrder(haystack: string, ...needles: string[]) {
  let pos = -1;
  for (const n of needles) {
    if (!n) continue; // Skip empty needles if they represent an absent part
    const next = haystack.indexOf(n);
    expect(next, `"${n}" should appear in the correct order`).toBeGreaterThan(
      pos,
    );
    pos = next;
  }
}

describe("PromptCopyDialog with initialPromptText", () => {
  let originalClipboard: typeof navigator.clipboard;
  let originalExecCommand: (
    commandId: string,
    showUI?: boolean,
    value?: string,
  ) => boolean;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks, including mockCopyToClipboard
    originalClipboard = navigator.clipboard;
    // @ts-expect-error - mocking clipboard
    navigator.clipboard = {
      writeText: vi.fn(async (text) => {
        mockCopyToClipboard(text); // mockCopyToClipboard is defined in the outer scope
        return Promise.resolve();
      }),
    };
    originalExecCommand = document.execCommand;
    document.execCommand = vi.fn((command) => {
      if (command === "copy") {
        const tempTextArea = document.body.querySelector(
          "textarea[style*='fixed']",
        ) as HTMLTextAreaElement;
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

  const baseProps = {
    isOpen: true,
    blocks: [],
    onClose: vi.fn(),
  };

  test("'Copy Selected' button is enabled when only initialPromptText is present", () => {
    render(
      <PromptCopyDialog {...baseProps} initialPromptText="Test Template" />,
    );
    const copySelectedButton = getCopyButton();
    expect(copySelectedButton).not.toBeDisabled();
  });

  test("'Copy Selected' button is disabled when initialPromptText, blocks, and userText are all empty/absent", () => {
    render(
      <PromptCopyDialog
        {...baseProps}
        initialPromptText="" // Empty
      />,
    );
    const copySelectedButton = getCopyButton();
    expect(copySelectedButton).toBeDisabled();
  });

  test("copies only initialPromptText when it's the sole content", async () => {
    render(
      <PromptCopyDialog
        {...baseProps}
        initialPromptText="Only Template Here"
      />,
    );
    fireEvent.click(getCopyButton());
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith("Only Template Here");
    });
  });

  test("combines selected blocks, user text, and initialPromptText in correct order", async () => {
    const MOCK_BLOCK_TEXT_ONLY: PromptBlock[] = [
      {
        id: "text1",
        kind: "comment",
        header: "### Block 1",
        commentBody: "Content of block 1.",
        author: "test",
        timestamp: new Date().toISOString(),
      },
    ];
    render(
      <PromptCopyDialog
        {...baseProps}
        blocks={MOCK_BLOCK_TEXT_ONLY}
        initialPromptText="Footer Template"
      />,
    );

    // All blocks are selected by default
    const userTextArea = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    fireEvent.change(userTextArea, {
      target: { value: "User custom instructions" },
    });

    fireEvent.click(getCopyButton());

    // MODIFIED: Use formatPromptBlock for expectedBlock1Content
    const expectedBlock1Content = formatPromptBlock(MOCK_BLOCK_TEXT_ONLY[0]);
    const expectedUserText = "User custom instructions";
    const expectedInitialPromptText = "Footer Template";

    await waitFor(() => {
      const copiedText = mockCopyToClipboard.mock.calls[0]?.[0] as string;
      expectOrder(
        copiedText,
        // Use header for order check if full block with metadata is too complex for simple order
        MOCK_BLOCK_TEXT_ONLY[0].header,
        expectedInitialPromptText,
        expectedUserText,
      );
      // Optionally, also check if the full formatted block is present
      expect(copiedText).toContain(expectedBlock1Content);
    });
  });

  test("handles empty strings correctly in combination when creating final prompt", async () => {
    const blockB1: PromptBlock = {
      id: "b1",
      kind: "comment",
      header: "### B1",
      commentBody: "Block1",
      author: "a",
      timestamp: "2024-01-01T00:00:00Z",
    };
    // MODIFIED: Use formatPromptBlock for blockB1Formatted
    const blockB1Formatted = formatPromptBlock(blockB1);

    // Case 1: Only blocks and template (user text is empty)
    mockCopyToClipboard.mockClear();
    const { rerender } = render(
      <PromptCopyDialog
        {...baseProps}
        blocks={[blockB1]}
        initialPromptText="TemplateOnly"
      />,
    );
    fireEvent.click(getCopyButton());
    await waitFor(() => {
      const copiedText = mockCopyToClipboard.mock.calls[0]?.[0] as string;
      expectOrder(copiedText, blockB1.header, "TemplateOnly");
      expect(copiedText).toContain(blockB1Formatted); // Ensure full block is there
    });

    // Case 2: Only user text and template (blocks are empty)
    mockCopyToClipboard.mockClear();
    rerender(
      <PromptCopyDialog
        {...baseProps}
        blocks={[]}
        initialPromptText="TemplateAgain"
      />,
    );
    const userTextArea = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    fireEvent.change(userTextArea, { target: { value: "User Instructions" } });
    fireEvent.click(getCopyButton());
    await waitFor(() => {
      const copiedText = mockCopyToClipboard.mock.calls[0]?.[0] as string;
      expectOrder(copiedText, "TemplateAgain", "User Instructions");
    });

    // Case 3: Only blocks and user text (initialPromptText is empty)
    mockCopyToClipboard.mockClear();
    rerender(
      <PromptCopyDialog
        {...baseProps}
        blocks={[blockB1]}
        initialPromptText="" // Empty template
      />,
    );
    const userTextArea2 = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    // Ensure user text area is cleared from previous state if not remounted fully
    fireEvent.change(userTextArea2, { target: { value: "" } });
    fireEvent.change(userTextArea2, { target: { value: "User Text Only" } });

    fireEvent.click(getCopyButton());
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        // block text is trimEnd()-ed inside getFinalPrompt
        `${blockB1Formatted.trimEnd()}\n\nUser Text Only`,
      );
    });

    // Case 4: Only blocks (user text and template are empty)
    mockCopyToClipboard.mockClear();
    rerender(
      <PromptCopyDialog
        {...baseProps}
        blocks={[blockB1]}
        initialPromptText=""
      />,
    );
    const userTextArea3 = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    fireEvent.change(userTextArea3, { target: { value: "" } }); // Ensure user text is empty
    
    fireEvent.click(getCopyButton());
    await waitFor(() => {
      // MODIFIED: Use new blockB1Formatted
      expect(mockCopyToClipboard).toHaveBeenCalledWith(blockB1Formatted);
    });

    // Case 5: Only user text (blocks and template are empty)
    mockCopyToClipboard.mockClear();
    rerender(
      <PromptCopyDialog {...baseProps} blocks={[]} initialPromptText="" />,
    );
    const userTextArea4 = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    fireEvent.change(userTextArea4, { target: { value: "Just User Text" } });

    fireEvent.click(getCopyButton());
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith("Just User Text");
    });
  });
});
