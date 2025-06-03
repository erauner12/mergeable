/// <reference types="vitest/globals" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router"; // Changed from "react-router-dom"
// Removed SpyInstance import: import type { SpyInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as mutations from "../../src/lib/mutations";
import * as queries from "../../src/lib/queries";
import type { PromptMode } from "../../src/lib/repoprompt";
import * as settingsLib from "../../src/lib/settings";
import SettingsPage from "../../src/routes/settings";

// Mock dependencies
vi.mock("../../src/lib/queries", async (importOriginal) => {
  const original = await importOriginal<typeof queries>();
  return {
    ...original,
    useConnections: vi.fn(() => ({
      data: [],
      isLoading: false,
      isError: false,
    })),
  };
});

vi.mock("../../src/lib/mutations", async (importOriginal) => {
  const original = await importOriginal<typeof mutations>();
  return {
    ...original,
    // Mock any mutations that might be called if other parts of settings are interacted with
    setDefaultRoot: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock useToaster – return **one stable spy object** so the component &
// the test see the *same* instance.
const toastSpy = vi.fn();
vi.mock("../../src/lib/toaster", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/lib/toaster")>();
  return {
    ...original,
    useToaster: vi.fn(() => ({ show: toastSpy })),
  };
});

const mockTemplates: Record<PromptMode, string> = {
  implement: "Implement template text",
  review: "Review template text",
  "adjust-pr": "Adjust PR template text",
  respond: "Respond template text",
};

describe("Settings Page - Prompt Template Editor", () => {
  let queryClient: QueryClient;
  let getPromptTemplateSpy: any;
  let setPromptTemplateSpy: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    getPromptTemplateSpy = vi
      .spyOn(settingsLib, "getPromptTemplate")
      .mockImplementation((mode: PromptMode) =>
        Promise.resolve(mockTemplates[mode]),
      );
    setPromptTemplateSpy = vi
      .spyOn(settingsLib, "setPromptTemplate")
      .mockResolvedValue(undefined);
    // getDefaultRootSpy = vi.spyOn(settingsLib, "getDefaultRoot").mockResolvedValue("~/git/work"); // Removed unused spy
    vi.spyOn(settingsLib, "getDefaultRoot").mockResolvedValue("~/git/work"); // Keep the mock for completeness if settings page uses it
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === "settings:lastPromptMode") return "implement"; // Default to implement for initial load
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  const renderSettingsPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {/* <ToasterProvider> Removed ToasterProvider wrapper </ToasterProvider> */}
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  test("renders prompt template section and loads initial template", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getByLabelText("Edit template for mode:"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getPromptTemplateSpy).toHaveBeenCalledWith("implement"); // Default or from localStorage mock
    });
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(mockTemplates.implement);
    });
  });

  test("selecting a different mode updates the textarea content", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(mockTemplates.implement);
    });

    const modeSelect = screen.getByLabelText("Edit template for mode:");
    fireEvent.change(modeSelect, { target: { value: "review" } });

    await waitFor(() => {
      expect(getPromptTemplateSpy).toHaveBeenCalledWith("review");
    });

    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Review Code" mode/i,
        })[0],
      ).toHaveValue(mockTemplates.review);
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "settings:lastPromptMode",
      "review",
    );
  });

  test("editing text and clicking save calls setPromptTemplate and disables button", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(mockTemplates.implement);
    });

    const textArea = screen.getAllByRole("textbox", {
      name: /Template for "Implement Changes" mode/i,
    })[0];
    const saveButton = screen.getByRole("button", {
      name: "Save Prompt Template",
    });

    expect(saveButton).toBeDisabled(); // Should be disabled initially as text matches

    const newText = "Updated implement template text";
    fireEvent.change(textArea, { target: { value: newText } });

    expect(textArea).toHaveValue(newText); // Use toHaveValue matcher
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setPromptTemplateSpy).toHaveBeenCalledWith("implement", newText);
    });
    await waitFor(() => {
      expect(saveButton).toBeDisabled(); // Disabled again after successful save
    });
    // Check toaster was called
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `Prompt template for "Implement Changes" mode saved.`,
        intent: "success",
      }),
    );
  });
});
