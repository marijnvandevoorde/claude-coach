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

const esc = (s: string): string => `'${String(s).replace(/'/g, "''")}'`;
const intParam = (v: unknown, def: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : def;
};

/** Parse the stored compact track ([[lat,lon,ele?],…]) safely. */
function parseTrack(raw: unknown): number[][] | null {
  if (typeof raw !== "string" || raw.length < 2) return null;
  try {
    const t = JSON.parse(raw) as number[][];
    return Array.isArray(t) && t.length >= 2 ? t : null;
  } catch {
    return null;
  }
}

function api(): express.Router {
  const r = express.Router();

  // Calendar: one compact row per day for the heatmap (last ~14 months by default).
  // `gap` = a row exists but the core recovery signals are missing (watch not worn).
  r.get("/calendar", async (req, res, next) => {
    try {
      const to = String(req.query.to ?? localDate());
      const from = String(req.query.from ?? "");
      const where = from
        ? `local_date BETWEEN ${esc(from)} AND ${esc(to)}`
        : `local_date <= ${esc(to)}`;
      const limit = from ? 1000 : 430;
      const rows = await queryJson<Record<string, number | string | null>>(
        `SELECT local_date, readiness_score, acute_load, sleep_score, hrv_weekly_avg, resting_hr
         FROM wellness_state WHERE ${where} ORDER BY local_date DESC LIMIT ${limit};`
      );
      res.json(
        rows.map((d) => ({
          date: d.local_date,
          readiness: d.readiness_score,
          load: d.acute_load,
          sleep: d.sleep_score,
          hrv: d.hrv_weekly_avg,
          gap: d.readiness_score == null && d.sleep_score == null && d.hrv_weekly_avg == null,
        }))
      );
    } catch (e) {
      next(e);
    }
  });

  // Trends: daily series over a window + recent weekly volume (from the view).
  r.get("/trends", async (req, res, next) => {
    try {
      const days = intParam(req.query.days, 42);
      const series = await queryJson<Record<string, number | string | null>>(
        `SELECT local_date, readiness_score, hrv_weekly_avg, hrv_baseline_low, hrv_baseline_upper,
                acute_load, chronic_load, acwr, resting_hr, rhr_7day_avg, sleep_hours, sleep_score
         FROM wellness_state ORDER BY local_date DESC LIMIT ${Math.max(1, days)};`
      );
      const volume = await queryJson<Record<string, unknown>>(
        `SELECT * FROM weekly_volume LIMIT 12;`
      ).catch(() => []);
      res.json({ days, series: series.reverse(), weeklyVolume: volume });
    } catch (e) {
      next(e);
    }
  });

  // Activities: paginated list (cursor by start_date), optional sport filter.
  r.get("/activities", async (req, res, next) => {
    try {
      const limit = Math.min(100, intParam(req.query.limit, 40));
      const before = String(req.query.before ?? "");
      const sport = String(req.query.sport ?? "");
      const conds: string[] = [];
      if (before) conds.push(`start_date < ${esc(before)}`);
      if (sport && sport.toLowerCase() !== "all")
        conds.push(`LOWER(sport_type) = ${esc(sport.toLowerCase())}`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const rows = await queryJson<Record<string, unknown>>(
        `SELECT id, name, sport_type, start_date, distance, moving_time, total_elevation_gain,
                average_heartrate, max_heartrate, average_watts, suffer_score,
                CASE WHEN gps_track IS NOT NULL AND gps_track <> '[]' THEN 1 ELSE 0 END AS has_track
         FROM activities ${where} ORDER BY start_date DESC LIMIT ${limit};`
      );
      res.json(rows);
    } catch (e) {
      next(e);
    }
  });

  // One activity, with its decoded GPS track for the route map.
  r.get("/activity/:id", async (req, res, next) => {
    try {
      const id = intParam(req.params.id, 0);
      const rows = await queryJson<Record<string, unknown>>(
        `SELECT id, name, sport_type, start_date, distance, moving_time, elapsed_time,
                total_elevation_gain, average_heartrate, max_heartrate, average_watts,
                max_watts, weighted_average_watts, average_cadence, calories, suffer_score, gps_track
         FROM activities WHERE id = ${id} LIMIT 1;`
      );
      const a = rows[0];
      if (!a) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const track = parseTrack(a.gps_track);
      delete a.gps_track;
      res.json({ ...a, track });
    } catch (e) {
      next(e);
    }
  });

  // Journal entries (most recent first).
  r.get("/journal", async (req, res, next) => {
    try {
      const limit = Math.min(500, intParam(req.query.limit, 100));
      const conds: string[] = [];
      if (req.query.since) conds.push(`local_date >= ${esc(String(req.query.since))}`);
      if (req.query.until) conds.push(`local_date <= ${esc(String(req.query.until))}`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const rows = await queryJson<Record<string, unknown>>(
        `SELECT id, local_date, entry, tag, created_at FROM journal ${where} ORDER BY local_date DESC, id DESC LIMIT ${limit};`
      );
      res.json(rows);
    } catch (e) {
      next(e);
    }
  });

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
