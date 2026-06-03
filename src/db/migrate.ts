import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execute, runScript } from "./client.js";
import { getDialect } from "./dialect.js";
import { ensureConfigDir } from "../lib/config.js";
import { log } from "../lib/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Additive column migration for SQLite databases that pre-date a column.
 * `ALTER TABLE ... ADD COLUMN` is not idempotent, so we ignore the
 * "duplicate column" error when the column already exists. (Fresh MySQL
 * databases get the complete schema, so these ALTERs aren't run there.)
 */
async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  try {
    await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  } catch {
    // Column already exists — nothing to do.
  }
}

export async function migrate(silent = false): Promise<void> {
  ensureConfigDir();
  const dialect = getDialect();
  const schemaPath = join(__dirname, dialect.schemaFile());
  const schema = readFileSync(schemaPath, "utf-8");
  await runScript(schema);

  if (dialect.driver === "sqlite") {
    await runSqliteColumnMigrations();
  }

  // Additive columns needed on BOTH backends for tables that already exist in prod
  // (CREATE TABLE IF NOT EXISTS won't alter them). ensureColumn ignores "duplicate column".
  await ensureColumn("activities", "gps_track", dialect.driver === "mysql" ? "LONGTEXT" : "TEXT");
  await ensureColumn(
    "activities",
    "activity_streams",
    dialect.driver === "mysql" ? "LONGTEXT" : "TEXT"
  );

  // Single-row shared Garmin OAuth token + lease lock (one row, id=1). Portable
  // across both backends. See src/garmin/client.ts for why it lives in the DB.
  await execute(
    `CREATE TABLE IF NOT EXISTS garmin_oauth (
       id INTEGER PRIMARY KEY,
       access_token TEXT,
       refresh_token TEXT,
       expires_at BIGINT,
       lock_owner TEXT,
       locked_until BIGINT,
       updated_at TEXT
     );`
  );

  if (!silent) log.success("Database schema initialized");
}

async function runSqliteColumnMigrations(): Promise<void> {
  // Additive migrations for databases created before these columns existed
  // (CREATE TABLE IF NOT EXISTS won't alter an existing table).
  const cols: Array<[string, string, string]> = [
    ["reminder_prefs", "notify_channel", "TEXT DEFAULT 'auto'"],
    ["reminder_prefs", "notify_webhook_url", "TEXT"],
    ["reminder_prefs", "hydration_per_active_hour_ml", "INTEGER DEFAULT 500"],
    ["wellness_state", "training_minutes", "INTEGER"],
    // Raw inputs for the from-scratch readiness model.
    ["wellness_state", "hrv_weekly_avg", "REAL"],
    ["wellness_state", "hrv_baseline_low", "INTEGER"],
    ["wellness_state", "hrv_baseline_upper", "INTEGER"],
    ["wellness_state", "avg_stress", "INTEGER"],
    ["wellness_state", "acwr", "REAL"],
    ["wellness_state", "acute_load", "INTEGER"],
    ["wellness_state", "chronic_load", "INTEGER"],
    // Expanded daily Garmin metrics (usersummary + training status) + a raw JSON blob.
    ["wellness_state", "vo2max", "REAL"],
    ["wellness_state", "total_steps", "INTEGER"],
    ["wellness_state", "total_distance_m", "INTEGER"],
    ["wellness_state", "floors_climbed", "INTEGER"],
    ["wellness_state", "intensity_min_moderate", "INTEGER"],
    ["wellness_state", "intensity_min_vigorous", "INTEGER"],
    ["wellness_state", "active_calories", "INTEGER"],
    ["wellness_state", "total_calories", "INTEGER"],
    ["wellness_state", "avg_spo2", "INTEGER"],
    ["wellness_state", "avg_waking_respiration", "INTEGER"],
    ["wellness_state", "rhr_7day_avg", "INTEGER"],
    ["wellness_state", "body_battery_charged", "INTEGER"],
    ["wellness_state", "garmin_raw", "TEXT"],
  ];
  for (const [table, column, def] of cols) await ensureColumn(table, column, def);
}
