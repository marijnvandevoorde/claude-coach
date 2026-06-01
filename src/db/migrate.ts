import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execute, runScript } from "./client.js";
import { ensureConfigDir } from "../lib/config.js";
import { log } from "../lib/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Additive column migration for tables that pre-date a column.
 * `ALTER TABLE ... ADD COLUMN` is not idempotent, so we ignore the
 * "duplicate column" error when the column already exists.
 */
function ensureColumn(table: string, column: string, definition: string): void {
  try {
    execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  } catch {
    // Column already exists — nothing to do.
  }
}

export function migrate(silent = false): void {
  ensureConfigDir();
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  runScript(schema);

  // Additive migrations for databases created before these columns existed
  // (CREATE TABLE IF NOT EXISTS won't alter an existing table).
  ensureColumn("reminder_prefs", "notify_channel", "TEXT DEFAULT 'auto'");
  ensureColumn("reminder_prefs", "notify_webhook_url", "TEXT");

  if (!silent) log.success("Database schema initialized");
}
