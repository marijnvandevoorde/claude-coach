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

import { TOOLS, type Args, type ToolDef } from "./tools.js";

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
