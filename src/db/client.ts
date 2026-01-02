import { execSync, spawnSync } from "child_process";
import { getDbPath } from "../lib/config.js";

export function query(sql: string): string {
  const dbPath = getDbPath();
  try {
    return execSync(`sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
    });
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new Error(`SQLite error: ${err.stderr || err.message}`);
  }
}

export function queryJson<T>(sql: string): T[] {
  const dbPath = getDbPath();
  try {
    const result = execSync(`sqlite3 -json "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
    });
    if (!result.trim()) return [];
    return JSON.parse(result);
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new Error(`SQLite error: ${err.stderr || err.message}`);
  }
}

export function execute(sql: string): void {
  const dbPath = getDbPath();
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf-8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`SQLite error: ${result.stderr}`);
  }
}

export function runScript(script: string): void {
  execute(script);
}
