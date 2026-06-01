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
  garmin_sync: {
    description:
      "Cache a daily Garmin snapshot (readiness, sleep, HRV, body battery, …) into coach.db.",
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

// Health check (unauthenticated) for the reverse proxy.
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "coach-mcp" });
});

// Optional bearer check (defense-in-depth; Cloudflare Access is the primary gate).
app.use((req, res, next) => {
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
  console.log(
    `coach-mcp listening on :${PORT} (auth: ${process.env.COACH_AUTH_SECRET ? "bearer" : "none"})`
  );
});
