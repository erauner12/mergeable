import { render, fireEvent, screen } from "@testing-library/react";
import { DiffPickerDialog, type DiffPickerDialogProps } from "./DiffPickerDialog";
import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock BlueprintJS Dialog to render its children directly for simpler testing
// vi.mock("@blueprintjs/core", async (importOriginal) => {
//   const original = await importOriginal<typeof import("@blueprintjs/core")>();
//   return {
//     ...original,
//     Dialog: ({ children, isOpen }: { children: React.ReactNode, isOpen: boolean }) =>
//       isOpen ? <div data-testid="dialog">{children}</div> : null,
//   };
// });


describe("DiffPickerDialog", () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps: DiffPickerDialogProps = {
    isOpen: true,
    onConfirm: mockOnConfirm,
    onCancel: mockOnCancel,
    prTitle: "Test PR",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly when open", () => {
    render(<DiffPickerDialog {...defaultProps} />);
    expect(screen.getByText('Diff options for "Test PR"')).toBeInTheDocument();
    expect(screen.getByLabelText("Full PR diff")).toBeInTheDocument();
    expect(screen.getByLabelText("Last commit only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("initializes checkboxes to true by default when no initial prop is passed", () => {
    render(<DiffPickerDialog {...defaultProps} initial={undefined} />);
    expect(screen.getByLabelText<HTMLInputElement>("Full PR diff").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Last commit only").checked).toBe(true);
  });
  
  it("initializes checkboxes to true by default if initial prop is an empty object", () => {
    render(<DiffPickerDialog {...defaultProps} initial={{}} />);
    expect(screen.getByLabelText<HTMLInputElement>("Full PR diff").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Last commit only").checked).toBe(true);
  });

  it("initializes checkboxes based on `initial` prop", () => {
    render(
      <DiffPickerDialog
        {...defaultProps}
        initial={{ includePr: false, includeLastCommit: true, commits: [] }}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Full PR diff").checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Last commit only").checked).toBe(true);
  });

  it("calls onConfirm with correct options when 'Open' is clicked", () => {
    render(<DiffPickerDialog {...defaultProps} />);
    
    // Uncheck "Full PR diff"
    fireEvent.click(screen.getByLabelText("Full PR diff"));
    
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    
    expect(mockOnConfirm).toHaveBeenCalledWith({
      includePr: false,
      includeLastCommit: true,
      commits: [],
    });
  });

  it("calls onConfirm with both true if defaults are kept", () => {
    render(<DiffPickerDialog {...defaultProps} initial={{ includePr: true, includeLastCommit: true}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mockOnConfirm).toHaveBeenCalledWith({
      includePr: true,
      includeLastCommit: true,
      commits: [],
    });
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    render(<DiffPickerDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it("disables 'Open' button if no options are selected", () => {
    render(<DiffPickerDialog {...defaultProps} initial={{ includePr: false, includeLastCommit: false }} />);
        
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("enables 'Open' button if at least one option is selected", () => {
    render(<DiffPickerDialog {...defaultProps} initial={{ includePr: false, includeLastCommit: false }} />);
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();

    // Check one
    fireEvent.click(screen.getByLabelText("Full PR diff"));
    expect(screen.getByRole("button", { name: "Open" })).not.toBeDisabled();
  });

  it("does not render specific commits section", () => {
    render(<DiffPickerDialog {...defaultProps} />);
    expect(screen.queryByText(/Or, choose specific commits/i)).not.toBeInTheDocument();
  });

  it("updates checkbox state when initial prop changes while dialog is open", () => {
    const { rerender } = render(<DiffPickerDialog {...defaultProps} initial={{ includePr: true, includeLastCommit: true }} />);
    expect(screen.getByLabelText<HTMLInputElement>("Full PR diff").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Last commit only").checked).toBe(true);

    rerender(<DiffPickerDialog {...defaultProps} initial={{ includePr: false, includeLastCommit: false }} />);
    expect(screen.getByLabelText<HTMLInputElement>("Full PR diff").checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Last commit only").checked).toBe(false);
  });
});