/**
 * SQL dialect shim so the same data layer runs on SQLite (default) and MySQL.
 * Picks the driver from COACH_DB_DRIVER (default "sqlite"). Keeps the handful of
 * non-portable constructs (current-timestamp, upsert, insert-or-replace, schema
 * file) in one place so the db modules stay dialect-agnostic.
 */
export type DbDriver = "sqlite" | "mysql";

export function getDriver(): DbDriver {
  return (process.env.COACH_DB_DRIVER || "").toLowerCase() === "mysql" ? "mysql" : "sqlite";
}

export interface Dialect {
  driver: DbDriver;
  /** SQL expression for "now" (UTC-ish), e.g. datetime('now') / UTC_TIMESTAMP(). */
  now(): string;
  /** Schema file name to load for this driver (relative to src/db). */
  schemaFile(): string;
  /**
   * Build an upsert. `valuesSql` is the already-escaped `(v1, v2, ...)` tuple.
   * On conflict with `conflictCol`, the `updateCols` are overwritten with the new values.
   */
  upsert(
    table: string,
    insertCols: string[],
    valuesSql: string,
    conflictCol: string,
    updateCols: string[]
  ): string;
  /** INSERT-or-replace verb: "INSERT OR REPLACE" (sqlite) / "REPLACE" (mysql). */
  replaceVerb(): string;
  /** INSERT-ignore verb: "INSERT OR IGNORE" (sqlite) / "INSERT IGNORE" (mysql). */
  insertIgnoreVerb(): string;
}

const sqlite: Dialect = {
  driver: "sqlite",
  now: () => "datetime('now')",
  schemaFile: () => "schema.sql",
  upsert(table, insertCols, valuesSql, conflictCol, updateCols) {
    const set = updateCols.map((c) => `${c} = excluded.${c}`).join(", ");
    return (
      `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES ${valuesSql} ` +
      `ON CONFLICT(${conflictCol}) DO UPDATE SET ${set};`
    );
  },
  replaceVerb: () => "INSERT OR REPLACE",
  insertIgnoreVerb: () => "INSERT OR IGNORE",
};

const mysql: Dialect = {
  driver: "mysql",
  now: () => "UTC_TIMESTAMP()",
  schemaFile: () => "schema.mysql.sql",
  upsert(table, insertCols, valuesSql, _conflictCol, updateCols) {
    // MySQL upserts on the table's unique/primary key — no conflict target needed.
    const set = updateCols.map((c) => `${c} = VALUES(${c})`).join(", ");
    return (
      `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES ${valuesSql} ` +
      `ON DUPLICATE KEY UPDATE ${set};`
    );
  },
  replaceVerb: () => "REPLACE",
  insertIgnoreVerb: () => "INSERT IGNORE",
};

export function getDialect(driver: DbDriver = getDriver()): Dialect {
  return driver === "mysql" ? mysql : sqlite;
}
