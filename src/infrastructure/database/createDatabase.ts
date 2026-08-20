import Database from "better-sqlite3";

import { migrateDatabase } from "./migrateDatabase.js";

export function createDatabase(
  filename: string,
): Database.Database {
  const db = new Database(filename);

  db.pragma("foreign_keys = ON");

  migrateDatabase(db);

  return db;
}
