/// <reference types="vitest/globals" />
// ADD: Import the shared mock helper. Should be one of the first imports.
import "../../__mocks__/templates.mock";
// ADD: Import utilities from the shared mock.
import { setMockTemplateBody } from "../../__mocks__/templates.mock";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as mutations from "../../src/lib/mutations";
import * as queries from "../../src/lib/queries";
import type { PromptMode } from "../../src/lib/repoprompt";
import * as settingsLib from "../../src/lib/settings";
import SettingsPage from "../../src/routes/settings";
// Import * as templates will now correctly point to the mocked module
import * as templates from "../../src/lib/templates";
// REMOVE: import type { TemplateMeta } from "../../src/lib/templates"; // Already imported by mock or not directly used here


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

// REMOVE: mockRouteTemplateBodiesForSettingsPage
// const mockRouteTemplateBodiesForSettingsPage: Record<PromptMode, string> = { ... };

// REMOVE: mockDefaultMetaForSettingsPageTest (meta is now derived by actualAnalyseTemplate in the shared mock)
// const mockDefaultMetaForSettingsPageTest: TemplateMeta = { ... };

// REMOVE: vi.mock for ../../src/lib/templates
// vi.mock("../../src/lib/templates", async () => { ... });


// This mockTemplates is for simulating DB overrides or expected values after save.
const mockDbTemplates: Record<PromptMode, string> = {
  implement: "DB Implement template text",
  review: "DB Review template text",
  "adjust-pr": "DB Adjust PR template text",
  respond: "DB Respond template text",
};

// Track template overrides with proper typing
const templateOverrides: Partial<Record<PromptMode, string>> = {};

describe("Settings Page - Prompt Template Editor", () => {
  let queryClient: QueryClient;
  let getPromptTemplateSpy: any;
  let setPromptTemplateSpy: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    // ADD: Configure template bodies for this test suite using the shared mock helper
    setMockTemplateBody("implement", "Default Implement MD Template For Settings Page");
    setMockTemplateBody("review", "Default Review MD Template For Settings Page");
    setMockTemplateBody("adjust-pr", "Default Adjust PR Template For Settings Page");
    setMockTemplateBody("respond", "Default Respond MD Template For Settings Page");

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
        // The `templates.templateMap` here refers to the mocked one from the vi.mock factory above.
        // This part of the spy remains correct as `templates.templateMap` will be the mocked version.
        const map = templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>; // meta type can be less specific here
    setPromptTemplateSpy = vi
      .spyOn(settingsLib, "setPromptTemplate")
      .mockImplementation(async (mode: PromptMode, text: string) => {
        // Simulate saving to DB for subsequent getPromptTemplate calls in the same test
        templateOverrides[mode] = text;
        return Promise.resolve(undefined);
      });
        (mockDbTemplates as any)[`${mode}_override`] = text;
        return Promise.resolve(undefined);
      });
      
    vi.spyOn(settingsLib, "getDefaultRoot").mockResolvedValue("~/git/work");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === "settings:lastPromptMode") return "implement";
      return null;
    });
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    // Clear any simulated DB overrides
    for (const key in templateOverrides) {
      delete templateOverrides[key as PromptMode];
    }
  });
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
        // Ensure we are comparing against the body from the correctly mocked templateMap
        // This assertion remains correct as templates.templateMap points to the mock.
      ).toHaveValue((templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>).implement.body);
    });
  });

  test("selecting a different mode updates the textarea content from templateMap.body", async () => {
    renderSettingsPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole("textbox", {
          name: /Template for "Implement Changes" mode/i,
        })[0],
        // This assertion remains correct.
      ).toHaveValue((templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>).implement.body);
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
        // This assertion remains correct.
      ).toHaveValue((templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>).review.body);
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
        // This assertion remains correct.
      ).toHaveValue((templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>).implement.body);
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
        // This assertion remains correct.
        expect(screen.getAllByRole("textbox", {name: /Template for "Review Code" mode/i})[0]).toHaveValue((templates.templateMap as Record<PromptMode, { body: string, meta: unknown }>).review.body);
    });
    fireEvent.change(modeSelect, { target: { value: "implement" } });
    await waitFor(() => {
        expect(screen.getAllByRole("textbox", {name: /Template for "Implement Changes" mode/i})[0]).toHaveValue(newText); // Should load the "saved" version
    });
  });
});
