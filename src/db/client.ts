import { execSync, spawnSync } from "child_process";
import { getDbPath } from "../lib/config.js";
import { getDriver } from "./dialect.js";

// ============================================================================
// Storage backend abstraction — SQLite (default) or MySQL.
// The public API is async (MySQL is inherently async; SQLite resolves immediately).
// ============================================================================

interface Store {
  query(sql: string): Promise<string>;
  queryJson<T>(sql: string): Promise<T[]>;
  execute(sql: string): Promise<void>;
}

let cachedBackend: Store | null = null;

/** Pipe-join row values into the simple text format the CLI's non-JSON output expects. */
function formatRows(rows: unknown[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((row) =>
      Object.values(row as Record<string, unknown>)
        .map((v) => (v === null || v === undefined ? "" : String(v)))
        .join("|")
    )
    .join("\n");
}

async function makeSqliteBackend(): Promise<Store> {
  // Node's built-in SQLite (Node 22.5+).
  try {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(getDbPath());
    return {
      async query(sql) {
        return formatRows(db.prepare(sql).all() as unknown[]);
      },
      async queryJson<T>(sql: string) {
        return db.prepare(sql).all() as T[];
      },
      async execute(sql) {
        db.exec(sql);
      },
    };
  } catch {
    // fall through to the sqlite3 CLI
  }

  try {
    execSync("sqlite3 --version", { stdio: "ignore" });
    return {
      async query(sql) {
        return execSync(`sqlite3 "${getDbPath()}" "${sql.replace(/"/g, '\\"')}"`, {
          encoding: "utf-8",
        });
      },
      async queryJson<T>(sql: string) {
        const out = execSync(`sqlite3 -json "${getDbPath()}" "${sql.replace(/"/g, '\\"')}"`, {
          encoding: "utf-8",
        });
        return out.trim() ? (JSON.parse(out) as T[]) : [];
      },
      async execute(sql) {
        const r = spawnSync("sqlite3", [getDbPath()], { input: sql, encoding: "utf-8" });
        if (r.error) throw r.error;
        if (r.status !== 0) throw new Error(`SQLite error: ${r.stderr}`);
      },
    };
  } catch {
    throw new Error(
      "SQLite is not available. Use Node.js 22.5+ (built-in SQLite) or install the sqlite3 CLI."
    );
  }
}

function mysqlConfig(): Record<string, unknown> {
  const url = process.env.COACH_DB_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      multipleStatements: true,
    };
  }
  return {
    host: process.env.COACH_DB_HOST || "127.0.0.1",
    port: Number(process.env.COACH_DB_PORT || 3306),
    user: process.env.COACH_DB_USER || "root",
    password: process.env.COACH_DB_PASSWORD || "",
    database: process.env.COACH_DB_NAME || "coach",
    multipleStatements: true, // runScript runs the whole schema in one go
  };
}

async function makeMysqlBackend(): Promise<Store> {
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(mysqlConfig());
  // Match SQLite's string handling: only '' escapes a quote; backslashes are literal
  // (so JSON blobs like garmin_raw store verbatim through our esc() helper).
  await conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')");
  return {
    async query(sql) {
      const [rows] = await conn.query(sql);
      return formatRows(rows as unknown[]);
    },
    async queryJson<T>(sql: string) {
      const [rows] = await conn.query(sql);
      return rows as T[];
    },
    async execute(sql) {
      await conn.query(sql);
    },
  };
}

/** Initialize the storage backend. Must be called (awaited) before other functions. */
export async function initDatabase(): Promise<void> {
  if (!cachedBackend) {
    cachedBackend = getDriver() === "mysql" ? await makeMysqlBackend() : await makeSqliteBackend();
  }
}

function getBackend(): Store {
  if (!cachedBackend) throw new Error("Database not initialized. Call initDatabase() first.");
  return cachedBackend;
}

// ============================================================================
// Public API (async)
// ============================================================================

export function query(sql: string): Promise<string> {
  return getBackend().query(sql);
}

export function queryJson<T>(sql: string): Promise<T[]> {
  return getBackend().queryJson<T>(sql);
}

export function execute(sql: string): Promise<void> {
  return getBackend().execute(sql);
}

export function runScript(script: string): Promise<void> {
  return execute(script);
}
