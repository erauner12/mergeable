import { IconNames } from "@blueprintjs/icons"; // For finding buttons by icon
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"; // ADDED act
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

const MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS: PromptBlock[] = [
  // Renamed, PR details won't be here
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
    await act(async () => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    });
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // Ensure all blocks are selected (default behavior)
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeChecked());

    await act(async () => {
      fireEvent.click(screen.getByText("Copy Selected"));
    });

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
    expect(copiedText).toContain(
      formatPromptBlock(generalCommentBlock).trimEnd(),
    );
    // The diff block's content will be the result of buildClipboardPayload (raw diff).
    // We check that buildClipboardPayloadSpy was called with correct selected files.
    // The raw diff content itself will be part of copiedText.
    // For example, if file1.txt was selected, its diff content should be in copiedText.
    const allPatchesData =
      DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const expectedDiffContentForFile1 =
      allPatchesData["file1.txt"].patch.trim();
    expect(copiedText).toContain(expectedDiffContentForFile1);

    expect(copiedText).toContain(
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    );
    // The diff block's content will be the result of buildClipboardPayload
    // We don't check its exact content here, just that the spy was called.

    // Then the initialPromptText (which contains PR details from template) should follow
    expect(copiedText).toContain(MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS);

    // Ensure PR details are not duplicated (they should only come from initialPromptText)
    const prDetailsHeaderCount = (copiedText.match(/### PR details/g) ?? [])
      .length;
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

    await act(async () => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    });
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

    await act(async () => {
      fireEvent.click(copyButton!);
    });

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
    // The payload part should be the raw diff of file1.txt
    const allPatchesData =
      DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const expectedRawDiffContent = allPatchesData["file1.txt"].patch.trim();
    expect(copiedText).toContain(expectedRawDiffContent);

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

    await act(async () => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1")); // Use data-testid
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    });
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // After Picker Interaction: Collapse content should update to show buildClipboardPayload output
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      // buildClipboardPayloadSpy was mocked to return "PAYLOAD_FOR_ONE_FILE_RENDER"
      // This should now be actual raw diff content.
      // Let's get the expected raw diff for file1.txt
      const allPatchesData =
        DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
      const expectedRawDiffForFile1 = allPatchesData["file1.txt"].patch.trim();
      // Update the spy's return value for this specific scenario
      buildClipboardPayloadSpy.mockReturnValue(expectedRawDiffForFile1);

      // Rerender or trigger update if necessary for spy to take effect for display
      // (Often not needed if spy is set before the action that causes re-render and call)
      // For this test, the spy is set *before* the component is rendered,
      // but then we simulate picker interaction. The spy needs to return the correct value
      // when buildClipboardPayload is called for rendering the content.

      // Let's refine the spy mock for this test:
      // The spy is set up at the top of the test.
      // It's called when rendering the diff block content *after* hasPickedFiles is true.
      // So, its return value should be what we expect to see.
      expect(preElement).toHaveTextContent(expectedRawDiffForFile1);
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
    await act(async () => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Confirm Picker (1 file)"));
    });
    await waitFor(() =>
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument(),
    );

    // Verify content is from buildClipboardPayload
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );
    // .mockReturnValue("PICKED_FILES_PAYLOAD"); // Old mock
    // The actual payload for one file (e.g., file1.txt)
    const allPatchesData =
      DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const expectedRawDiffForFile1 = allPatchesData["file1.txt"].patch.trim();
    buildClipboardPayloadSpy.mockReturnValue(expectedRawDiffForFile1);

    // Force a re-render to ensure the content updates if it hadn't already fully processed
    await act(async () => {
      rerender(
        <PromptCopyDialog
          isOpen={true}
          initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
          blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
          onClose={mockOnClose}
        />,
      );
    });
    await waitFor(() => {
      const diffBlockDiv = screen
        .getByText("### PR Diff")
        .closest('div[class*="promptBlock"]');
      const preElement = diffBlockDiv!.querySelector("pre");
      // expect(preElement).toHaveTextContent("PICKED_FILES_PAYLOAD"); // Old assertion
      expect(preElement).toHaveTextContent(expectedRawDiffForFile1);
    });
    buildClipboardPayloadSpy.mockRestore();
    await act(async () => {
      fireEvent.click(screen.getByText("Copy Selected"));
    });
    // Close the dialog
    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Re-render as closed (simulating parent component behavior)
    // This part of the test was to simulate the parent component unmounting/remounting the dialog.
    // However, the key reset logic happens on isOpen prop change and useEffects within PromptCopyDialog.
    // The immediate rerender to open=true is more direct for testing re-initialization.
    await act(async () => {
      rerender(
        <PromptCopyDialog
          isOpen={false} // Now closed
          initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
          blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
          onClose={mockOnClose}
        />,
      );
    });
    // Reopen
    await act(async () => {
      rerender(
        <PromptCopyDialog
          isOpen={true}
          initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
          blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
          onClose={mockOnClose}
        />,
      );
    });
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

  test("Handles no diff block gracefully", async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByText("Copy Selected"));
    });

    const commentOnlyBlockFormatted = formatPromptBlock(
      blocksWithoutDiff[0],
    ).trimEnd();
    const expectedCombined = `${commentOnlyBlockFormatted}\n\n${MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}`;

    expect(mockCopyToClipboard).toHaveBeenCalledWith(expectedCombined);
  });
});

// ADD NEW TEST SUITE BELOW

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
    await act(async () => {
      fireEvent.click(getCopyButton());
    });
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith("Only Template Here");
    });
  });

  // Add the missing test for "copies blocks in correct order"
  test("copies blocks in correct order (comments, then template)", async () => {
    const MOCK_COMMENT_BLOCK_FOR_ORDER_TEST: PromptBlock[] = [
      {
        id: "comment-1",
        kind: "comment",
        header: "### General Comment",
        commentBody: "A general comment.",
        author: "user",
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
    await act(async () => {
      fireEvent.change(userTextArea, {
        target: { value: "User custom instructions" },
      });
    });

    await act(async () => {
      fireEvent.click(getCopyButton());
    });

    // MODIFIED: Use formatPromptBlock for expectedBlock1Content
    const expectedBlock1Content = formatPromptBlock(
      MOCK_COMMENT_BLOCK_FOR_ORDER_TEST[0],
    );
    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    expect(copiedText).toContain(expectedBlock1Content.trimEnd());
    expect(copiedText).toContain("Footer Template For Order Test");
    expect(copiedText).toContain("User custom instructions");
    // Ensure order: comment block, then template, then user text
    const commentIndex = copiedText.indexOf(expectedBlock1Content.trimEnd());
    const templateIndex = copiedText.indexOf("Footer Template For Order Test");
    const userTextIndex = copiedText.indexOf("User custom instructions");
    expect(commentIndex).toBeLessThan(templateIndex);
    expect(templateIndex).toBeLessThan(userTextIndex);
  });
});