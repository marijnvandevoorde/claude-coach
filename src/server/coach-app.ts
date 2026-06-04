/**
 * coach-app — the web app's HTTP service (the image's `app` mode).
 *
 * Serves the built React SPA (dist/app) and a read-mostly JSON `/api` over the
 * same MySQL/SQLite `Store` the CLI uses, behind Cloudflare Access (see access.ts).
 * Runs as a third compose service alongside `coach` (cron) and `coach-mcp`.
 */
import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execute, initDatabase, queryJson } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import {
  localDate,
  logHydration,
  hydrationTotal,
  upsertWellness,
  getPrefs,
  getWellness,
  recentNotifyLog,
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
import { uploadRoute } from "../garmin/routes.js";
import { GarminClient } from "../garmin/client.js";
import { fetchActivityStreams, toCompactStreams, type ActivityStreams } from "../garmin/streams.js";
import { fetchActivityTrack, decimate, toCompactTrack } from "../garmin/tracks.js";
import { courseTypeFromSport, trackToGpx } from "./course-gpx.js";
import { saveSubscription, deleteSubscription, countSubscriptions } from "../db/pushSubs.js";
import {
  getActivePlan,
  sessionsForDate,
  upcomingWorkouts,
  type PlannedSession,
} from "../db/plans.js";
import { pushedWorkoutsForPlan } from "../db/garminPush.js";
import { vapidPublicKey, webPushConfigured, sendWebPush } from "../lib/webpush.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.COACH_APP_PORT || process.env.PORT || 8081);
// dist/server/coach-app.js → dist/app
const APP_DIR = join(__dirname, "..", "app");
// dist/server/coach-app.js → dist/cli.js (the same CLI the cron + MCP run).
const CLI = process.env.COACH_CLI || join(__dirname, "..", "cli.js");
// Cap a server-triggered Garmin fetch so a slow/hung Garmin call can't tie up the request.
const GARMIN_FETCH_TIMEOUT_MS = Number(process.env.COACH_APP_GARMIN_TIMEOUT_MS || 120_000);

/**
 * Run the same `garmin-fetch` the cron uses, as an ASYNC child process (a
 * blocking spawnSync would freeze the event loop for the fetch's duration).
 * Reuses the exact, tested fetch+ingest path instead of duplicating it here.
 * `--no-streams` keeps the pull-to-refresh snappy — the app lazy-loads GPS
 * tracks/streams on activity view anyway. Resolves with the CLI's JSON summary.
 */
// One garmin-fetch at a time, process-wide. A pull-to-refresh kicks this off and
// returns immediately; the app polls /summary + this state to live-update as data
// lands. (coach-app is a single instance, so an in-process guard is sufficient.)
interface GarminRefreshState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error?: string;
}
let garminRefreshState: GarminRefreshState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
};

function garminFetch(date?: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const args = ["garmin-fetch", "--json", "--no-streams"];
    if (date) args.push(`--date=${date}`);
    const child = spawn("node", [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, GARMIN_FETCH_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: "garmin fetch timed out" });
      if (code !== 0) return resolve({ ok: false, error: (stderr || `exit ${code}`).trim() });
      try {
        resolve({ ok: true, data: JSON.parse(stdout) });
      } catch {
        resolve({ ok: true, data: undefined }); // succeeded but produced no JSON
      }
    });
  });
}

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

