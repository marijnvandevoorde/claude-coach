/**
 * Free-text journal entries — the athlete's own words ("legs felt heavy",
 * "great session", "stressful work week"). Complements the structured
 * mood/energy/soreness `log`. Read back for a weekly summary.
 */
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";
import { localDate } from "./wellness.js";

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export interface JournalEntry {
  id: number;
  local_date: string | null;
  entry: string;
  tag: string | null;
  created_at: string | null;
}

export async function addJournalEntry(
  entry: string,
  opts: { date?: string; tag?: string } = {}
): Promise<void> {
  const d = localDate(opts.date);
  await execute(
    `INSERT INTO journal (local_date, entry, tag, created_at)
     VALUES (${esc(d)}, ${esc(entry)}, ${esc(opts.tag ?? null)}, ${getDialect().now()});`
  );
}

export async function listJournalEntries(
  opts: { since?: string; until?: string; limit?: number } = {}
): Promise<JournalEntry[]> {
  const where: string[] = [];
  if (opts.since) where.push(`local_date >= ${esc(opts.since)}`);
  if (opts.until) where.push(`local_date <= ${esc(opts.until)}`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = opts.limit && opts.limit > 0 ? Math.round(opts.limit) : 200;
  return queryJson<JournalEntry>(
    `SELECT id, local_date, entry, tag, created_at FROM journal
     ${clause} ORDER BY local_date DESC, id DESC LIMIT ${limit};`
  );
}
