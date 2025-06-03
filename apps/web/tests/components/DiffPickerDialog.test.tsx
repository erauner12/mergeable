/// <reference types="vitest/globals" />
import "@testing-library/jest-dom/vitest"; // Use vitest version for jest-dom matchers
import { act, fireEvent, render, screen } from "@testing-library/react"; // Added act
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiffPickerDialog,
  type DiffPickerResult,
} from "../../src/components/DiffPickerDialog";
import type { PromptMode } from "../../src/lib/repoprompt";

describe("DiffPickerDialog", () => {
  let mockOnConfirm!: ReturnType<typeof vi.fn>;
  let mockOnCancel!: ReturnType<typeof vi.fn>;
  let getItemSpy!: ReturnType<typeof vi.spyOn<Storage, "getItem">>;
  let setItemSpy!: ReturnType<typeof vi.spyOn<Storage, "setItem">>;

  beforeEach(() => {
    mockOnConfirm = vi.fn();
    mockOnCancel = vi.fn();
    getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    vi.clearAllMocks(); // Clear mocks before each test
  });

  const renderDialog = (isOpen = true, initialMode?: PromptMode) => {
    if (initialMode) {
      getItemSpy.mockReturnValueOnce(initialMode);
    } else {
      getItemSpy.mockReturnValueOnce(null); // Simulate no value in localStorage
    }
    render(
      <DiffPickerDialog
        isOpen={isOpen}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        prTitle="Test PR"
      />,
    );
  };

  test("initial render uses 'picker:lastMode' from localStorage when available", () => {
    getItemSpy.mockReturnValueOnce("review");
    render(
      <DiffPickerDialog
        isOpen={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        prTitle="Test PR"
      />,
    );
    expect(getItemSpy).toHaveBeenCalledWith("picker:lastMode");
    const reviewRadio = screen.getByRole("radio", { name: "Review Code" });
    expect(reviewRadio).toBeChecked();
  });

  test("initial render defaults to 'implement' when no localStorage value", () => {
    getItemSpy.mockReturnValueOnce(null); // No localStorage value
    render(
      <DiffPickerDialog
        isOpen={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
        prTitle="Test PR"
      />,
    );
    expect(getItemSpy).toHaveBeenCalledWith("picker:lastMode");
    const implementRadio = screen.getByRole("radio", {
      name: "Implement Changes",
    });
    expect(implementRadio).toBeChecked(); // defaultPromptMode is 'implement'
  });

  test("changing radio selection updates mode state and persists to localStorage", () => {
    renderDialog();
    const respondRadio = screen.getByRole("radio", {
      name: "Respond to Comments",
    });
    fireEvent.click(respondRadio);

    expect(respondRadio).toBeChecked();
    // useEffect in DiffPickerDialog persists on open and selectedMode change.
    // Since it's open, changing selectedMode will trigger the effect.
    expect(setItemSpy).toHaveBeenCalledWith("picker:lastMode", "respond");
  });

  test("confirm button is disabled when no diff option checkbox is ticked", () => {
    renderDialog();
    const prDiffCheckbox = screen.getByLabelText("Full PR diff");
    const lastCommitCheckbox = screen.getByLabelText("Last commit only");
    const commentsCheckbox = screen.getByLabelText(
      "Review comments & discussions",
    );
    const confirmButton = screen.getByRole("button", { name: "Open" });

    // Default: PR diff is checked, so button is enabled
    expect(confirmButton).not.toBeDisabled();

    // Uncheck PR diff (last commit is already unchecked and disabled by default due to PR diff being checked)
    act(() => {
      fireEvent.click(prDiffCheckbox);
    });
    // Now PR diff is false, last commit is false (and enabled)

    // commentsCheckbox is already unchecked by default

    expect(prDiffCheckbox).not.toBeChecked();
    expect(lastCommitCheckbox).not.toBeChecked(); // Should remain false
    expect(commentsCheckbox).not.toBeChecked();
    expect(confirmButton).toBeDisabled();

    // Check one
    act(() => {
      fireEvent.click(commentsCheckbox);
    });
    expect(confirmButton).not.toBeDisabled();
  });

  test("onConfirm is called with correct DiffPickerResult payload", () => {
    renderDialog(); // By default, includePr=true, includeLastCommit=false (due to effects)
    const prDiffCheckbox = screen.getByLabelText("Full PR diff");
    const adjustPrRadio = screen.getByRole("radio", {
      name: "Adjust PR Description",
    });

    // Change mode
    fireEvent.click(adjustPrRadio);
    // Uncheck PR diff
    act(() => {
      fireEvent.click(prDiffCheckbox); // includePr becomes false
    });

    const confirmButton = screen.getByRole("button", { name: "Open" });
    fireEvent.click(confirmButton);

    const expectedResult: DiffPickerResult = {
      diffOpts: {
        includePr: false, // Unchecked
        includeLastCommit: false, // Was initially false and disabled, then enabled but not checked
        includeComments: false, // Default unchecked
        commits: [],
      },
      mode: "adjust-pr", // Selected mode
    };
    expect(mockOnConfirm).toHaveBeenCalledWith(expectedResult);
  });

  test("Full PR diff and Last commit only checkboxes are mutually exclusive", () => {
    renderDialog();
    const prDiffCheckbox = screen.getByLabelText("Full PR diff");
    const lastCommitCheckbox = screen.getByLabelText("Last commit only");

    // Initial state: PR diff checked, Last commit unchecked and disabled
    expect(prDiffCheckbox).toBeChecked();
    expect(lastCommitCheckbox).not.toBeChecked();
    expect(lastCommitCheckbox).toBeDisabled();

    // Uncheck PR diff
    act(() => {
      fireEvent.click(prDiffCheckbox);
    });
    expect(prDiffCheckbox).not.toBeChecked();
    expect(lastCommitCheckbox).not.toBeChecked(); // Stays false
    expect(lastCommitCheckbox).not.toBeDisabled(); // Becomes enabled

    // Check Last commit only
    act(() => {
      fireEvent.click(lastCommitCheckbox);
    });
    expect(prDiffCheckbox).not.toBeChecked(); // Stays false
    expect(lastCommitCheckbox).toBeChecked();
    expect(lastCommitCheckbox).not.toBeDisabled(); // Stays enabled

    // Check PR diff again
    act(() => {
      fireEvent.click(prDiffCheckbox);
    });
    expect(prDiffCheckbox).toBeChecked();
    expect(lastCommitCheckbox).not.toBeChecked(); // Becomes unchecked
    expect(lastCommitCheckbox).toBeDisabled(); // Becomes disabled
  });

  test("onCancel is called when cancel button is clicked", () => {
    renderDialog();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  test("dialog is not rendered when isOpen is false", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
