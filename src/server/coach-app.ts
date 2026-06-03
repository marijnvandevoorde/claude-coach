/**
 * coach-app — the web app's HTTP service (the image's `app` mode).
 *
 * Serves the built React SPA (dist/app) and a read-mostly JSON `/api` over the
 * same MySQL/SQLite `Store` the CLI uses, behind Cloudflare Access (see access.ts).
 * Runs as a third compose service alongside `coach` (cron) and `coach-mcp`.
 */
import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase, queryJson } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { localDate } from "../db/wellness.js";
import { accessMiddleware, accessEnabled } from "./access.js";
import { log } from "../lib/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.COACH_APP_PORT || process.env.PORT || 8081);
// dist/server/coach-app.js → dist/app
const APP_DIR = join(__dirname, "..", "app");

function api(): express.Router {
  const r = express.Router();

  // Today's snapshot: wellness row + hydration total + most recent activity.
  r.get("/summary", async (req, res) => {
    try {
      const date = String(req.query.date ?? localDate());
      const esc = `'${date.replace(/'/g, "''")}'`;
      const [wellness, hyd, act] = await Promise.all([
        queryJson<Record<string, unknown>>(
          `SELECT * FROM wellness_state WHERE local_date = ${esc};`
        ),
        queryJson<{ total: number }>(
          `SELECT COALESCE(SUM(amount_ml),0) AS total FROM hydration_log WHERE local_date = ${esc};`
        ),
        queryJson<Record<string, unknown>>(
          `SELECT id, name, sport_type, start_date, distance, moving_time, average_heartrate, max_heartrate, total_elevation_gain, suffer_score FROM activities ORDER BY start_date DESC LIMIT 1;`
        ),
      ]);
      res.json({
        date,
        wellness: wellness[0] ?? null,
        hydration: { total_ml: Number(hyd[0]?.total ?? 0) },
        lastActivity: act[0] ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return r;
}

async function main(): Promise<void> {
  await initDatabase();
  await migrate(true);

  const app = express();
  app.disable("x-powered-by");

  // Unauthenticated liveness check (for compose/Traefik).
  app.get("/healthz", (_req, res) => res.json({ ok: true, service: "coach-app" }));

  // JSON API — behind Cloudflare Access.
  app.use("/api", accessMiddleware(), express.json({ limit: "1mb" }), api());

  // Static SPA (built to dist/app), also behind Access; SPA fallback for client routes.
  if (existsSync(APP_DIR)) {
    app.use(
      "/app",
      accessMiddleware(),
      express.static(APP_DIR, { index: "index.html", maxAge: "1y", setHeaders: noCacheHtml })
    );
    app.get("/app/*", accessMiddleware(), (_req, res) => res.sendFile(join(APP_DIR, "index.html")));
  }

  app.listen(PORT, () =>
    log.info(`coach-app listening on :${PORT} (access: ${accessEnabled() ? "cloudflare" : "open"})`)
  );
}

function noCacheHtml(res: express.Response, path: string): void {
  if (path.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
}

main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
