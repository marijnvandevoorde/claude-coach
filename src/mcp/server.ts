/**
 * coach-mcp — a small HTTP MCP server (Streamable HTTP) that exposes the coach
 * to any Claude client. Each tool execs the existing CLI (`dist/cli.js`) so the
 * MCP reuses the exact, tested logic. Runs as the image's `mcp` mode behind
 * a reverse proxy + Cloudflare Access; an optional bearer (COACH_AUTH_SECRET) is checked too.
 */
import express from "express";
import { hostname } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  initOAuthStore,
  oauthEnabled,
  oauthRouter,
  verifyAccessToken,
  resourceMetadataUrl,
} from "./oauth.js";
import { initDatabase } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { JobRunner } from "./jobs.js";
import { callTool, listTools, type ToolCallContext } from "./handler.js";
import type { Args } from "./tools.js";

const CLI = process.env.COACH_CLI || "/app/dist/cli.js";
const PORT = Number(process.env.COACH_MCP_PORT || process.env.PORT || 8080);
// Per-tool wall-clock cap for inline tools. Override with COACH_MCP_TOOL_TIMEOUT_MS.
const TOOL_TIMEOUT_MS = Number(process.env.COACH_MCP_TOOL_TIMEOUT_MS || 600_000);
// Cap for a background job (a long backfill). Override with COACH_MCP_JOB_TIMEOUT_MS.
const JOB_TIMEOUT_MS = Number(process.env.COACH_MCP_JOB_TIMEOUT_MS || 3_600_000);
// How long a job tool waits before answering with a job id. Cloudflare cuts a request
// at 100 s; 20 s keeps short calls inline. Override with COACH_MCP_INLINE_WAIT_MS.
const INLINE_WAIT_MS = Number(process.env.COACH_MCP_INLINE_WAIT_MS || 20_000);

// Jobs live in the database, so it is needed even without OAuth.
await initDatabase();
await migrate(true);
const runner = new JobRunner({ owner: `${hostname()}:${process.pid}` });
const swept = await runner.sweep();
if (swept) console.log(`coach-mcp: marked ${swept} interrupted job(s) as failed`);

function buildServer(user: string): Server {
  const server = new Server(
    { name: "claude-coach", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const ctx: ToolCallContext = {
    user,
    runner,
    cli: CLI,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
    jobTimeoutMs: JOB_TIMEOUT_MS,
    inlineWaitMs: INLINE_WAIT_MS,
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(req.params.name, (req.params.arguments ?? {}) as Args, ctx)
  );

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
  await initOAuthStore(); // registered clients live in the DB
  app.use(oauthRouter());
}

// Auth gate for everything below (i.e. /mcp).
app.use(async (req, res, next) => {
  if (oauthEnabled()) {
    const who = await verifyAccessToken(req.headers.authorization);
    if (who) {
      res.locals.user = who.email;
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
  const server = buildServer(String(res.locals.user ?? "default"));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// On shutdown (a rollout or restart) this process's jobs die with it: record that.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    runner
      .shutdown()
      .then((n) => n && console.log(`coach-mcp: ${sig}, marked ${n} running job(s) as failed`))
      .catch((e) => console.error(`coach-mcp: could not mark jobs on ${sig}: ${String(e)}`))
      .finally(() => process.exit(0));
  });
}

app.listen(PORT, () => {
  const mode = oauthEnabled() ? "oauth(google)" : process.env.COACH_AUTH_SECRET ? "bearer" : "none";
  console.log(`coach-mcp listening on :${PORT} (auth: ${mode})`);
});
