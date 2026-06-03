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
import {
  localDate,
  logHydration,
  hydrationTotal,
  upsertWellness,
  getPrefs,
  getWellness,
} from "../db/wellness.js";
import { addJournalEntry } from "../db/journal.js";
import { assembleReadinessSignals } from "../lib/readiness.js";
import {
  readinessContributions,
  computeReadiness,
  recoveryLevelFromScore,
} from "../lib/recovery.js";
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

interface SleepStages {
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
}

/**
 * Parse sleep-stage minutes from the day's `garmin_raw` blob. The stage seconds
 * live on `raw.sleep` (the Garmin `dailySleepDTO`): deepSleepSeconds,
 * lightSleepSeconds, remSleepSeconds, awakeSleepSeconds. Returns minutes, or
 * null if the blob (or all stage fields) are absent.
 */
function parseSleepStages(rawBlob: unknown): SleepStages | null {
  if (typeof rawBlob !== "string" || rawBlob.length < 2) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawBlob) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sleep = raw?.sleep as Record<string, unknown> | undefined;
  if (!sleep || typeof sleep !== "object") return null;
  const toMin = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v / 60) : null;
  const stages: SleepStages = {
    deep: toMin(sleep.deepSleepSeconds),
    light: toMin(sleep.lightSleepSeconds),
    rem: toMin(sleep.remSleepSeconds),
    awake: toMin(sleep.awakeSleepSeconds),
  };
  if (stages.deep == null && stages.light == null && stages.rem == null && stages.awake == null)
    return null;
  return stages;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const intInRange = (v: unknown, lo: number, hi: number): boolean => isInt(v) && v >= lo && v <= hi;

/** Validate an optional YYYY-MM-DD date string. Returns the string, undefined
 *  (absent → today), or null (present but invalid). */
function optDate(v: unknown): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
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

  // Today's snapshot: wellness row + hydration total + most recent activity,
  // plus a readiness breakdown (score/level/contributions/coverage) and a sleep
  // summary (hours/score/stages parsed from the day's garmin_raw blob).
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
      const w = wellness[0] ?? null;

      // Readiness: prefer the native Garmin score if cached, else reconstruct.
      // Contributions/coverage always come from the assembled signals.
      const signals = await assembleReadinessSignals(date);
      let readiness: {
        score: number | null;
        level: string | null;
        contributions: ReturnType<typeof readinessContributions>["contributions"];
        coverage: ReturnType<typeof readinessContributions>["coverage"];
      } | null = null;
      if (signals) {
        const { contributions, coverage } = readinessContributions(signals);
        const native = w?.readiness_score;
        if (native != null) {
          readiness = {
            score: Number(native),
            level: recoveryLevelFromScore(Number(native)),
            contributions,
            coverage,
          };
        } else {
          const derived = computeReadiness(signals);
          readiness = {
            score: derived?.score ?? null,
            level: derived?.level ?? null,
            contributions,
            coverage,
          };
        }
      }

      const sleep = {
        hours: w?.sleep_hours != null ? Number(w.sleep_hours) : null,
        score: w?.sleep_score != null ? Number(w.sleep_score) : null,
        stages: parseSleepStages(w?.garmin_raw),
      };

      res.json({
        date,
        wellness: w,
        hydration: { total_ml: Number(hyd[0]?.total ?? 0) },
        lastActivity: act[0] ?? null,
        readiness,
        sleep,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ---- Write endpoints (Access-gated; reuse the CLI's tested data helpers) ----

  // Log hydration; returns the updated total + the day's goal.
  r.post("/hydration", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ml = body.ml;
      if (!intInRange(ml, 1, 3000)) {
        res.status(400).json({ error: "ml must be a positive integer ≤ 3000" });
        return;
      }
      const date = optDate(body.date);
      if (date === null) {
        res.status(400).json({ error: "date must be YYYY-MM-DD" });
        return;
      }
      await logHydration(ml as number, { date });
      const d = localDate(date);
      const total_ml = await hydrationTotal(d);
      const goal_ml = (await getPrefs()).hydration_goal_ml ?? 0;
      res.json({ date: d, total_ml, goal_ml });
    } catch (e) {
      next(e);
    }
  });

  // Log subjective wellness (energy/mood); returns the updated wellness row.
  r.post("/subjective", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { energy, mood } = body;
      if (energy === undefined && mood === undefined) {
        res.status(400).json({ error: "provide at least one of energy, mood" });
        return;
      }
      if (energy !== undefined && !intInRange(energy, 1, 5)) {
        res.status(400).json({ error: "energy must be an integer 1–5" });
        return;
      }
      if (mood !== undefined && !intInRange(mood, 1, 5)) {
        res.status(400).json({ error: "mood must be an integer 1–5" });
        return;
      }
      const date = optDate(body.date);
      if (date === null) {
        res.status(400).json({ error: "date must be YYYY-MM-DD" });
        return;
      }
      await upsertWellness(date, {
        ...(energy !== undefined ? { subjective_energy: energy as number } : {}),
        ...(mood !== undefined ? { mood: mood as number } : {}),
      });
      const d = localDate(date);
      res.json({ date: d, wellness: await getWellness(d) });
    } catch (e) {
      next(e);
    }
  });

  // Add a free-text journal entry; returns the day's entries (newest first).
  r.post("/journal", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entry = body.entry;
      if (typeof entry !== "string" || entry.trim() === "") {
        res.status(400).json({ error: "entry must be a non-empty string" });
        return;
      }
      const tag = body.tag;
      if (tag !== undefined && typeof tag !== "string") {
        res.status(400).json({ error: "tag must be a string" });
        return;
      }
      const date = optDate(body.date);
      if (date === null) {
        res.status(400).json({ error: "date must be YYYY-MM-DD" });
        return;
      }
      await addJournalEntry(entry, { date, tag });
      const d = localDate(date);
      const escD = `'${d.replace(/'/g, "''")}'`;
      const rows = await queryJson<Record<string, unknown>>(
        `SELECT id, local_date, entry, tag, created_at FROM journal WHERE local_date = ${escD} ORDER BY id DESC;`
      );
      res.json({ date: d, entries: rows });
    } catch (e) {
      next(e);
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
    // SPA fallback for client-side routes (Express 5 needs a NAMED wildcard).
    app.get("/app/*splat", accessMiddleware(), (_req, res) =>
      res.sendFile(join(APP_DIR, "index.html"))
    );
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