/** Parse the stored compact `activity_streams` blob ({ splits, hr, pace? }) safely. */
function parseStreams(raw: unknown): ActivityStreams | null {
  if (typeof raw !== "string" || raw.length < 2) return null;
  try {
    const s = JSON.parse(raw) as Partial<ActivityStreams>;
    if (!s || typeof s !== "object") return null;
    return {
      splits: Array.isArray(s.splits) ? s.splits : [],
      hr: Array.isArray(s.hr) ? s.hr : [],
      ...(Array.isArray(s.pace) ? { pace: s.pace } : {}),
    };
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

export interface DashboardPlan {
  hasActivePlan: boolean;
  today: PlannedSession[]; // today's planned sessions (rest days dropped)
  next: PlannedSession | null; // the next upcoming session strictly after `date`
}

/** The active plan's sessions for the dashboard — today's plus the next upcoming —
 *  each flagged whether it's been pushed to Garmin (push_key = `${date}|${name}`). */
async function planForDate(date: string): Promise<DashboardPlan> {
  const plan = await getActivePlan();
  if (!plan) return { hasActivePlan: false, today: [], next: null };
  const synced = new Set(
    (await pushedWorkoutsForPlan(plan.meta.id)).map((p) => `${p.date ?? ""}|${p.name ?? ""}`)
  );
  const mark = (s: PlannedSession): PlannedSession => ({
    ...s,
    syncedToGarmin: synced.has(`${s.date}|${s.name}`),
  });
  const today = sessionsForDate(plan, date).map(mark);
  const next = upcomingWorkouts(plan, date, 60).find((s) => s.date > date) ?? null;
  return { hasActivePlan: true, today, next: next ? mark(next) : null };
}

/** Upcoming planned sessions over the next `days` days (active plan), each flagged
 *  whether it's been pushed to Garmin. Powers the Activity screen's Upcoming list. */
async function upcomingForApp(
  days: number
): Promise<{ hasActivePlan: boolean; sessions: PlannedSession[] }> {
  const plan = await getActivePlan();
  if (!plan) return { hasActivePlan: false, sessions: [] };
  const from = localDate();
  const cutoff = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const synced = new Set(
    (await pushedWorkoutsForPlan(plan.meta.id)).map((p) => `${p.date ?? ""}|${p.name ?? ""}`)
  );
  const sessions = upcomingWorkouts(plan, from, 200)
    .filter((s) => s.date <= cutoff)
    .map((s) => ({ ...s, syncedToGarmin: synced.has(`${s.date}|${s.name}`) }));
  return { hasActivePlan: true, sessions };
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
      // Match the dashboard: /summary reconstructs readiness live when Garmin has no
      // native score, but the stored readiness_score column is often null for those
      // days — so Trends showed gaps/mismatches. Reconstruct the missing days the same
      // way (assembleReadinessSignals + computeReadiness) so the two views agree.
      await Promise.all(
        series.map(async (row) => {
          if (row.readiness_score != null) return;
          const signals = await assembleReadinessSignals(String(row.local_date));
          const score = signals ? (computeReadiness(signals)?.score ?? null) : null;
          if (score != null) row.readiness_score = score;
        })
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
                max_watts, weighted_average_watts, average_cadence, calories, suffer_score,
                gps_track, activity_streams
         FROM activities WHERE id = ${id} LIMIT 1;`
      );
      const a = rows[0];
      if (!a) {
        res.status(404).json({ error: "not found" });
        return;
      }
      let track = parseTrack(a.gps_track);

      // Lazy-populate the GPS track + splits/HR streams on first view, so the map
      // and charts self-heal if the daily fetch didn't capture them. Best effort:
      // if Garmin is unreachable, fall through with what we have and retry on a
      // later view. One client serves both fetches.
      let streams = parseStreams(a.activity_streams);
      const needTrack = a.gps_track == null;
      const needStreams = a.activity_streams == null;
      if (needTrack || needStreams) {
        try {
          const client = await GarminClient.create();
          if (needTrack) {
            const compact = toCompactTrack(decimate(await fetchActivityTrack(client, id)));
            await execute(`UPDATE activities SET gps_track = ${esc(compact)} WHERE id = ${id};`);
            track = parseTrack(compact) ?? track;
          }
          if (needStreams) {
            const fetched = await fetchActivityStreams(client, id);
            await execute(
              `UPDATE activities SET activity_streams = ${esc(toCompactStreams(fetched))} WHERE id = ${id};`
            );
            streams = fetched;
          }
        } catch {
          /* leave what we have; a later view retries (no sentinel stored on failure) */
        }
      }

      delete a.gps_track;
      delete a.activity_streams;
      res.json({
        ...a,
        track,
        splits: streams?.splits ?? [],
        hrSeries: streams?.hr ?? [],
      });
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

  // Notification delivery log — recent push attempts (per type) so the user can
  // see whether a channel (e.g. the Home Assistant webhook) is the weak link.
  r.get("/notify-log", async (req, res, next) => {
    try {
      const limit = Math.min(200, intParam(req.query.limit, 50));
      res.json(await recentNotifyLog(limit));
    } catch (e) {
      next(e);
    }
  });

  // --- PWA Web Push (a second notification channel) -------------------------

  // Browser bootstrap: the VAPID public key + whether push is usable + current
  // subscription count (so the UI can show "on/off").
  r.get("/push/config", async (_req, res, next) => {
    try {
      res.json({
        enabled: webPushConfigured(),
        publicKey: vapidPublicKey(),
        subscriptions: webPushConfigured() ? await countSubscriptions() : 0,
      });
    } catch (e) {
      next(e);
    }
  });

  // Store a PushSubscription (from the SW's pushManager.subscribe). Idempotent.
  r.post("/push/subscribe", async (req, res, next) => {
    try {
      const sub = req.body as {
        endpoint?: unknown;
        keys?: { p256dh?: unknown; auth?: unknown };
      };
      const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
      const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
      const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
      if (!endpoint || !p256dh || !auth) {
        res.status(400).json({ error: "invalid subscription" });
        return;
      }
      await saveSubscription({ endpoint, p256dh, auth }, req.get("user-agent"));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Drop a subscription (user turned notifications off, or it expired).
  r.post("/push/unsubscribe", async (req, res, next) => {
    try {
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
      if (endpoint) await deleteSubscription(endpoint);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Send a one-off test push to all subscriptions (the "is it working?" button).
  r.post("/push/test", async (_req, res, next) => {
    try {
      if (!webPushConfigured()) {
        res.status(400).json({ error: "web push not configured" });
        return;
      }
      const wp = await sendWebPush("Claude Coach", "Test notification — push is working. 🎉");
      res.json({ ok: wp.sent > 0, ...wp });
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
      // Don't ship the big raw blob to the client — stages were parsed above.
      if (w) delete w.garmin_raw;

      res.json({
        date,
        wellness: w,
        hydration: { total_ml: Number(hyd[0]?.total ?? 0) },
        lastActivity: act[0] ?? null,
        readiness,
        sleep,
        plan: await planForDate(date),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Upcoming planned sessions (active plan) for the Activity screen's Upcoming list.
  r.get("/plan/upcoming", async (req, res, next) => {
    try {
      const days = Math.max(1, Math.min(120, intParam(req.query.days, 21)));
      res.json(await upcomingForApp(days));
    } catch (e) {
      next(e);
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

  // Create a Garmin course (route) from an activity's stored GPS track.
  // Real write: synthesizes a GPX from gps_track and uploads via uploadRoute.
  r.post("/course-from-activity", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = Math.trunc(Number(body.activityId));
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "activityId must be a positive integer" });
        return;
      }
      if (body.name !== undefined && typeof body.name !== "string") {
        res.status(400).json({ error: "name must be a string" });
        return;
      }
      if (body.type !== undefined && typeof body.type !== "string") {
        res.status(400).json({ error: "type must be a string" });
        return;
      }
      const rows = await queryJson<Record<string, unknown>>(
        `SELECT name, sport_type, gps_track FROM activities WHERE id = ${id} LIMIT 1;`
      );
      const a = rows[0];
      if (!a) {
        res.status(404).json({ error: "activity not found" });
        return;
      }
      const track = parseTrack(a.gps_track);
      if (!track || track.length < 2) {
        res.status(400).json({ error: "no GPS track" });
        return;
      }
      const activityName = typeof a.name === "string" && a.name ? a.name : "Activity";
      const name =
        (typeof body.name === "string" && body.name.trim()) || `${activityName} (from activity)`;
      const type =
        (typeof body.type === "string" && body.type.trim()) ||
        courseTypeFromSport(a.sport_type as string | null);
      const gpx = trackToGpx(track, name);
      try {
        const result = await uploadRoute({ gpx, name, type });
        res.json({ courseId: result.courseId, name: result.name });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      next(e);
    }
  });

  // Upload a user-supplied GPX file as a Garmin course (route).
  // Real write: parses the GPX body and uploads via uploadRoute (same path as
  // the CLI/MCP `garmin-route`).
  r.post("/upload-route", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const gpx = body.gpx;
      if (typeof gpx !== "string" || gpx.trim().length === 0) {
        res.status(400).json({ error: "gpx (the GPX file contents) is required" });
        return;
      }
      if (body.name !== undefined && typeof body.name !== "string") {
        res.status(400).json({ error: "name must be a string" });
        return;
      }
      if (body.type !== undefined && typeof body.type !== "string") {
        res.status(400).json({ error: "type must be a string" });
        return;
      }
      const name = (typeof body.name === "string" && body.name.trim()) || undefined;
      const type = (typeof body.type === "string" && body.type.trim()) || undefined;
      try {
        const result = await uploadRoute({ gpx, name, type });
        res.json({ courseId: result.courseId ?? null, name: result.name, points: result.points });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      next(e);
    }
  });

  // Trigger a live Garmin sync on the server (pull-to-refresh). Fire-and-poll:
  // kicks off garmin-fetch in the background and returns immediately; the client
  // re-fetches /summary (and polls GET /garmin/refresh) to live-update as the
  // fresh wellness/activities land. Guarded so concurrent pulls don't pile up.
  r.post("/garmin/refresh", async (req, res, next) => {
    try {
      const date = optDate((req.body ?? {}).date);
      if (date === null) {
        res.status(400).json({ error: "date must be YYYY-MM-DD" });
        return;
      }
      if (garminRefreshState.running) {
        res.status(202).json({ status: "running", startedAt: garminRefreshState.startedAt });
        return;
      }
      garminRefreshState = {
        running: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        ok: null,
      };
      void garminFetch(date || undefined)
        .then((r) => {
          if (!r.ok) log.warn(`garmin refresh failed: ${r.error}`);
          garminRefreshState = {
            running: false,
            startedAt: garminRefreshState.startedAt,
            finishedAt: new Date().toISOString(),
            ok: r.ok,
            error: r.ok ? undefined : r.error,
          };
        })
        .catch((e) => {
          garminRefreshState = {
            running: false,
            startedAt: garminRefreshState.startedAt,
            finishedAt: new Date().toISOString(),
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        });
      res.status(202).json({ status: "started" });
    } catch (e) {
      next(e);
    }
  });

  // Poll the state of the most recent (or in-flight) Garmin refresh.
  r.get("/garmin/refresh", (_req, res) => res.json(garminRefreshState));

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
  // 8mb so a long ride's GPX (thousands of trackpoints) fits the upload-route body.
  app.use("/api", accessMiddleware(), express.json({ limit: "8mb" }), api());

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
  // index.html and the service worker must not be long-cached, or SPA/SW updates
  // won't propagate (the rest is content-hashed and safe to cache for a year).
  if (path.endsWith("index.html") || path.endsWith("sw.js"))
    res.setHeader("Cache-Control", "no-cache");
}

main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
