import { db } from "./db"; // Assumed import for Dexie instance
import type { PromptMode } from "./repoprompt"; // Import PromptMode
import { templateMap } from "./templates"; // ADDED: Import templateMap

export interface SettingsEntry<T = unknown> {
  key: string;
  value: T;
}

/**
 * ---------------------------------------------------------------------------
 *  Repo root helpers -- **still used by Settings UI and repoprompt.ts**
 * ---------------------------------------------------------------------------
 */
export async function getDefaultRoot(): Promise<string> {
  const row = await db.settings.get("defaultCloneRoot");
  return row?.value ?? "~/git/work";
}

export async function setDefaultRoot(rootPath: string): Promise<void> {
  await db.settings.put({
    key: "defaultCloneRoot",
    value: rootPath,
  } as SettingsEntry<string>);
}

/**
 * ---------------------------------------------------------------------------
 *  Base-prompt template helpers (new)
 * ---------------------------------------------------------------------------
 */

// Helper to generate storage key for prompt templates
export const keyFor = (mode: PromptMode): string =>
  `basePromptTemplate:${mode}`;

// REMOVED: Default prompt texts for different modes (defaultPromptTemplates object)
// These defaults now live in the .md files and are accessed via templateMap.

export async function getBasePrompt(): Promise<string> {
  // This function is legacy and primarily for "implement" mode's old key.
  // It should return the task-specific part of the implement prompt if found,
  // or the default task-specific part from templateMap.implement.
  // However, the new system expects getPromptTemplate to return the full template.
  // For now, let's have it return the content of templateMap.implement if no legacy DB entry.
  const row = await db.settings.get("basePromptTemplate");
  if (row?.value !== undefined) return row.value as string;
  
  // Extracting the "TASK" part from templateMap.implement is complex here.
  // The refactor implies this function might become less relevant or change its meaning.
  // For now, returning the full implement template from map if legacy not found.
  // This might need adjustment based on how legacy fallback is truly handled.
  // The user's proposal for getPromptTemplate("implement") handles the fallback chain.
  // This function (getBasePrompt) is mostly for testing the legacy key.
  // Let's assume it should return the content of the legacy key or the default "implement" *task*.
  // Since defaultPromptTemplates is removed, we refer to templateMap.implement.
  // This is tricky because templateMap.implement is the *full structure*.
  // For the purpose of testing legacy `setBasePrompt`, we'll keep it simple.
  // The actual default for "implement" mode's content is now within templateMap.implement.
  return row?.value ?? templateMap.implement; // Fallback to full implement template for now.
}

export async function setBasePrompt(text: string): Promise<void> {
  // This sets the legacy key, which is an override for the "implement" mode template.
  await db.settings.put({
    key: "basePromptTemplate",
    value: text,
  } as SettingsEntry<string>);
}

export async function getPromptTemplate(mode: PromptMode): Promise<string> {
  // 1. Try the new key first
  const newKeyRow = await db.settings.get(keyFor(mode));
  if (newKeyRow?.value !== undefined) return newKeyRow.value as string;

  // 2. For "implement" mode, try the legacy key if new key not found
  if (mode === "implement") {
    const legacyKeyRow = await db.settings.get("basePromptTemplate");
    if (legacyKeyRow?.value !== undefined) return legacyKeyRow.value as string;
  }
  
  // 3. Fallback to the default template from the loaded .md file
  return templateMap[mode];
}

export async function setPromptTemplate(
  mode: PromptMode,
  text: string,
): Promise<void> {
  // Save to the new key
  await db.settings.put(
    { key: keyFor(mode), value: text } as SettingsEntry<string>,
  );

  // If "implement" mode, also update the legacy key for synchronization
  if (mode === "implement") {
    await db.settings.put(
      { key: "basePromptTemplate", value: text } as SettingsEntry<string>,
    );
  }
}