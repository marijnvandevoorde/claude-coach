/**
 * Background jobs for long-running MCP tools (backfill, Garmin push, route upload,
 * a big Garmin fetch). Requests through Cloudflare are cut after 100 s, so such a
 * tool starts a job and returns its id; `job_status` reads the row back.
 *
 * One row per job. `active_key` (user|kind) is set while the job runs and cleared
 * when it ends; its UNIQUE index makes "one running job of a kind per user" atomic.
 * A running job writes `heartbeat_at` every few seconds, so a job whose process
 * died (pod restart, crash) is recognised by its stale heartbeat and marked failed.
 */
import { execute, queryJson } from "./client.js";

export type JobStatus = "running" | "succeeded" | "failed";

export interface JobRow {
  id: string;
  user_key: string;
  kind: string;
  tool: string;
  summary: string | null;
  status: JobStatus;
  progress: string | null;
  result: string | null;
  error: string | null;
  owner: string | null;
  created_at: number;
  heartbeat_at: number;
  finished_at: number | null;
}

/** Stored result/error text is capped so one huge output can't bloat the table. */
export const MAX_STORED = 1_000_000;

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function cap(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.length > MAX_STORED ? `${text.slice(0, MAX_STORED)}\n…(truncated)` : text;
}

function num(v: unknown): number {
  return Number(v);
}

function normalize(r: JobRow): JobRow {
  return {
    ...r,
    created_at: num(r.created_at),
    heartbeat_at: num(r.heartbeat_at),
    finished_at: r.finished_at == null ? null : num(r.finished_at),
  };
}

const COLS =
  "id, user_key, kind, tool, summary, status, progress, result, error, owner, created_at, heartbeat_at, finished_at";

/** True for a unique-key violation on either backend. */
function isDuplicate(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err?.code === "ER_DUP_ENTRY" ||
    /UNIQUE constraint failed|Duplicate entry/i.test(err?.message ?? String(e))
  );
}

/**
 * Insert a running job. Returns false (and inserts nothing) when a job of the
 * same kind is already running for this user.
 */
export async function insertJob(j: {
  id: string;
  user: string;
  kind: string;
  tool: string;
  summary: string;
  owner: string;
  now: number;
}): Promise<boolean> {
  try {
    await execute(
      `INSERT INTO jobs (id, user_key, kind, tool, summary, status, active_key, owner, created_at, heartbeat_at)
       VALUES (${esc(j.id)}, ${esc(j.user)}, ${esc(j.kind)}, ${esc(j.tool)}, ${esc(j.summary)},
               'running', ${esc(`${j.user}|${j.kind}`)}, ${esc(j.owner)}, ${j.now}, ${j.now});`
    );
    return true;
  } catch (e) {
    if (isDuplicate(e)) return false;
    throw e;
  }
}

export async function heartbeatJob(
  id: string,
  progress: string | null,
  now: number
): Promise<void> {
  await execute(
    `UPDATE jobs SET heartbeat_at = ${now}${progress != null ? `, progress = ${esc(progress.slice(0, 1000))}` : ""}
     WHERE id = ${esc(id)} AND status = 'running';`
  );
}

export async function finishJob(
  id: string,
  outcome: { ok: boolean; text: string; progress?: string | null },
  now: number
): Promise<void> {
  const status: JobStatus = outcome.ok ? "succeeded" : "failed";
  await execute(
    `UPDATE jobs SET status = '${status}', active_key = NULL, finished_at = ${now}, heartbeat_at = ${now},
       ${outcome.ok ? "result" : "error"} = ${esc(cap(outcome.text))}
       ${outcome.progress != null ? `, progress = ${esc(outcome.progress.slice(0, 1000))}` : ""}
     WHERE id = ${esc(id)} AND status = 'running';`
  );
}

export async function getJob(id: string): Promise<JobRow | null> {
  const rows = await queryJson<JobRow>(`SELECT ${COLS} FROM jobs WHERE id = ${esc(id)} LIMIT 1;`);
  return rows[0] ? normalize(rows[0]) : null;
}

export async function runningJob(user: string, kind: string): Promise<JobRow | null> {
  const rows = await queryJson<JobRow>(
    `SELECT ${COLS} FROM jobs WHERE active_key = ${esc(`${user}|${kind}`)} LIMIT 1;`
  );
  return rows[0] ? normalize(rows[0]) : null;
}

export async function listJobs(user: string, limit = 10): Promise<JobRow[]> {
  const rows = await queryJson<JobRow>(
    `SELECT ${COLS} FROM jobs WHERE user_key = ${esc(user)}
     ORDER BY created_at DESC LIMIT ${Math.max(1, Math.round(limit))};`
  );
  return rows.map(normalize);
}

/**
 * Mark running jobs as failed: those whose heartbeat is older than `staleBefore`
 * (their process died), or — with `owner` — every running job of that process
 * (it is shutting down). Returns how many were marked.
 */
export async function failInterruptedJobs(
  opts: { staleBefore?: number; owner?: string; reason: string },
  now: number
): Promise<number> {
  const where: string[] = [];
  if (opts.staleBefore != null) where.push(`heartbeat_at < ${opts.staleBefore}`);
  if (opts.owner != null) where.push(`owner = ${esc(opts.owner)}`);
  if (where.length === 0) return 0;
  const cond = `status = 'running' AND (${where.join(" OR ")})`;
  const rows = await queryJson<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE ${cond};`);
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) {
    await execute(
      `UPDATE jobs SET status = 'failed', active_key = NULL, finished_at = ${now},
         error = ${esc(opts.reason)} WHERE ${cond};`
    );
  }
  return n;
}
