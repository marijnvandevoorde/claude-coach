/**
 * MCP tool dispatch: the tool list (TOOLS + job_status) and one call. Plain tools
 * exec the CLI and answer inline; job tools (ToolDef.job) start a background job,
 * wait up to `inlineWaitMs` for it and otherwise return its id for job_status.
 * Kept free of the HTTP server so it can be tested directly.
 */
import type { JobRow } from "../db/jobs.js";
import { JobRunner } from "./jobs.js";
import { runCli } from "./runCli.js";
import { TOOLS, type Args, type ToolDef } from "./tools.js";

export interface ToolCallContext {
  /** The signed-in user (OAuth email), or "default" without OAuth. */
  user: string;
  runner: JobRunner;
  cli: string;
  /** Cap for an inline (non-job) tool. */
  toolTimeoutMs: number;
  /** Cap for a background job. */
  jobTimeoutMs: number;
  /** How long a job tool waits before answering with the job id. */
  inlineWaitMs: number;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

export const JOB_STATUS_TOOL = {
  description:
    "Status of a background job started by a long-running tool (backfill, schedule_workouts, upload_route, garmin_refresh). Pass the jobId those tools returned. Returns status ('running' | 'succeeded' | 'failed'), the latest progress line, elapsed time, and — once finished — the tool's result or error. While it is running, call again in 15-30 s. Omit jobId to list your recent jobs." +
    " A job interrupted by a server restart is reported as failed; start it again.",
  inputSchema: {
    type: "object" as const,
    properties: {
      jobId: { type: "string", description: "the jobId returned by the long-running tool" },
    },
  },
};

export function listTools(): Array<{
  name: string;
  description: string;
  inputSchema: ToolDef["inputSchema"];
}> {
  return [
    ...Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    { name: "job_status", ...JOB_STATUS_TOOL },
  ];
}

function text(t: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: t || "(no output)" }], isError };
}

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** A job as the client sees it. The result is parsed when it is JSON. */
export function describeJob(j: JobRow, now = Date.now()): Record<string, unknown> {
  const out: Record<string, unknown> = {
    jobId: j.id,
    tool: j.tool,
    status: j.status,
    started: j.summary,
    startedAt: iso(j.created_at),
    elapsedSeconds: Math.round(((j.finished_at ?? now) - j.created_at) / 1000),
  };
  if (j.progress) out.progress = j.progress;
  if (j.finished_at != null) out.finishedAt = iso(j.finished_at);
  if (j.status === "succeeded") {
    const raw = j.result ?? "";
    try {
      out.result = JSON.parse(raw);
    } catch {
      out.result = raw;
    }
  }
  if (j.status === "failed") out.error = j.error;
  if (j.status === "running")
    out.next = `Still running. Call job_status with {"jobId":"${j.id}"} again in 15-30 s.`;
  return out;
}

async function jobStatus(args: Args, ctx: ToolCallContext): Promise<ToolResult> {
  if (typeof args.jobId !== "string" || !args.jobId) {
    const jobs = await ctx.runner.list(ctx.user);
    return text(JSON.stringify({ jobs: jobs.map((j) => describeJob(j)) }, null, 2));
  }
  const job = await ctx.runner.get(args.jobId);
  if (!job || job.user_key !== ctx.user)
    return text(`No job ${args.jobId}. Call job_status without a jobId to list recent jobs.`, true);
  return text(JSON.stringify(describeJob(job), null, 2));
}

async function startJob(
  name: string,
  def: ToolDef & { job: NonNullable<ToolDef["job"]> },
  args: Args,
  ctx: ToolCallContext
): Promise<ToolResult> {
  const { job, started } = await ctx.runner.start(
    ctx.user,
    def.job.kind,
    name,
    def.job.summary(args),
    (report) =>
      runCli(def.toArgs(args), {
        cli: ctx.cli,
        timeoutMs: ctx.jobTimeoutMs,
        input: def.stdin?.(args),
        env: { COACH_PROGRESS: "1" },
        onLine: report,
      })
  );

  if (!started) {
    return text(
      JSON.stringify(
        {
          ...describeJob(job),
          alreadyRunning: true,
          message: `A ${name} job is already running (${job.summary}); nothing new was started. Poll it with job_status and start again once it has finished if needed.`,
        },
        null,
        2
      )
    );
  }

  const done = await ctx.runner.wait(job.id, ctx.inlineWaitMs);
  if (done) return text(done.text, !done.ok);

  const fresh = (await ctx.runner.get(job.id)) ?? job;
  if (fresh.status !== "running") {
    // Finished on the way here; answer as if inline.
    return fresh.status === "succeeded" ? text(fresh.result ?? "") : text(fresh.error ?? "", true);
  }
  return text(
    JSON.stringify(
      {
        ...describeJob(fresh),
        message: `Started in the background: ${fresh.summary}. It is still running after ${Math.round(ctx.inlineWaitMs / 1000)} s.`,
      },
      null,
      2
    )
  );
}

export async function callTool(
  name: string,
  args: Args,
  ctx: ToolCallContext
): Promise<ToolResult> {
  if (name === "job_status") return jobStatus(args, ctx);
  const def = TOOLS[name];
  if (!def) return text(`Unknown tool: ${name}`, true);
  if (def.job)
    return startJob(name, def as ToolDef & { job: NonNullable<ToolDef["job"]> }, args, ctx);
  const r = await runCli(def.toArgs(args), {
    cli: ctx.cli,
    timeoutMs: ctx.toolTimeoutMs,
    input: def.stdin?.(args),
  });
  return text(r.text, !r.ok);
}
