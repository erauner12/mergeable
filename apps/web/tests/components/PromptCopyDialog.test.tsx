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

const MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS: PromptBlock[] = [ // Renamed, PR details won't be here
  {
    id: "comment-1", // Changed ID to be more specific
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
    id: "comment-2", // Changed ID
    kind: "comment",
    header: "### Another Comment",
    commentBody: "Another comment.",
    author: "user",
    timestamp: new Date().toISOString(),
  },
];

// This will be the `promptText` from buildRepoPromptText, containing PR details via template
const MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS = `
## SETUP
cd /path/to/repo
git checkout main

### PR details
PR #123 DETAILS: Test PR Title
> _testauthor · 2024-Jan-01_

This is the PR body.

### files changed
- file1.txt
- file2.txt

### diff
(diff content here, possibly empty if not selected for template)

🔗 https://github.com/owner/repo/pull/123
`.trim();


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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS} // Pass initial prompt text
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS} // Use blocks without PR details
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="My Awesome PR"
      />,
    );

    fireEvent.click(screen.getByTestId("choose-files-diff-1"));
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

  test("'Copy Selected' uses buildClipboardPayload for selected diff block and combines with initialPromptText", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
      />,
    );

    // Open picker and select 1 file
    fireEvent.click(screen.getByTestId("choose-files-diff-1"));
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
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-1", // Use updated ID
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-2", // Use updated ID
    )!;
    
    // The selected blocks' content (comments + processed diff) should appear first
    expect(copiedText).toContain(formatPromptBlock(generalCommentBlock).trimEnd());
    expect(copiedText).toContain(formatPromptBlock(anotherCommentBlock).trimEnd());
    // The diff block's content will be the result of buildClipboardPayload
    // We don't check its exact content here, just that the spy was called.

    // Then the initialPromptText (which contains PR details from template) should follow
    expect(copiedText).toContain(MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS);
    
    // Ensure PR details are not duplicated (they should only come from initialPromptText)
    const prDetailsHeaderCount = (copiedText.match(/### PR details/g) ?? []).length;
    expect(prDetailsHeaderCount).toBe(1);


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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("choose-files-diff-1"));
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={mockOnClose}
      />,
    );
    // Reopen
    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
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
        id: "comment-only-1", // Specific ID
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
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS} // Still provide initial prompt
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

    const commentOnlyBlockFormatted = formatPromptBlock(blocksWithoutDiff[0]).trimEnd();
    const expectedCombined = `${commentOnlyBlockFormatted}\n\n${MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}`;
    
    expect(mockCopyToClipboard).toHaveBeenCalledWith(expectedCombined);
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
    const MOCK_COMMENT_BLOCK_FOR_ORDER_TEST: PromptBlock[] = [ // Renamed
      {
        id: "text1",
        kind: "comment",
        header: "### Block 1 Header For Order Test", // More specific header
        commentBody: "Content of block 1.",
        author: "test",
        timestamp: new Date().toISOString(),
      },
    ];
    render(
      <PromptCopyDialog
        {...baseProps}
        blocks={MOCK_COMMENT_BLOCK_FOR_ORDER_TEST} // Use new mock
        initialPromptText="Footer Template For Order Test" // More specific
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
    const expectedBlock1Content = formatPromptBlock(MOCK_COMMENT_BLOCK_FOR_ORDER_TEST[0]);
    const expectedUserText = "User custom instructions";
    const expectedInitialPromptText = "Footer Template For Order Test";

    await waitFor(() => {
      const copiedText = mockCopyToClipboard.mock.calls[0]?.[0] as string;
      expectOrder(
        copiedText,
        // Use header for order check if full block with metadata is too complex for simple order
        MOCK_COMMENT_BLOCK_FOR_ORDER_TEST[0].header, // Check with specific header
        expectedInitialPromptText,
        expectedUserText,
      );
      // Optionally, also check if the full formatted block is present
      expect(copiedText).toContain(expectedBlock1Content); // Check with specific content
      // Ensure PR details are not duplicated (they should only come from initialPromptText)
      // This test case's initialPromptText doesn't have "### PR details", so this check is not applicable here.
      // Other tests cover the PR details from initialPromptText.
    });
  });

});
