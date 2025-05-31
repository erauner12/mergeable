import { db } from "./db";

export async function getDefaultRoot(): Promise<string> {
  const setting = await db.settings.get("defaultCloneRoot");
  return setting?.value ?? "~/git/work";
}

export async function setDefaultRoot(rootPath: string): Promise<void> {
  await db.settings.put({ key: "defaultCloneRoot", value: rootPath });
}
