import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { runScript } from "./client.js";
import { ensureConfigDir } from "../lib/config.js";
import { log } from "../lib/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function migrate(silent = false): void {
  ensureConfigDir();
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  runScript(schema);
  if (!silent) log.success("Database schema initialized");
}
