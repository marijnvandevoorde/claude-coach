/**
 * coach-mcp — a small HTTP MCP server (Streamable HTTP) that exposes the coach
 * to any Claude client. Each tool execs the existing CLI (`dist/cli.js`) so the
 * MCP reuses the exact, tested logic. Runs as the image's `mcp` mode behind
 * a reverse proxy + Cloudflare Access; an optional bearer (COACH_AUTH_SECRET) is checked too.
 */
import express from "express";
import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { oauthEnabled, oauthRouter, verifyAccessToken, resourceMetadataUrl } from "./oauth.js";

const CLI = process.env.COACH_CLI || "/app/dist/cli.js";
const PORT = Number(process.env.COACH_MCP_PORT || process.env.PORT || 8080);
const MAX_OUTPUT = 16 * 1024 * 1024; // 16 MB cap on a tool's stdout
// Per-tool wall-clock cap. A runaway/very long tool (e.g. a huge backfill) is
// killed rather than tying up a request forever. Override with COACH_MCP_TOOL_TIMEOUT_MS.
const TOOL_TIMEOUT_MS = Number(process.env.COACH_MCP_TOOL_TIMEOUT_MS || 600_000);

/**
 * Run the CLI as an ASYNC child process. Critically, this does NOT block the
 * Node event loop — `/health` and other tool calls stay responsive while a slow
 * tool (a big backfill, a slow Garmin fetch) runs. (The old spawnSync froze the
 * whole server for the child's entire duration.) Resolves to the captured output.
 */
function runCli(args: string[], input?: string): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let over = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TOOL_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT && !over) {
        over = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        return resolve({ ok: false, text: `tool timed out after ${TOOL_TIMEOUT_MS / 1000}s` });
      if (over) return resolve({ ok: false, text: "tool output exceeded 16 MB; aborted" });
      if (code !== 0)
        return resolve({ ok: false, text: (stderr || stdout || `exit ${code}`).trim() });
      resolve({ ok: true, text: stdout.trim() });
    });

    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

type Args = Record<string, unknown>;
interface ToolDef {
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  toArgs: (a: Args) => string[];
  /** Optional: content to pipe to the CLI's stdin (e.g. large file bodies). */
  stdin?: (a: Args) => string | undefined;
}

/** Append `--key=value` for each present key. */
function flags(a: Args, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) if (a[k] !== undefined && a[k] !== null) out.push(`--${k}=${a[k]}`);
  return out;
}

