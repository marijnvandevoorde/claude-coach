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
  ensureColumn("reminder_prefs", "hydration_per_active_hour_ml", "INTEGER DEFAULT 500");
  ensureColumn("wellness_state", "training_minutes", "INTEGER");
  // Raw inputs for the from-scratch readiness model.
  ensureColumn("wellness_state", "hrv_weekly_avg", "REAL");
  ensureColumn("wellness_state", "hrv_baseline_low", "INTEGER");
  ensureColumn("wellness_state", "hrv_baseline_upper", "INTEGER");
  ensureColumn("wellness_state", "avg_stress", "INTEGER");
  ensureColumn("wellness_state", "acwr", "REAL");
  ensureColumn("wellness_state", "acute_load", "INTEGER");
  ensureColumn("wellness_state", "chronic_load", "INTEGER");

  if (!silent) log.success("Database schema initialized");
}
