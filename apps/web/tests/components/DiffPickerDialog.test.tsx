/// <reference types="vitest/globals" />
import { fireEvent, render, screen } from "@testing-library/react";
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
    const reviewRadio = screen.getByRole("radio", { name: "Review Code" }) as HTMLInputElement;
    expect(reviewRadio.checked).toBe(true);
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
    }) as HTMLInputElement;
    expect(implementRadio.checked).toBe(true); // defaultPromptMode is 'implement'
  });

  test("changing radio selection updates mode state and persists to localStorage", () => {
    renderDialog();
    const respondRadio = screen.getByRole("radio", {
      name: "Respond to Comments",
    }) as HTMLInputElement;
    fireEvent.click(respondRadio);

    expect(respondRadio.checked).toBe(true);
    // useEffect in DiffPickerDialog persists on open and selectedMode change.
    // Since it's open, changing selectedMode will trigger the effect.
    expect(setItemSpy).toHaveBeenCalledWith("picker:lastMode", "respond");
  });

  test("confirm button is disabled when no diff option checkbox is ticked", () => {
    renderDialog();
    const prDiffCheckbox = screen.getByLabelText("Full PR diff") as HTMLInputElement;
    const lastCommitCheckbox = screen.getByLabelText("Last commit only") as HTMLInputElement;
    const commentsCheckbox = screen.getByLabelText(
      "Review comments & discussions",
    ) as HTMLInputElement;
    const confirmButton = screen.getByRole("button", { name: "Open" });

    // Default: PR and Last Commit are checked, so button is enabled
    expect(confirmButton).not.toBeDisabled();

    // Uncheck all
    fireEvent.click(prDiffCheckbox);
    fireEvent.click(lastCommitCheckbox);
    // commentsCheckbox is already unchecked by default

    expect(prDiffCheckbox.checked).toBe(false);
    expect(lastCommitCheckbox.checked).toBe(false);
    expect(commentsCheckbox.checked).toBe(false);
    expect(confirmButton).toBeDisabled();

    // Check one
    fireEvent.click(commentsCheckbox);
    expect(confirmButton).not.toBeDisabled();
  });

  test("onConfirm is called with correct DiffPickerResult payload", () => {
    renderDialog();
    const prDiffCheckbox = screen.getByLabelText("Full PR diff") as HTMLInputElement;
    const adjustPrRadio = screen.getByRole("radio", {
      name: "Adjust PR Description",
    }) as HTMLInputElement;

    // Change mode
    fireEvent.click(adjustPrRadio);
    // Uncheck PR diff
    fireEvent.click(prDiffCheckbox);

    const confirmButton = screen.getByRole("button", { name: "Open" });
    fireEvent.click(confirmButton);

    const expectedResult: DiffPickerResult = {
      diffOpts: {
        includePr: false, // Unchecked
        includeLastCommit: true, // Default checked
        includeComments: false, // Default unchecked
        commits: [],
      },
      mode: "adjust-pr", // Selected mode
    };
    expect(mockOnConfirm).toHaveBeenCalledWith(expectedResult);
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