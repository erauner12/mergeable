import { db } from "./db"; // Assumed import for Dexie instance
import type { PromptMode } from "./repoprompt"; // Import PromptMode

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

// Default prompt texts for different modes
const defaultPromptTemplates: Record<PromptMode, string> = {
  implement:
    "### TASK\nReview the following pull-request diff and propose improvements.",
  review:
    "### TASK\nYou are reviewing the following pull-request diff and associated comments. Please provide constructive feedback, identify potential issues, and suggest improvements. Focus on clarity, correctness, performance, and adherence to coding standards.",
  "adjust-pr":
    "### TASK\nThe PR title and/or body may be stale or incomplete. Based on the provided context (PR details, diffs), draft an improved PR title and body. The title should be concise and follow conventional commit guidelines if applicable. The body should clearly explain the purpose of the changes, how they were implemented, and any relevant context for reviewers.",
  respond:
    "### TASK\nDraft a reply to the following comment thread(s). Address the questions or concerns raised, provide clarifications, or discuss the proposed changes. Be clear, concise, and constructive.",
};

export async function getBasePrompt(): Promise<string> {
  const row = await db.settings.get("basePromptTemplate"); // This is legacy, effectively for "implement"
  return row?.value ?? defaultPromptTemplates.implement;
}

export async function setBasePrompt(text: string): Promise<void> {
  await db.settings.put({
    key: "basePromptTemplate", // This is legacy, effectively for "implement"
    value: text,
  } as SettingsEntry<string>);
}

export async function getPromptTemplate(mode: PromptMode): Promise<string> {
  if (mode === "implement") {
    // For "implement", try the new key first, then fall back to the legacy key, then to default.
    const newKeyRow = await db.settings.get(keyFor("implement"));
    if (newKeyRow?.value !== undefined) return newKeyRow.value;
    return getBasePrompt(); // Fallback to legacy or its default
  }
  const row = await db.settings.get(keyFor(mode));
  return (row?.value as string) ?? defaultPromptTemplates[mode];
}

export async function setPromptTemplate(
  mode: PromptMode,
  text: string,
): Promise<void> {
  if (mode === "implement") {
    // For "implement", update both new and legacy keys to keep them in sync during transition
    // or if other parts of the app still use getBasePrompt/setBasePrompt directly.
    // Primarily, we'll use the new key.
    await db.settings.put({
      key: keyFor("implement"),
      value: text,
    } as SettingsEntry<string>);
    // Optionally, update the old key too, or decide to fully migrate.
    // For now, let's ensure new key is primary for "implement".
    // await setBasePrompt(text); // This might be redundant if getBasePrompt also checks new key.
    // Let's simplify: "implement" mode uses its specific key. getBasePrompt is now a legacy fallback.
  }
  await db.settings.put({
    key: keyFor(mode),
    value: text,
  } as SettingsEntry<string>);
}