const TOOLS: Record<string, ToolDef> = {
  wellness: {
    description: "Today's hydration + wellness snapshot (water vs goal, sleep, readiness, energy).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
    },
    toArgs: (a) => ["wellness", "--json", ...flags(a, ["date"])],
  },
  log: {
    description:
      "Log a wellness/intake value: water (ml), sleep (hours), energy|soreness|mood (1-5), weight (kg).",
    inputSchema: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: ["water", "sleep", "energy", "soreness", "mood", "weight"] },
        value: { type: "number" },
        date: { type: "string" },
        score: { type: "number", description: "sleep score (optional)" },
        note: { type: "string" },
      },
    },
    toArgs: (a) => ["log", String(a.type), String(a.value), ...flags(a, ["date", "score", "note"])],
  },
  config: {
    description:
      "Show or update reminder preferences. Pass fields to update; omit all to just read.",
    inputSchema: {
      type: "object",
      properties: {
        bedtime: { type: "string", description: "HH:MM" },
        wake: { type: "string", description: "HH:MM" },
        "water-goal": { type: "number" },
        "quiet-start": { type: "string" },
        "quiet-end": { type: "string" },
        cadence: { type: "number" },
        "hydration-per-hour": { type: "number" },
        "notify-webhook": { type: "string" },
        "notify-channel": { type: "string", enum: ["auto", "webhook", "macos", "stdout"] },
        enabled: { type: "boolean", description: "enable/disable reminders" },
      },
    },
    toArgs: (a) => {
      const f = [
        "config",
        "--json",
        ...flags(a, [
          "bedtime",
          "wake",
          "water-goal",
          "quiet-start",
          "quiet-end",
          "cadence",
          "hydration-per-hour",
          "notify-webhook",
          "notify-channel",
        ]),
      ];
      if (a.enabled === true) f.push("--enable");
      if (a.enabled === false) f.push("--disable");
      return f;
    },
  },
  checkin: {
    description:
      "Assemble today's coaching/reminder payload (plan day + Garmin signals + hydration/recovery). Pass Garmin signals you fetched.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "path to a plan JSON file" },
        readiness: { type: "number" },
        "sleep-hours": { type: "number" },
        "sleep-score": { type: "number" },
        "body-battery": { type: "number" },
        "resting-hr": { type: "number" },
        "hrv-status": { type: "string" },
        "training-status": { type: "string" },
        "training-minutes": { type: "number" },
        date: { type: "string" },
      },
    },
    toArgs: (a) => [
      "checkin",
      "--json",
      ...flags(a, [
        "plan",
        "readiness",
        "sleep-hours",
        "sleep-score",
        "body-battery",
        "resting-hr",
        "hrv-status",
        "training-status",
        "training-minutes",
        "date",
      ]),
    ],
  },
  garmin_refresh: {
    description:
      "Pull live data directly FROM Garmin Connect and store it in coach.db: readiness, sleep (+score), HRV (status, weekly avg, baseline + nightly readings), body battery (wake + charged), resting HR (+ 7-day avg), VO2max, daily steps/distance/floors, moderate/vigorous intensity minutes, active/total calories, SpO2, waking respiration, training status + acute/chronic load + ACWR, and recent activities. Also stores a full raw JSON blob (garmin_raw: sleep stages, HRV readings, load focus, heat/altitude acclimation) for deeper reasoning. This is the real 'sync with Garmin' — it fetches on the server using the saved Garmin tokens. (Contrast garmin_sync, which only caches numbers you pass in.)",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
    },
    toArgs: (a) => ["garmin-fetch", "--json", ...flags(a, ["date"])],
  },
  garmin_sync: {
    description:
      "Cache Garmin metrics you ALREADY have (readiness, sleep, HRV, body battery, …) into coach.db. Does NOT contact Garmin — pass the values in. To fetch live from Garmin, use garmin_refresh.",
    inputSchema: {
      type: "object",
      properties: {
        readiness: { type: "number" },
        "sleep-hours": { type: "number" },
        "sleep-score": { type: "number" },
        "body-battery": { type: "number" },
        "resting-hr": { type: "number" },
        "hrv-status": { type: "string" },
        "training-status": { type: "string" },
        "training-minutes": { type: "number" },
        date: { type: "string" },
      },
    },
    toArgs: (a) => [
      "garmin-sync",
      ...flags(a, [
        "readiness",
        "sleep-hours",
        "sleep-score",
        "body-battery",
        "resting-hr",
        "hrv-status",
        "training-status",
        "training-minutes",
        "date",
      ]),
    ],
  },
  export_calendar: {
    description:
      "Turn a training plan JSON into a calendar event list (JSON) for pushing to Google Calendar.",
    inputSchema: {
      type: "object",
      required: ["plan"],
      properties: { plan: { type: "string", description: "path to a plan JSON file" } },
    },
    toArgs: (a) => ["export-calendar", String(a.plan), "--json"],
  },
  export_garmin: {
    description:
      "Turn a training plan JSON into structured Garmin workout records (to create + schedule on the watch).",
    inputSchema: {
      type: "object",
      required: ["plan"],
      properties: { plan: { type: "string" } },
    },
    toArgs: (a) => ["export-garmin", String(a.plan)],
  },
  schedule_workouts: {
    description:
      "Create + schedule a training plan's workouts directly on Garmin Connect (they sync to the athlete's watch). Builds each workout, creates it, and schedules it on its date. Pass dryRun:true to preview the exact workout payloads without pushing anything.",
    inputSchema: {
      type: "object",
      required: ["plan"],
      properties: {
        plan: { type: "string", description: "path to a plan JSON file" },
        dryRun: { type: "boolean", description: "build payloads only; push nothing" },
      },
    },
    toArgs: (a) => {
      const f = ["garmin-push", String(a.plan), "--json"];
      if (a.dryRun === true) f.push("--dry-run");
      return f;
    },
  },
  upload_route: {
    description:
      "Upload a GPX route to Garmin as a course, kept EXACTLY as-is (no point reduction, no snap-to-roads). Pass the GPX either as inline `gpx` content (e.g. a file dropped into the conversation) or as a server-readable `file` path, plus an optional name (defaults to the GPX track name) and course type. dryRun parses + builds the payload without uploading.",
    inputSchema: {
      type: "object",
      properties: {
        gpx: {
          type: "string",
          description: "inline GPX file content (preferred for files in chat)",
        },
        file: {
          type: "string",
          description: "path to a .gpx file readable by the coach server (alternative to gpx)",
        },
        name: { type: "string", description: "course name (defaults to the GPX track name)" },
        type: {
          type: "string",
          description: "course type: run, trail, road, mtb, gravel, cycling, hike, walk",
        },
        dryRun: { type: "boolean", description: "parse + build payload only; upload nothing" },
      },
    },
    toArgs: (a) => {
      // Inline content goes via stdin (--stdin); a path is passed positionally.
      const f =
        typeof a.gpx === "string"
          ? ["garmin-route", "--stdin", "--json", ...flags(a, ["name", "type"])]
          : ["garmin-route", String(a.file), "--json", ...flags(a, ["name", "type"])];
      if (a.dryRun === true) f.push("--dry-run");
      return f;
    },
    stdin: (a) => (typeof a.gpx === "string" ? a.gpx : undefined),
  },
  backfill: {
    description:
      "Backfill historical Garmin data into coach.db over a date range. Default uses the cheap multi-day range endpoints (steps/distance/floors/stress/resting HR/intensity/body-battery/HRV). full=true fetches a per-day COMPLETE snapshot (adds sleep, training load, VO2max, calories, SpO2, respiration, garmin_raw) — heavier but resumable (skips days already backfilled unless force=true). Rate-limited with 429 backoff; safe to run repeatedly / a chunk at a time.",
    inputSchema: {
      type: "object",
      required: ["from"],
      properties: {
        from: { type: "string", description: "start date YYYY-MM-DD" },
        to: { type: "string", description: "end date YYYY-MM-DD (default today)" },
        full: {
          type: "boolean",
          description: "per-day complete snapshot instead of the range fast-path",
        },
        force: { type: "boolean", description: "re-fetch days that already have a full snapshot" },
      },
    },
    toArgs: (a) => {
      const f = ["garmin-backfill", "--json", ...flags(a, ["from", "to"])];
      if (a.full === true) f.push("--full");
      if (a.force === true) f.push("--force");
      return f;
    },
  },
  journal: {
    description:
      "Add a free-text journal entry in the athlete's own words (e.g. 'legs heavy, slept badly, stressful week'). Complements the structured mood/energy/soreness log; read back via summary.",
    inputSchema: {
      type: "object",
      required: ["entry"],
      properties: {
        entry: { type: "string", description: "the free-text note" },
        tag: { type: "string", description: "optional label, e.g. 'race' or 'niggle'" },
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
      },
    },
    toArgs: (a) => ["journal", "add", String(a.entry), ...flags(a, ["tag", "date"])],
  },
  journal_list: {
    description: "List journal entries (most recent first). Filter with since/until.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number" },
      },
    },
    toArgs: (a) => ["journal", "list", "--json", ...flags(a, ["since", "until", "limit"])],
  },
  summary: {
    description:
      "Bundle a period's journal entries + daily wellness/training metrics as JSON so you can compose an end-of-week summary for the athlete. Defaults to the last 7 days.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "YYYY-MM-DD (default 7 days ago)" },
        to: { type: "string", description: "YYYY-MM-DD (default today)" },
      },
    },
    toArgs: (a) => ["summary", ...flags(a, ["since", "to"])],
  },
  notify: {
    description:
      "Send a push notification via the configured channel (webhook/Home Assistant, macOS, stdout).",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" }, title: { type: "string" } },
    },
    toArgs: (a) => ["notify", String(a.message), ...flags(a, ["title"])],
  },
};

