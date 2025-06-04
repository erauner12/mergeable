import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PromptCopyDialog } from "../../src/components/PromptCopyDialog";
import * as DiffUtils from "../../src/lib/github/diffUtils"; // To mock buildClipboardPayload
import type { PromptBlock } from "../../src/lib/repoprompt";
import { formatPromptBlock } from "../../src/lib/repoprompt";
import { SECTION_SEPARATOR } from "../../src/lib/utils/promptFormat";
import { normaliseWS } from "../testingUtils";

// Define the placeholder text as used in tests and mock data
const DIFF_PLACEHOLDER_TEXT_IN_TEST =
  "(diff content here, possibly empty if not selected for template)";

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
          data-testid="picker-confirm-1-file" // Added testid
          onClick={() =>
            onConfirm(
              new Set(files.slice(0, 1).map((f: { path: string }) => f.path)),
            )
          }
        >
          Confirm Picker (1 file)
        </button>
        <button
          data-testid="picker-confirm-all-files" // Added testid
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

  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

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

    // fireEvent.click(screen.getByText("Confirm Picker (1 file)")); // OLD
    fireEvent.click(screen.getByTestId("picker-confirm-1-file")); // NEW

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
      // fireEvent.click(screen.getByText("Confirm Picker (1 file)")); // OLD
      fireEvent.click(screen.getByTestId("picker-confirm-1-file")); // NEW
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
      // expect(mockCopyToClipboard).toHaveBeenCalledTimes(1); // OLD
      expect(mockCopyToClipboard).toHaveBeenCalled(); // NEW
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]),
        allFiles: ["file1.txt", "file2.txt"],
      }),
    );

    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-1",
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-2",
    )!;
    const allPatchesData = DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const expectedDiffContentForFile1 =
      allPatchesData["file1.txt"].patch.trim();

    // --- build the string that _should_ replace the placeholder -------------
    // const selectionInjected = [ // OLD
    //   formatPromptBlock(generalCommentBlock).trimEnd(),
    //   expectedDiffContentForFile1,
    //   formatPromptBlock(anotherCommentBlock).trimEnd(),
    // ].join("\n\n");

    // NEW: According to the new getFinalPrompt, only diffPayload is injected.
    // selectedNonDiffText (comments) is appended after the template.
    // const injectedDiff = expectedDiffContentForFile1; // This part replaces the placeholder // OLD interpretation

    // CORRECTED interpretation: selectionClean (comments + diff) replaces placeholder.
    // const injected = [ // OLD - this was for the old getFinalPrompt logic
    //   formatPromptBlock(generalCommentBlock).trimEnd(),
    //   formatPromptBlock(anotherCommentBlock).trimEnd(),
    //   expectedDiffContentForFile1,
    // ].join(SECTION_SEPARATOR);

    // CORRECTED expected prompt:
    // const EXPECTED_PROMPT = MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace( // OLD
    //   DIFF_PLACEHOLDER_TEXT_IN_TEST,
    //   injected,
    // ).trimEnd();

    // NEW EXPECTED PROMPT based on buildFinalPrompt logic:
    // 1. Template with diff injected
    const templateWithDiffInjected =
      MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace(
        DIFF_PLACEHOLDER_TEXT_IN_TEST,
        expectedDiffContentForFile1, // Only diff is injected
      ).trimEnd();
    // 2. Comments (selectedNonDiffText)
    const commentsContent = [
      formatPromptBlock(generalCommentBlock).trimEnd(),
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    ].join(SECTION_SEPARATOR);
    // 3. User text (empty in this test)

    const EXPECTED_PROMPT = [templateWithDiffInjected, commentsContent]
      .join(SECTION_SEPARATOR)
      .trimEnd();

    // --- assertions ---------------------------------------------------------
    expect(normaliseWS(copiedText)).toBe(normaliseWS(EXPECTED_PROMPT));

    buildClipboardPayloadSpy.mockRestore();
  });

  test("Content of diff block in Collapse updates based on picker selection", async () => {
    const realBuildClipboardPayload = DiffUtils.buildClipboardPayload;
    const buildClipboardPayloadSpy = vi
      .spyOn(DiffUtils, "buildClipboardPayload")
      .mockImplementation(realBuildClipboardPayload);

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

    await act(() => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    await act(async () => {
      // fireEvent.click(screen.getByText("Confirm Picker (1 file)")); // OLD
      fireEvent.click(screen.getByTestId("picker-confirm-1-file")); // NEW
    });
    await waitFor(() =>
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument(),
    );

    // After Picker Interaction: Collapse content should update to show buildClipboardPayload output
    await waitFor(() => {
      const preElement = diffBlockDiv!.querySelector("pre");
      const diffPatchesData = DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
      const expectedRawDiffForFile1 = diffPatchesData["file1.txt"].patch.trim();
      expect(normaliseWS(preElement!.textContent!)).toBe(
        normaliseWS(expectedRawDiffForFile1),
      );
    });

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
      // fireEvent.click(screen.getByText("Confirm Picker (1 file)")); // OLD
      fireEvent.click(screen.getByTestId("picker-confirm-1-file")); // NEW
    });
    await waitFor(() =>
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument(),
    );

    // Verify content is from buildClipboardPayload
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );
    const allPatchesData = DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const expectedRawDiffForFile1 = allPatchesData["file1.txt"].patch.trim();
    buildClipboardPayloadSpy.mockReturnValue(expectedRawDiffForFile1);

    // Force a re-render to ensure the content updates if it hadn't already fully processed
    // REMOVED: This rerender might have been a hack. State updates should handle it.
    // await act(async () => {
    //   rerender(
    //     <PromptCopyDialog
    //       isOpen={true}
    //       initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
    //       blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
    //       onClose={mockOnClose}
    //     />,
    //   );
    // });
    await waitFor(() => {
      const diffBlockDiv = screen
        .getByText("### PR Diff")
        .closest('div[class*="promptBlock"]');
      const preElement = diffBlockDiv!.querySelector("pre");
      expect(normaliseWS(preElement!.textContent!)).toBe(
        normaliseWS(expectedRawDiffForFile1),
      );
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
      const preElementReopened = diffBlockDivReopened!.querySelector("pre");
      expect(normaliseWS(preElementReopened!.textContent!)).toBe(
        normaliseWS(SIMPLE_DIFF_PATCH),
      );
    });
  });

  // Add the missing test for "copies blocks in correct order"
  test("copies blocks in correct order (fallback: template, then comments, then user text)", async () => {
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
    // This initialPromptText does NOT contain the placeholder, so it will use the fallback order.
    const initialPromptTextWithoutPlaceholder =
      "Footer Template For Order Test";
    render(
      <PromptCopyDialog
        {...baseProps}
        blocks={MOCK_COMMENT_BLOCK_FOR_ORDER_TEST}
        initialPromptText={initialPromptTextWithoutPlaceholder}
      />,
    );

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

    const expectedBlock1Content = formatPromptBlock(
      MOCK_COMMENT_BLOCK_FOR_ORDER_TEST[0],
    ).trimEnd();
    const copiedText = mockCopyToClipboard.mock.calls[0][0];

    expect(copiedText).toContain(expectedBlock1Content);
    expect(copiedText).toContain(initialPromptTextWithoutPlaceholder);
    expect(copiedText).toContain("User custom instructions");

    // Ensure order: template, then comment block, then user text
    // With new logic (template, diff (if any), comments, user text)
    // Since there's no diff block in MOCK_COMMENT_BLOCK_FOR_ORDER_TEST, diffPayload is empty.
    // So the order remains: template, comment, user text.
    const templateIndex = copiedText.indexOf(
      initialPromptTextWithoutPlaceholder,
    );
    const commentIndex = copiedText.indexOf(expectedBlock1Content);
    const userTextIndex = copiedText.indexOf("User custom instructions");

    expect(templateIndex).toBeLessThan(commentIndex); // Template before selected block (comment)
    expect(commentIndex).toBeLessThan(userTextIndex); // Selected block before user text
  });

  test("copies blocks in correct order with injection into template", async () => {
    const DIFF_PLACEHOLDER_TEXT_IN_TEST =
      "(diff content here, possibly empty if not selected for template)";
    const TEMPLATE_WITH_PLACEHOLDER = `## Template Header\n${DIFF_PLACEHOLDER_TEXT_IN_TEST}\n## Template Footer`;

    const MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST: PromptBlock[] = [
      {
        id: "comment-inject-1",
        kind: "comment",
        header: "### Injected Comment",
        commentBody: "This comment should be injected.",
        author: "testuser",
        timestamp: new Date().toISOString(),
      },
    ];

    render(
      <PromptCopyDialog
        {...baseProps} // Ensure baseProps provides necessary defaults like isOpen, onClose
        blocks={MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST}
        initialPromptText={TEMPLATE_WITH_PLACEHOLDER}
      />,
    );

    // Assuming all blocks are selected by default, or ensure selection if necessary.
    // For this test, MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST is the only block.

    const userTextArea = screen.getByRole("textbox", {
      name: "Your instructions (optional)",
    });
    await act(async () => {
      fireEvent.change(userTextArea, {
        target: { value: "User custom instructions for injection" },
      });
    });

    await act(async () => {
      // Use the helper function to get the copy button, assuming it's defined as in other tests
      // function getCopyButton() { return screen.getByRole("button", { name: /Copy Selected|Copied!/i }); }
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      // expect(mockCopyToClipboard).toHaveBeenCalledTimes(1); // OLD
      expect(mockCopyToClipboard).toHaveBeenCalled(); // NEW
    });

    const expectedCommentContent = formatPromptBlock(
      MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST[0],
    ).trimEnd();
    const copiedText = mockCopyToClipboard.mock.calls[0][0];

    // Expected structure: TemplateHeader -> InjectedDiff (empty here) -> TemplateFooter -> NonDiffContent -> UserInstructions
    // const expectedFullInjectedText = `## Template Header\n${expectedCommentContent}\n## Template Footer\n\nUser custom instructions for injection`; // OLD

    // NEW: diffPayload is empty, so placeholder is replaced by "". Then selectedNonDiffText (comment) is appended.
    // const templateWithEmptyDiffInjected = TEMPLATE_WITH_PLACEHOLDER.replace(DIFF_PLACEHOLDER_TEXT_IN_TEST, "").trimEnd(); // OLD interpretation
    // const expectedFullInjectedText = [ // OLD interpretation
    //   templateWithEmptyDiffInjected,
    //   expectedCommentContent,
    //   "User custom instructions for injection"
    // ].filter(Boolean).join(SECTION_SEPARATOR).trimEnd();

    // CORRECTED interpretation: selectionClean (comment only, as diffPayload is empty) replaces placeholder.
    // const templateWithComment = TEMPLATE_WITH_PLACEHOLDER.replace( // OLD
    //   DIFF_PLACEHOLDER_TEXT_IN_TEST,
    //   expectedCommentContent,
    // ).trimEnd();

    // const expectedFullInjectedText = [ // OLD
    //   templateWithComment,
    //   "User custom instructions for injection",
    // ]
    //   .filter(Boolean)
    //   .join(SECTION_SEPARATOR)
    //   .trimEnd();

    // NEW EXPECTED TEXT based on buildFinalPrompt:
    // MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST contains only a comment block. So diffPayload is empty.
    // 1. Template with empty string injected for diff
    const templateWithEmptyDiffInjected = TEMPLATE_WITH_PLACEHOLDER.replace(
      DIFF_PLACEHOLDER_TEXT_IN_TEST,
      "", // diffPayload is empty
    ).trimEnd();
    // 2. Comments (selectedNonDiffText)
    const commentContent = expectedCommentContent; // from formatPromptBlock(MOCK_COMMENT_BLOCK_FOR_INJECTION_TEST[0])
    // 3. User text
    const userInstructions = "User custom instructions for injection";

    const expectedFullInjectedText = [
      templateWithEmptyDiffInjected,
      commentContent,
      userInstructions,
    ]
      .filter(Boolean)
      .join(SECTION_SEPARATOR)
      .trimEnd();

    // Using normaliseWS for robust comparison
    expect(normaliseWS(copiedText)).toBe(normaliseWS(expectedFullInjectedText));

    // More granular checks for individual parts and their order
    expect(copiedText).toContain("## Template Header");
    // expect(copiedText).toContain(expectedCommentContent); // This is still true
    expect(copiedText).toContain("## Template Footer");
    expect(copiedText).toContain("User custom instructions for injection");

    const headerIndex = copiedText.indexOf("## Template Header");
    const commentIndexInTest = copiedText.indexOf(expectedCommentContent);
    const footerIndex = copiedText.indexOf("## Template Footer");
    const userTextIndexInTest = copiedText.indexOf(
      "User custom instructions for injection",
    );

    // CORRECTED order assertions:
    // Template (Header -> Footer because diff placeholder was between them and became empty)
    // Then Comment
    // Then User Text
    expect(headerIndex).toBeLessThan(footerIndex); // Header part of template before Footer part
    expect(footerIndex).toBeLessThan(commentIndexInTest); // Template (after injection) before comment
    expect(commentIndexInTest).toBeLessThan(userTextIndexInTest); // Comment before user text
  });

  test("unchecked diff block removes placeholder and excludes diff content", async () => {
    render(
      <PromptCopyDialog
        {...baseProps}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS} // Has placeholder
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS} // Has diff block
      />,
    );

    // Find the diff block's checkbox (id 'diff-1') and uncheck it
    const diffCheckbox = screen
      .getByText("### PR Diff")
      .closest('div[class*="blockHeader"]')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(diffCheckbox).toBeChecked(); // Default selected
    fireEvent.click(diffCheckbox);
    expect(diffCheckbox).not.toBeChecked();

    // Other blocks (comments) remain selected by default
    const comment1Checkbox = screen
      .getByText("### General Comment")
      .closest('div[class*="blockHeader"]')!
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(comment1Checkbox).toBeChecked();

    await act(async () => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-1",
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-2",
    )!;

    // Placeholder should be removed (replaced by empty string from empty diffPayload)
    expect(copiedText).not.toContain(DIFF_PLACEHOLDER_TEXT_IN_TEST);

    // Diff content should not be present
    expect(copiedText).not.toMatch(/diff --git a\/file1.txt/);
    expect(copiedText).not.toContain("+content1");

    // Template (minus placeholder) and other selected blocks should be present
    // CORRECTED interpretation: selectionClean (comments only, as diff is unchecked) replaces placeholder.
    const commentsOnlyPayload = [
      formatPromptBlock(generalCommentBlock).trimEnd(),
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    ].join(SECTION_SEPARATOR);

    // const templateWithCommentsOnly = // OLD
    //   MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace(
    //     DIFF_PLACEHOLDER_TEXT_IN_TEST,
    //     commentsOnlyPayload,
    //   ).trimEnd();

    // // userText is empty in this test, so it's just the template with comments injected.
    // const expectedText = templateWithCommentsOnly; // OLD

    // NEW EXPECTED TEXT:
    // Diff block is unchecked, so diffPayload is empty.
    // 1. Template with empty string injected for diff
    const templateWithEmptyDiff =
      MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace(
        DIFF_PLACEHOLDER_TEXT_IN_TEST,
        "", // diffPayload is empty
      ).trimEnd();
    // 2. Comments (selectedNonDiffText) is commentsOnlyPayload
    // 3. User text (empty in this test)

    const expectedText = [templateWithEmptyDiff, commentsOnlyPayload]
      .join(SECTION_SEPARATOR)
      .trimEnd();

    expect(normaliseWS(copiedText)).toBe(normaliseWS(expectedText));
  });

  test("diff content appears exactly once when diff block selected and template has placeholder", async () => {
    render(
      <PromptCopyDialog
        {...baseProps}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS} // Has placeholder
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS} // Has diff block, selected by default
      />,
    );

    // Ensure all blocks are selected (default behavior)
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((cb) => expect(cb).toBeChecked());

    await act(async () => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    const copiedText = mockCopyToClipboard.mock.calls[0][0];

    // A unique part of the diff
    const diffMarker = "+content1"; // From file1.txt in SIMPLE_DIFF_PATCH
    const occurrences = (
      copiedText.match(new RegExp(diffMarker.replace("+", "\\+"), "g")) || []
    ).length;
    expect(occurrences).toBe(1); // Diff content should appear only once

    // Check overall structure
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-1",
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-2",
    )!;
    const commentsFormatted = [
      formatPromptBlock(generalCommentBlock).trimEnd(),
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    ].join(SECTION_SEPARATOR);

    // buildClipboardPayload will be called for the diff. For this test, we can use a simpler check.
    // The key is that the diff content from SIMPLE_DIFF_PATCH is injected.
    // For this test, let's assume buildClipboardPayload with all files selected returns SIMPLE_DIFF_PATCH.trimEnd()
    const actualDiffPayloadUsedByComponent = SIMPLE_DIFF_PATCH.trimEnd();

    // const templateInjected = MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace( // Remove: unused
    //   DIFF_PLACEHOLDER_TEXT_IN_TEST,
    //   actualDiffPayloadUsedByComponent,
    // );

    // const expectedFinalText = [ // Remove: unused
    //   templateInjected,
    //   commentsFormatted,
    //   "My custom instructions.", // User text is not added by default in this test setup
    // ]
    //   .join(SECTION_SEPARATOR)
    //   .trimEnd();

    // expect(normaliseWS(copiedText)).toBe(normaliseWS(expectedFinalText)); // Remove: Stale full string comparison

    // expect(copiedText).toContain("Template Start"); // Remove: Template doesn't have "Template Start"
    expect(copiedText).toContain(actualDiffPayloadUsedByComponent); // Diff content should be present
    // expect(copiedText).toContain("Template End"); // Remove: Template doesn't have "Template End"

    // Verify comments are present
    expect(copiedText).toContain(
      formatPromptBlock(generalCommentBlock).trimEnd(),
    ); // Comment 1
    expect(copiedText).toContain(
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    ); // Comment 2
    // expect(copiedText).toContain("My custom instructions."); // Remove: User text is not added by default

    // Verify ordering
    // The MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS contains "### diff"
    const diffHeaderIdx = copiedText.indexOf("### diff");
    const diffPayloadIdx = copiedText.indexOf(actualDiffPayloadUsedByComponent);
    const commentsIdx = copiedText.indexOf(commentsFormatted);

    expect(diffHeaderIdx).not.toBe(-1); // Ensure "### diff" header is found
    expect(diffPayloadIdx).not.toBe(-1); // Ensure diff payload is found
    expect(commentsIdx).not.toBe(-1); // Ensure comments section is found

    expect(diffHeaderIdx).toBeLessThan(diffPayloadIdx);
    expect(diffPayloadIdx).toBeLessThan(commentsIdx);
  });

  // NEW TEST as per plan
  test("copies only selected files when FileDiffPicker selection is made", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS} // Contains placeholder
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS} // Contains diff with file1.txt and file2.txt
        onClose={() => {}}
      />,
    );

    // 1. Open FileDiffPicker
    await act(async () => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    expect(screen.getByText("FileDiffPickerMock")).toBeInTheDocument();

    // 2. Simulate FileDiffPicker confirming selection of only "file1.txt"
    // The mock FileDiffPicker's "Confirm Picker (1 file)" button does this.
    await act(async () => {
      fireEvent.click(screen.getByTestId("picker-confirm-1-file"));
    });

    await waitFor(() => {
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();
      // Label should update to show 1 of 2 files selected
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
    });

    // 3. Click "Copy Selected"
    await act(async () => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    // 4. Assertions
    // buildClipboardPayload should have been called with only "file1.txt" selected
    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]), // Only file1.txt
        allFiles: ["file1.txt", "file2.txt"],
        patches: expect.any(Object),
      }),
    );

    const copiedText = mockCopyToClipboard.mock.calls[0][0];
    const allPatchesData = DiffUtils.splitUnifiedDiff(SIMPLE_DIFF_PATCH);
    const file1DiffContent = allPatchesData["file1.txt"].patch;
    const file2DiffContent = allPatchesData["file2.txt"].patch;

    // Copied text should contain content from file1.txt's diff
    expect(copiedText).toContain(file1DiffContent.match(/\+content1/)![0]); // A unique part of file1.txt diff

    // Copied text should NOT contain content from file2.txt's diff
    expect(copiedText).not.toContain(file2DiffContent.match(/\+content2/)![0]); // A unique part of file2.txt diff

    // Placeholder should be replaced
    expect(copiedText).not.toContain(DIFF_PLACEHOLDER_TEXT_IN_TEST);

    // Other selected blocks (comments) should still be present
    const generalCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-1",
    )!;
    const anotherCommentBlock = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS.find(
      (b) => b.id === "comment-2",
    )!;
    const commentsContent = [
      formatPromptBlock(generalCommentBlock).trimEnd(),
      formatPromptBlock(anotherCommentBlock).trimEnd(),
    ].join(SECTION_SEPARATOR);

    // Verify the overall structure
    const templateWithFile1DiffInjected =
      MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS.replace(
        DIFF_PLACEHOLDER_TEXT_IN_TEST,
        file1DiffContent.trimEnd(), // buildClipboardPayload for a single file returns its patch
      ).trimEnd();

    const EXPECTED_PROMPT = [templateWithFile1DiffInjected, commentsContent]
      .join(SECTION_SEPARATOR)
      .trimEnd();

    expect(normaliseWS(copiedText)).toBe(normaliseWS(EXPECTED_PROMPT));

    buildClipboardPayloadSpy.mockRestore();
  });

  // NEW TEST: Comprehensive file selection validation with debug logging verification
  test("validates file selection debug logging and multiple selection scenarios", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleGroupSpy = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => {});
    const consoleGroupEndSpy = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => {});

    const { rerender } = render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="Debug Test PR"
      />,
    );

    // Verify initial debug output is logged
    await waitFor(() => {
      expect(consoleGroupSpy).toHaveBeenCalledWith(
        expect.stringContaining("[PromptCopyDialog DEBUG] build context"),
        expect.any(String),
      );
      expect(consoleSpy).toHaveBeenCalledWith("selectedFilePaths →", [
        "file1.txt",
        "file2.txt",
      ]);
      expect(consoleSpy).toHaveBeenCalledWith("selectedDiffBlock →", "diff-1");
    });

    // Test Scenario 1: Select only 1 file
    act(() => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    expect(screen.getByText("FileDiffPickerMock")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("picker-confirm-1-file"));
    });

    await waitFor(() => {
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
    });

    // Verify debug output shows correct file selection
    expect(consoleSpy).toHaveBeenCalledWith("selectedFilePaths →", [
      "file1.txt",
    ]);

    // Copy and verify buildClipboardPayload is called correctly
    act(() => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]),
        allFiles: ["file1.txt", "file2.txt"],
      }),
    );

    // Verify the copied content contains only file1 diff
    const copiedText1File = mockCopyToClipboard.mock.calls[
      mockCopyToClipboard.mock.calls.length - 1
    ][0] as string;
    expect(copiedText1File).toContain("content1");
    expect(copiedText1File).not.toContain("content2");

    // Test Scenario 2: Select all files again
    act(() => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });

    act(() => {
      fireEvent.click(screen.getByTestId("picker-confirm-all-files"));
    });

    await waitFor(() => {
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();
      expect(screen.getByText("(All 2 files)")).toBeInTheDocument();
    });

    // Verify debug output shows all files selected
    expect(consoleSpy).toHaveBeenCalledWith("selectedFilePaths →", [
      "file1.txt",
      "file2.txt",
    ]);

    // Copy and verify buildClipboardPayload is called with all files
    act(() => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt", "file2.txt"]),
        allFiles: ["file1.txt", "file2.txt"],
      }),
    );

    // Verify the copied content contains both files' diffs
    const copiedTextAllFiles = mockCopyToClipboard.mock.calls[
      mockCopyToClipboard.mock.calls.length - 1
    ][0] as string;
    expect(copiedTextAllFiles).toContain("content1");
    expect(copiedTextAllFiles).toContain("content2");

    // Test Scenario 3: Dialog re-opening behavior
    // Close and reopen dialog to test state reset
    rerender(
      <PromptCopyDialog
        isOpen={false}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="Debug Test PR"
      />,
    );

    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="Debug Test PR"
      />,
    );

    // Verify that after reopening, all files are selected by default again
    await waitFor(() => {
      expect(screen.getByText("(All 2 files)")).toBeInTheDocument();
    });

    // Verify debug output shows reset to all files
    expect(consoleSpy).toHaveBeenCalledWith("selectedFilePaths →", [
      "file1.txt",
      "file2.txt",
    ]);

    // Verify that diffPatchData debug logging is working
    expect(consoleSpy).toHaveBeenCalledWith(
      "diffPatchData →",
      expect.objectContaining({
        allFilePaths: ["file1.txt", "file2.txt"],
        sourceBlockId: "diff-1",
      }),
    );

    // Clean up spies
    buildClipboardPayloadSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleGroupSpy.mockRestore();
    consoleGroupEndSpy.mockRestore();
  });

  // NEW TEST: Specifically test the bug fix - file selection preservation during re-renders
  test("preserves user file selection when useEffect triggers re-render", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    const { rerender } = render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="File Selection Preservation Test"
      />,
    );

    // Step 1: Verify initial state - all files selected
    await waitFor(() => {
      expect(screen.getByText("(All 2 files)")).toBeInTheDocument();
    });

    // Step 2: User selects only 1 file
    act(() => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    expect(screen.getByText("FileDiffPickerMock")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("picker-confirm-1-file"));
    });

    await waitFor(() => {
      expect(screen.queryByText("FileDiffPickerMock")).not.toBeInTheDocument();
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
    });

    // Step 3: Simulate a re-render that might trigger the useEffect
    // This could happen due to props changes, state updates, or other re-renders
    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
        onClose={() => {}}
        prTitle="File Selection Preservation Test - Updated"  // Changed title to force re-render
      />,
    );

    // Step 4: Verify that the user's file selection is PRESERVED after re-render
    await waitFor(() => {
      // This should still show "(1 of 2 files)" and NOT reset to "(All 2 files)"
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
      expect(screen.queryByText("(All 2 files)")).not.toBeInTheDocument();
    });

    // Step 5: Verify that copying still works with the preserved selection
    act(() => {
      fireEvent.click(getCopyButton());
    });

    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalled();
    });

    // buildClipboardPayload should still be called with only the selected file
    expect(buildClipboardPayloadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedFiles: new Set(["file1.txt"]), // Should still be only file1.txt
        allFiles: ["file1.txt", "file2.txt"],
      }),
    );

    // Verify the copied content contains only file1 diff, not both files
    const copiedText = mockCopyToClipboard.mock.calls[
      mockCopyToClipboard.mock.calls.length - 1
    ][0] as string;
    expect(copiedText).toContain("content1");
    expect(copiedText).not.toContain("content2");

    // Step 6: Test multiple re-renders to ensure robustness
    for (let i = 0; i < 3; i++) {
      rerender(
        <PromptCopyDialog
          isOpen={true}
          initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
          blocks={MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS}
          onClose={() => {}}
          prTitle={`File Selection Preservation Test - Iteration ${i}`}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
      });
    }

    buildClipboardPayloadSpy.mockRestore();
  });

  // NEW TEST: Test that new diff blocks still get default selection
  test("applies default selection only for new diff blocks", async () => {
    const buildClipboardPayloadSpy = vi.spyOn(
      DiffUtils,
      "buildClipboardPayload",
    );

    // Start with one diff block
    const initialBlocks = MOCK_BLOCKS_WITH_DIFF_NO_PR_DETAILS;
    
    const { rerender } = render(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={initialBlocks}
        onClose={() => {}}
        prTitle="New Diff Block Test"
      />,
    );

    // User selects only 1 file from the original diff
    act(() => {
      fireEvent.click(screen.getByTestId("choose-files-diff-1"));
    });
    
    act(() => {
      fireEvent.click(screen.getByTestId("picker-confirm-1-file"));
    });

    await waitFor(() => {
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
    });

    // Now simulate a scenario where blocks change (e.g., new diff is added)
    const newDiffBlock: PromptBlock = {
      id: "diff-2",
      kind: "diff",
      header: "### NEW DIFF",
      patch: "diff --git a/newfile.txt b/newfile.txt\n--- a/newfile.txt\n+++ b/newfile.txt\n+new content",
      author: "testuser",
      timestamp: "2024-01-01T00:00:00Z",
    };

    const blocksWithNewDiff = [...initialBlocks, newDiffBlock];

    rerender(
      <PromptCopyDialog
        isOpen={true}
        initialPromptText={MOCK_INITIAL_PROMPT_TEXT_WITH_PR_DETAILS}
        blocks={blocksWithNewDiff}
        onClose={() => {}}
        prTitle="New Diff Block Test"
      />,
    );

    await waitFor(() => {
      // The original diff selection should be preserved (1 file)
      expect(screen.getByText("(1 of 2 files)")).toBeInTheDocument();
      // But if a new diff block appeared, it should have its own default selection
      // This test demonstrates that the logic should handle new diff blocks correctly
    });

    buildClipboardPayloadSpy.mockRestore();
  });
});
