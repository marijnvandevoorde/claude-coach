/**
 * Job runner for long-running MCP tools. A request through Cloudflare is cut after
 * 100 s, so a slow tool runs as a background job: it is recorded in the `jobs`
 * table, keeps a heartbeat + the latest progress line there while it runs, and
 * stores its result or error when it ends. The caller may wait a little for it
 * (short calls still answer inline) and otherwise hands the job id to the client,
 * which polls `job_status`.
 */
import { randomBytes } from "node:crypto";
import {
  type JobRow,
  failInterruptedJobs,
  finishJob,
  getJob,
  heartbeatJob,
  insertJob,
  listJobs,
  runningJob,
} from "../db/jobs.js";
import type { CliResult } from "./runCli.js";

/** The work of a job; `report` records a progress line. */
export type JobWork = (report: (progress: string) => void) => Promise<CliResult>;

export interface JobRunnerOpts {
  /** Identifies this process (pod name + pid); its jobs are failed on shutdown. */
  owner: string;
  /** How often a running job writes its heartbeat + progress. */
  heartbeatMs?: number;
  /** A running job whose heartbeat is older than this is considered dead. */
  staleMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface StartResult {
  job: JobRow;
  /** False when a job of the same kind was already running for this user. */
  started: boolean;
}

export const INTERRUPTED =
  "interrupted: the coach server restarted while this job ran. Start it again.";

export function newJobId(): string {
  return `job_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

/** Lines from a CLI run worth showing as progress (not fragments of its JSON output). */
export function progressLine(line: string): string | null {
  const m = /^progress:\s*(.+)$/i.exec(line);
  if (m) return m[1];
  if (/^[{}[\]"]/.test(line) || /[,{[]$/.test(line)) return null;
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

export class JobRunner {
  private readonly owner: string;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly live = new Map<string, Promise<CliResult>>();

  constructor(opts: JobRunnerOpts) {
    this.owner = opts.owner;
    this.heartbeatMs = opts.heartbeatMs ?? 5_000;
    this.staleMs = opts.staleMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.error(m));
  }

  /** Fail running jobs whose process is gone (stale heartbeat). Run at startup and lazily. */
  async sweep(): Promise<number> {
    const now = this.now();
    return failInterruptedJobs({ staleBefore: now - this.staleMs, reason: INTERRUPTED }, now);
  }

  /** Fail this process's running jobs (it is shutting down). */
  async shutdown(): Promise<number> {
    return failInterruptedJobs({ owner: this.owner, reason: INTERRUPTED }, this.now());
  }

  /**
   * Start `work` as a job, unless a job of `kind` is already running for `user`
   * (then that job is returned with started=false).
   */
  async start(
    user: string,
    kind: string,
    tool: string,
    summary: string,
    work: JobWork,
    attempt = 0
  ): Promise<StartResult> {
    await this.sweep();
    const id = newJobId();
    const inserted = await insertJob({
      id,
      user,
      kind,
      tool,
      summary,
      owner: this.owner,
      now: this.now(),
    });
    if (!inserted) {
      const existing = await runningJob(user, kind);
      if (existing) return { job: existing, started: false };
      // It finished between the insert and the lookup: try once more.
      if (attempt > 0) throw new Error(`could not start a ${kind} job`);
      return this.start(user, kind, tool, summary, work, attempt + 1);
    }

    let latest: string | null = null;
    let dirty = false;
    const report = (line: string) => {
      const p = progressLine(line);
      if (p != null) {
        latest = p;
        dirty = true;
      }
    };
    const timer = setInterval(() => {
      const p = dirty ? latest : null;
      dirty = false;
      heartbeatJob(id, p, this.now()).catch((e) =>
        this.log(`job ${id}: heartbeat failed: ${String(e)}`)
      );
    }, this.heartbeatMs);
    timer.unref?.();

    const done = (async (): Promise<CliResult> => {
      let r: CliResult;
      try {
        r = await work(report);
      } catch (e) {
        r = { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
      clearInterval(timer);
      try {
        await finishJob(id, { ...r, progress: latest }, this.now());
      } catch (e) {
        this.log(`job ${id}: could not store its result: ${String(e)}`);
      }
      this.live.delete(id);
      return r;
    })();
    this.live.set(id, done);

    const job = (await getJob(id)) as JobRow;
    return { job, started: true };
  }

  /** Wait up to `ms` for a job of this process; its result, or null if still running. */
  async wait(id: string, ms: number): Promise<CliResult | null> {
    const p = this.live.get(id);
    if (!p) {
      // Not running here: it may have finished already.
      const j = await getJob(id);
      if (!j || j.status === "running") return null;
      const ok = j.status === "succeeded";
      return { ok, text: (ok ? j.result : j.error) ?? "" };
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((r) => {
      t = setTimeout(() => r(null), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  async get(id: string): Promise<JobRow | null> {
    await this.sweep();
    return getJob(id);
  }

  async list(user: string, limit = 10): Promise<JobRow[]> {
    await this.sweep();
    return listJobs(user, limit);
  }

  /** Number of jobs this process is running (for tests and shutdown). */
  get running(): number {
    return this.live.size;
  }
}