function buildServer(): Server {
  const server = new Server(
    { name: "claude-coach", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const def = TOOLS[name];
    if (!def) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    const args = (req.params.arguments ?? {}) as Args;
    const r = await runCli(def.toArgs(args), def.stdin?.(args));
    return { content: [{ type: "text", text: r.text || "(no output)" }], isError: !r.ok };
  });

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true })); // OAuth token endpoint posts form-encoded

// Health check (unauthenticated) for the reverse proxy.
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "coach-mcp" });
});

// Built-in OAuth (Google-federated): mounts discovery + /oauth/* publicly.
if (oauthEnabled()) {
  app.use(oauthRouter());
}

// Auth gate for everything below (i.e. /mcp).
app.use(async (req, res, next) => {
  if (oauthEnabled()) {
    if (await verifyAccessToken(req.headers.authorization)) {
      next();
      return;
    }
    // Point the MCP client at the authorization-server discovery doc.
    res.set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl()}"`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // Fallback when OAuth isn't configured: optional static bearer, else open.
  const secret = process.env.COACH_AUTH_SECRET;
  if (!secret || req.headers.authorization === `Bearer ${secret}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
});

// Stateless Streamable-HTTP MCP endpoint: a fresh server+transport per request.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  const mode = oauthEnabled() ? "oauth(google)" : process.env.COACH_AUTH_SECRET ? "bearer" : "none";
  console.log(`coach-mcp listening on :${PORT} (auth: ${mode})`);
});
