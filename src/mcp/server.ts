/**
 * coach-mcp — a small HTTP MCP server (Streamable HTTP) that exposes the coach
 * to any Claude client. Each tool execs the existing CLI (`dist/cli.js`) so the
 * MCP reuses the exact, tested logic. Runs as the image's `mcp` mode behind
 * a reverse proxy + Cloudflare Access; an optional bearer (COACH_AUTH_SECRET) is checked too.
 */
import express from "express";
import { spawnSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { oauthEnabled, oauthRouter, verifyAccessToken, resourceMetadataUrl } from "./oauth.js";

const CLI = process.env.COACH_CLI || "/app/dist/cli.js";
const PORT = Number(process.env.COACH_MCP_PORT || process.env.PORT || 8080);

function runCli(args: string[]): { ok: boolean; text: string } {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { ok: false, text: r.error.message };
  if (r.status !== 0)
    return { ok: false, text: (r.stderr || r.stdout || `exit ${r.status}`).trim() };
  return { ok: true, text: (r.stdout || "").trim() };
}

type Args = Record<string, unknown>;
interface ToolDef {
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  toArgs: (a: Args) => string[];
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
      "Upload a GPX file to Garmin as a course/route, kept EXACTLY as-is (no point reduction, no snap-to-roads). Give the path to a .gpx file plus an optional name (defaults to the GPX track name) and course type. dryRun parses + builds the payload without uploading.",
    inputSchema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          description: "path to a .gpx file (must be readable by the coach server)",
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
      const f = ["garmin-route", String(a.file), "--json", ...flags(a, ["name", "type"])];
      if (a.dryRun === true) f.push("--dry-run");
      return f;
    },
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
    const r = runCli(def.toArgs((req.params.arguments ?? {}) as Args));
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
