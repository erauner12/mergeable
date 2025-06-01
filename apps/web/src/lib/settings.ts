import { db } from "./db"; // Assumed import for Dexie instance

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
export async function getBasePrompt(): Promise<string> {
  const row = await db.settings.get("basePromptTemplate");
  return (
    row?.value ??
    "### TASK\nReview the following pull-request diff and propose improvements."
  );
}

export async function setBasePrompt(text: string): Promise<void> {
  await db.settings.put({
    key: "basePromptTemplate",
    value: text,
  } as SettingsEntry<string>);
}