import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAKE_CLI = fileURLToPath(new URL("../fixtures/mcp/fake-coach-cli.mjs", import.meta.url));

describe("coach-mcp background jobs", () => {
  let home: string;
  let jobsMod: typeof import("../../src/mcp/jobs.js");
  let db: typeof import("../../src/db/jobs.js");
  let handler: typeof import("../../src/mcp/handler.js");

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "coach-jobs-"));
    process.env.HOME = home;
    const client = await import("../../src/db/client.js");
    const { migrate } = await import("../../src/db/migrate.js");
    jobsMod = await import("../../src/mcp/jobs.js");
    db = await import("../../src/db/jobs.js");
    handler = await import("../../src/mcp/handler.js");
    await client.initDatabase();
    await migrate(true);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  function runner(owner = "test:1") {
    return new jobsMod.JobRunner({ owner, heartbeatMs: 20, staleMs: 60_000, log: () => {} });
  }

  describe("JobRunner", () => {
    it("records a quick job's result and returns it from wait()", async () => {
      const r = runner();
      const { job, started } = await r.start("u1", "quick", "t", "a quick one", async (report) => {
        report("step 1/1");
        return { ok: true, text: '{"done":true}' };
      });
      expect(started).toBe(true);
      expect(await r.wait(job.id, 1000)).toEqual({ ok: true, text: '{"done":true}' });
      await sleep(20);
      const row = await r.get(job.id);
      expect(row?.status).toBe("succeeded");
      expect(row?.result).toBe('{"done":true}');
      expect(row?.progress).toBe("step 1/1");
      expect(row?.finished_at).toBeGreaterThan(0);
    });

    it("keeps a slow job running, heartbeats its progress, then finishes", async () => {
      const r = runner();
      let release!: () => void;
      const gate = new Promise<void>((res) => (release = res));
      const { job } = await r.start("u1", "slow", "t", "slow one", async (report) => {
        report("progress: day 1/2");
        await gate;
        return { ok: true, text: "fine" };
      });
      expect(await r.wait(job.id, 50)).toBeNull();
      await sleep(80);
      const mid = await r.get(job.id);
      expect(mid?.status).toBe("running");
      expect(mid?.progress).toBe("day 1/2");
      release();
      expect(await r.wait(job.id, 1000)).toEqual({ ok: true, text: "fine" });
      expect((await r.get(job.id))?.status).toBe("succeeded");
    });

    it("stores a failure's error", async () => {
      const r = runner();
      const { job } = await r.start("u1", "bad", "t", "bad one", async () => {
        throw new Error("Garmin said no");
      });
      expect(await r.wait(job.id, 1000)).toEqual({ ok: false, text: "Garmin said no" });
      const row = await r.get(job.id);
      expect(row?.status).toBe("failed");
      expect(row?.error).toBe("Garmin said no");
    });

    it("runs one job of a kind per user at a time", async () => {
      const r = runner();
      let release!: () => void;
      const gate = new Promise<void>((res) => (release = res));
      const work = async () => {
        await gate;
        return { ok: true, text: "x" };
      };
      const a = await r.start("u2", "backfill", "backfill", "first", work);
      const b = await r.start("u2", "backfill", "backfill", "second", work);
      const other = await r.start("u3", "backfill", "backfill", "other user", work);
      expect(a.started).toBe(true);
      expect(b.started).toBe(false);
      expect(b.job.id).toBe(a.job.id);
      expect(other.started).toBe(true);
      release();
      await r.wait(a.job.id, 1000);
      await r.wait(other.job.id, 1000);
      // Once it ended, a new one may start.
      const c = await r.start("u2", "backfill", "backfill", "third", async () => ({
        ok: true,
        text: "y",
      }));
      expect(c.started).toBe(true);
      await r.wait(c.job.id, 1000);
    });

    it("marks jobs whose process died (stale heartbeat) as failed, freeing the kind", async () => {
      const old = Date.now() - 10 * 60_000;
      await db.insertJob({
        id: "job_dead",
        user: "u4",
        kind: "backfill",
        tool: "backfill",
        summary: "from a dead pod",
        owner: "gone:1",
        now: old,
      });
      const r = runner();
      expect(await r.sweep()).toBe(1);
      const row = await db.getJob("job_dead");
      expect(row?.status).toBe("failed");
      expect(row?.error).toBe(jobsMod.INTERRUPTED);
      const next = await r.start("u4", "backfill", "backfill", "again", async () => ({
        ok: true,
        text: "ok",
      }));
      expect(next.started).toBe(true);
      await r.wait(next.job.id, 1000);
    });

    it("marks its own running jobs as failed on shutdown", async () => {
      const r = runner("pod-a:7");
      const { job } = await r.start("u5", "slow", "t", "cut short", () => new Promise(() => {}));
      expect(await r.shutdown()).toBe(1);
      expect((await db.getJob(job.id))?.status).toBe("failed");
    });

    it("parses a JSON result that follows log lines", async () => {
      const { parseResult } = await import("../../src/mcp/handler.js");
      expect(parseResult('{"a":1}')).toEqual({ result: { a: 1 } });
      expect(parseResult('◐ Backfilling…\n{\n  "a": 1\n}')).toEqual({
        result: { a: 1 },
        log: "◐ Backfilling…",
      });
      expect(parseResult("done, 3 workouts")).toEqual({ result: "done, 3 workouts" });
    });

    it("keeps JSON fragments out of the progress line", () => {
      expect(jobsMod.progressLine("progress: day 2/9")).toBe("day 2/9");
      expect(jobsMod.progressLine("{")).toBeNull();
      expect(jobsMod.progressLine('"activities": 3,')).toBeNull();
      expect(jobsMod.progressLine("Backfilling Garmin 2026-01-01 → 2026-01-31…")).toBe(
        "Backfilling Garmin 2026-01-01 → 2026-01-31…"
      );
    });
  });

  describe("backfill tool through callTool (fake CLI, no Garmin)", () => {
    function ctx(user: string, inlineWaitMs: number) {
      return {
        user,
        runner: runner(),
        cli: FAKE_CLI,
        toolTimeoutMs: 10_000,
        jobTimeoutMs: 10_000,
        inlineWaitMs,
      };
    }
    const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

    it("answers inline when the job finishes within the wait", async () => {
      process.env.FAKE_DELAY_MS = "0";
      const r = await handler.callTool("backfill", { from: "2026-01-01" }, ctx("u6", 5_000));
      expect(r.isError).toBe(false);
      expect(parse(r)).toEqual({ activities: 2, wellnessDays: 3, from: "2026-01-01" });
    });

    it("returns a job id when slow, and job_status reports progress then the result", async () => {
      process.env.FAKE_DELAY_MS = "300";
      const c = ctx("u7", 100);
      const first = await handler.callTool("backfill", { from: "2026-02-01", full: true }, c);
      expect(first.isError).toBe(false);
      const started = parse(first);
      expect(started.status).toBe("running");
      expect(started.jobId).toMatch(/^job_/);
      expect(started.tool).toBe("backfill");
      expect(started.started).toBe("Garmin backfill 2026-02-01 → today (full)");
      expect(started.next).toContain("job_status");

      // A second start while it runs returns the same job.
      const again = parse(await handler.callTool("backfill", { from: "2026-03-01" }, c));
      expect(again.alreadyRunning).toBe(true);
      expect(again.jobId).toBe(started.jobId);

      let status: Record<string, unknown> = {};
      let sawProgress = false;
      for (let i = 0; i < 100; i++) {
        status = parse(await handler.callTool("job_status", { jobId: started.jobId }, c));
        if (typeof status.progress === "string" && status.progress.startsWith("wellness day"))
          sawProgress = true;
        if (status.status !== "running") break;
        await sleep(50);
      }
      expect(sawProgress).toBe(true);
      expect(status.status).toBe("succeeded");
      expect(status.result).toEqual({ activities: 2, wellnessDays: 3, from: "2026-02-01" });

      // Listed among the user's jobs, not another user's.
      const mine = parse(await handler.callTool("job_status", {}, c));
      expect(mine.jobs.map((j: { jobId: string }) => j.jobId)).toContain(started.jobId);
      const theirs = await handler.callTool("job_status", { jobId: started.jobId }, ctx("x", 0));
      expect(theirs.isError).toBe(true);
    });

    it("reports a failed job's error without progress noise", async () => {
      process.env.FAKE_DELAY_MS = "0";
      const r = await handler.callTool("backfill", { from: "fail" }, ctx("u8", 5_000));
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe("garmin-backfill: Garmin said 401");
    });

    it("lists job_status among the tools and tells job tools' clients to poll", () => {
      const tools = handler.listTools();
      expect(tools.map((t) => t.name)).toContain("job_status");
      for (const name of ["backfill", "schedule_workouts", "upload_route", "garmin_refresh"]) {
        expect(tools.find((t) => t.name === name)?.description).toContain("job_status");
      }
    });

    it("runs plain tools inline", async () => {
      const r = await handler.callTool("wellness", {}, ctx("u9", 0));
      expect(r).toEqual({ content: [{ type: "text", text: '{"water":1200}' }], isError: false });
    });
  });
});
