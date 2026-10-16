/**
 * Run the coach CLI as an ASYNC child process. Critically, this does NOT block the
 * Node event loop — `/health` and other tool calls stay responsive while a slow
 * tool (a big backfill, a slow Garmin fetch) runs. Resolves to the captured output.
 */
import { spawn } from "node:child_process";

export interface CliResult {
  ok: boolean;
  text: string;
}

export interface RunCliOpts {
  cli: string;
  /** Wall-clock cap; the child is killed after it. */
  timeoutMs: number;
  /** Cap on stdout. */
  maxOutput?: number;
  input?: string;
  /** Extra environment for the child. */
  env?: Record<string, string>;
  /** Called with each complete output line (stdout and stderr), e.g. for progress. */
  onLine?: (line: string) => void;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function runCli(args: string[], opts: RunCliOpts): Promise<CliResult> {
  const maxOutput = opts.maxOutput ?? 16 * 1024 * 1024;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [opts.cli, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let over = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    // Split both streams into lines for the progress callback.
    const pending = { out: "", err: "" };
    const feed = (which: "out" | "err", chunk: string) => {
      if (!opts.onLine) return;
      const buf = pending[which] + chunk;
      const parts = buf.split(/\r?\n|\r/);
      pending[which] = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.replace(ANSI, "").trim();
        if (line) opts.onLine(line);
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      feed("out", s);
      if (stdout.length > maxOutput && !over) {
        over = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      feed("err", s);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        return resolve({ ok: false, text: `tool timed out after ${opts.timeoutMs / 1000}s` });
      if (over) return resolve({ ok: false, text: "tool output exceeded 16 MB; aborted" });
      // Progress lines are for job_status, not part of an error message.
      const errText = stderr
        .split("\n")
        .filter((l) => !/^progress:/i.test(l))
        .join("\n")
        .trim();
      if (code !== 0)
        return resolve({ ok: false, text: (errText || stdout || `exit ${code}`).trim() });
      resolve({ ok: true, text: stdout.trim() });
    });

    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
