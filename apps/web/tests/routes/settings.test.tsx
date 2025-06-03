/// <reference types="vitest/globals" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as mutations from "../../src/lib/mutations";
import * as queries from "../../src/lib/queries";
import type { PromptMode } from "../../src/lib/repoprompt";
import * as settingsLib from "../../src/lib/settings";
import SettingsPage from "../../src/routes/settings";
// ADDED: Mock templateMap from settings.ts which now imports from templates.ts
import * as templates from "../../src/lib/templates";
import type { TemplateMeta } from "../../src/lib/templates"; // Import TemplateMeta


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

// Mock the templateMap from templates.ts as it's used by settings.getPromptTemplate
const mockRouteTemplateBodies: Record<PromptMode, string> = {
  implement: "Default Implement MD Template",
  review: "Default Review MD Template",
  "adjust-pr": "Default Adjust PR MD Template",
  respond: "Default Respond MD Template",
};

// Define a simple default meta object for the mock
const mockDefaultMetaForSettingsRouteTest: TemplateMeta = {
  expectsFilesList: true,
  expectsDiffContent: true,
  expectsSetup: true,
  expectsLink: true,
  expectsPrDetails: true,
  expectsPrDetailsBlock: false,
};

vi.mock("../../src/lib/templates", async () => {
  const actualTemplates = await vi.importActual<typeof import("../../src/lib/templates")>("../../src/lib/templates");
  const mockedMap: Record<PromptMode, { body: string; meta: TemplateMeta }> = {} as any;
  for (const mode in mockRouteTemplateBodies) {
    const body = mockRouteTemplateBodies[mode as PromptMode];
    mockedMap[mode as PromptMode] = {
      body,
      // Use a simple predefined meta here for safety, similar to repoprompt.test.ts
      meta: { ...mockDefaultMetaForSettingsRouteTest },
    };
  }
  return {
    ...actualTemplates,
    templateMap: mockedMap,
  };
});


// This mockTemplates is for simulating DB overrides or expected values after save.
const mockDbTemplates: Record<PromptMode, string> = {
  implement: "DB Implement template text",
  review: "DB Review template text",
  "adjust-pr": "DB Adjust PR template text",
  respond: "DB Respond template text",
};

describe("Settings Page - Prompt Template Editor", () => {
  let queryClient: QueryClient;
  let getPromptTemplateSpy: any;
  let setPromptTemplateSpy: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    // getPromptTemplate will now try DB first, then fall back to (mocked) templateMap.
    // For initial load, simulate no DB entry, so it falls back to templateMap.
    getPromptTemplateSpy = vi
      .spyOn(settingsLib, "getPromptTemplate")
      .mockImplementation(async (mode: PromptMode) => {
        // Simulate DB check: if a test sets a DB value, it should be returned.
        // For this mock, we'll assume it checks some internal state or a simpler mock.
        // For initial load, it will use the mocked templates.templateMap.
        // If a test calls setPromptTemplate, then getPromptTemplate should reflect that.
        // This mock needs to be flexible.
        const dbOverride = (mockDbTemplates as any)[`${mode}_override`];
        if (dbOverride) return dbOverride;
        // Access .body from the mocked templateMap structure
        return (templates.templateMap as Record<PromptMode, { body: string, meta: TemplateMeta }>)[mode].body;
      });

    setPromptTemplateSpy = vi
      .spyOn(settingsLib, "setPromptTemplate")
      .mockImplementation(async (mode: PromptMode, text: string) => {
        // Simulate saving to DB for subsequent getPromptTemplate calls in the same test
        (mockDbTemplates as any)[`${mode}_override`] = text;
        return Promise.resolve(undefined);
      });
      
    vi.spyOn(settingsLib, "getDefaultRoot").mockResolvedValue("~/git/work");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === "settings:lastPromptMode") return "implement";
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    // Clear any simulated DB overrides
    for (const key in mockDbTemplates) {
      delete (mockDbTemplates as any)[`${key}_override`];
    }
  });

  const renderSettingsPage = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  test("renders prompt template section and loads initial template from templateMap.body", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getByLabelText("Edit template for mode:"),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      // Initial call will be for 'implement' due to localStorage mock
      expect(getPromptTemplateSpy).toHaveBeenCalledWith("implement");
    });
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(templates.templateMap.implement.body); // From mocked templateMap.body
    });
  });

  test("selecting a different mode updates the textarea content from templateMap.body", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(templates.templateMap.implement.body);
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
      ).toHaveValue(templates.templateMap.review.body); // From mocked templateMap.body
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "settings:lastPromptMode",
      "review",
    );
  });

  test("editing text and clicking save calls setPromptTemplate and updates displayed text", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
      ).toHaveValue(templates.templateMap.implement.body);
    });

    const textArea = screen.getAllByRole("textbox", {
      name: /Template for "Implement Changes" mode/i,
    })[0];
    const saveButton = screen.getByRole("button", {
      name: "Save Prompt Template",
    });

    expect(saveButton).toBeDisabled();

    const newText = "Updated implement template text from DB";
    fireEvent.change(textArea, { target: { value: newText } });

    expect(textArea).toHaveValue(newText);
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setPromptTemplateSpy).toHaveBeenCalledWith("implement", newText);
    });
    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });
    
    // Toaster check (existing)
    // ...

    // Verify that if we change mode and come back, the new text (from "DB"/mockDbTemplates) is loaded
    const modeSelect = screen.getByLabelText("Edit template for mode:");
    fireEvent.change(modeSelect, { target: { value: "review" } });
    await waitFor(() => {
        expect(screen.getAllByRole("textbox", {name: /Template for "Review Code" mode/i})[0]).toHaveValue(templates.templateMap.review.body);
    });
    fireEvent.change(modeSelect, { target: { value: "implement" } });
    await waitFor(() => {
        expect(screen.getAllByRole("textbox", {name: /Template for "Implement Changes" mode/i})[0]).toHaveValue(newText); // Should load the "saved" version
    });
  });
});