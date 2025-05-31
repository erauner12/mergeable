import Dexie, { type EntityTable } from "dexie";
import type { Connection, Section, Star } from "./types";

// Define the Settings interface for the new table
interface Settings {
  key: string; // Primary key
  value: string;
}

// Restore the original db instance and type assertion
export const db = new Dexie("webapp") as Dexie & {
  connections: EntityTable<Connection, "id">; // Assuming 'id' is the type of the primary key in Connection
  sections: EntityTable<Section, "id">; // Assuming 'id' is the type of the primary key in Section
  stars: EntityTable<Star, "uid">; // Assuming 'uid' is the type of the primary key in Star
  settings: EntityTable<Settings, "key">; // Add the new settings table
};

// Restore original version 1 schema
db.version(1).stores({
  connections: "++id", // Original: auto-incrementing primary key
  sections: "++id, position", // Original: auto-incrementing primary key, indexed position
  stars: "uid", // Original: primary key
});

// Add version 2 for the new 'settings' table
db.version(2).stores({
  settings: "&key,value", // '&key' means primary key 'key', 'value' is an indexed field
  // Dexie automatically carries forward stores (connections, sections, stars) from version 1.
});

// If you have more versions, chain them here. For example:
// db.version(3).stores({ ... });
