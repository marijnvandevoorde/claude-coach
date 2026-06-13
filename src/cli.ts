import {
  configExists,
  loadConfig,
  promptForConfig,
  saveConfig,
  saveTokens,
  tokensExist,
  getDbPath,
  createConfig,
  type Tokens,
} from "./lib/config.js";
import { log } from "./lib/logging.js";
import { migrate } from "./db/migrate.js";
import { closeDatabase, execute, initDatabase, query, queryJson } from "./db/client.js";
import { getDialect } from "./db/dialect.js";
import {
  getPrefs,
  updatePrefs,
  logHydration,
  hydrationTotal,
  getWellness,
  upsertWellness,
  localDate,
  logNotify,
  type PrefsPatch,
  type WellnessPatch,
  type WellnessRow,
  type ReminderPrefs,
} from "./db/wellness.js";
import { resolveNotify, sendNotification } from "./lib/notify.js";
import { sendWebPush, webPushConfigured } from "./lib/webpush.js";
import { recoveryLevelFromScore, type RecoveryLevel } from "./lib/recovery.js";
import { assembleReadiness } from "./lib/readiness.js";
import { generateIcs } from "./viewer/lib/export/ics.js";
import { getSportIcon } from "./viewer/lib/utils.js";
import type { TrainingPlan } from "./schema/training-plan.js";
import { getValidTokens } from "./strava/oauth.js";
import { getAllActivities, getAthlete } from "./strava/api.js";
import type { StravaActivity, StravaTokenResponse } from "./strava/types.js";
import { readFileSync, writeFileSync } from "fs";
import { getDataSource, type DailySnapshot } from "./datasource/index.js";
import { pushWorkouts, type WorkoutInput, type PushStore } from "./garmin/workouts.js";
import { lookupPushedWorkout, savePushedWorkout } from "./db/garminPush.js";
import {
  savePlan,
  getActivePlan,
  getPlan,
  listPlans,
  setActivePlan,
  deletePlan,
  deriveTodaysWorkout,
  sessionsForDate,
  upcomingWorkouts,
  planDays,
  keyedPlanWorkouts,
  normalizeWorkout,
  validatePlan,
  type PlanDay,
} from "./db/plans.js";
import { uploadRoute, COURSE_TYPES } from "./garmin/routes.js";
import { runBackfill, type BackfillSink } from "./garmin/backfill.js";
import { GarminClient } from "./garmin/client.js";
import { fetchActivityTrack, decimate, toCompactTrack } from "./garmin/tracks.js";
import { fetchActivityStreams, toCompactStreams } from "./garmin/streams.js";
import { addJournalEntry, listJournalEntries } from "./db/journal.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Proxy Configuration
// ============================================================================

// Configure proxy for fetch() if HTTP_PROXY or HTTPS_PROXY is set
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface SyncArgs {
  command: "sync";
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  days?: number;
}

interface RenderArgs {
  command: "render";
  inputFile: string;
  outputFile?: string;
}

interface ExportCalendarArgs {
  command: "export-calendar";
  inputFile: string;
  outputFile?: string;
  json: boolean;
  stdin?: boolean;
}

interface ExportGarminArgs {
  command: "export-garmin";
  inputFile: string;
  stdin?: boolean;
}

interface QueryArgs {
  command: "query";
  sql: string;
  json: boolean;
}

interface AuthArgs {
  command: "auth";
  clientId?: string;
  clientSecret?: string;
  code?: string;
}

interface HelpArgs {
  command: "help";
}

interface LogArgs {
  command: "log";
  type: string;
  value?: string;
  flags: Flags;
}

interface ConfigArgs {
  command: "config";
  flags: Flags;
}

interface CheckinArgs {
  command: "checkin";
  flags: Flags;
}

interface NotifyArgs {
  command: "notify";
  message?: string;
  flags: Flags;
}

interface GarminSyncArgs {
  command: "garmin-sync";
  flags: Flags;
}

interface GarminFetchArgs {
  command: "garmin-fetch";
  flags: Flags;
}

interface GarminPushArgs {
  command: "garmin-push";
  inputFile: string;
  flags: Flags;
}

interface GarminRouteArgs {
  command: "garmin-route";
  inputFile: string;
  flags: Flags;
}

interface GarminBackfillArgs {
  command: "garmin-backfill";
  flags: Flags;
}

interface GarminTracksArgs {
  command: "garmin-tracks";
  flags: Flags;
}

interface GarminStreamsArgs {
  command: "garmin-streams";
  flags: Flags;
}

interface JournalArgs {
  command: "journal";
  sub: string;
  text?: string;
  flags: Flags;
}

interface SummaryArgs {
  command: "summary";
  flags: Flags;
}

interface WellnessArgs {
  command: "wellness";
  flags: Flags;
}

interface PlanArgs {
  command: "plan";
  sub: string; // save | list | get | activate | delete | show-today | upcoming
  pos?: string; // positional arg after the subcommand (a plan id, or a file path for save)
  flags: Flags;
}

type CliArgs =
  | SyncArgs
  | RenderArgs
  | ExportCalendarArgs
  | ExportGarminArgs
  | QueryArgs
  | AuthArgs
  | HelpArgs
  | LogArgs
  | ConfigArgs
  | CheckinArgs
  | NotifyArgs
  | GarminSyncArgs
  | GarminFetchArgs
  | GarminPushArgs
  | GarminRouteArgs
  | GarminBackfillArgs
  | GarminTracksArgs
  | GarminStreamsArgs
  | JournalArgs
  | SummaryArgs
  | WellnessArgs
  | PlanArgs;

type Flags = Record<string, string | boolean>;

/** Parse `--key=value` and bare `--flag` tokens into a map. Handles values containing '='. */
function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) flags[body] = true;
    else flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

function flagStr(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagNum(flags: Flags, key: string): number | undefined {
  const v = flags[key];
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "sync") {
    // Sync command (default)
    const syncArgs: SyncArgs = { command: "sync" };

    for (const arg of args) {
      if (arg.startsWith("--client-id=")) {
        syncArgs.clientId = arg.split("=")[1];
      } else if (arg.startsWith("--client-secret=")) {
        syncArgs.clientSecret = arg.split("=")[1];
      } else if (arg.startsWith("--access-token=")) {
        syncArgs.accessToken = arg.split("=")[1];
      } else if (arg.startsWith("--refresh-token=")) {
        syncArgs.refreshToken = arg.split("=")[1];
      } else if (arg.startsWith("--days=")) {
        syncArgs.days = parseInt(arg.split("=")[1]);
      }
    }

    return syncArgs;
  }

  if (args[0] === "render") {
    if (!args[1]) {
      log.error("render command requires an input file");
      process.exit(1);
    }

    const renderArgs: RenderArgs = {
      command: "render",
      inputFile: args[1],
    };

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--output" || args[i] === "-o") {
        renderArgs.outputFile = args[i + 1];
        i++;
      } else if (args[i].startsWith("--output=")) {
        renderArgs.outputFile = args[i].split("=")[1];
      }
    }

    return renderArgs;
  }

  if (args[0] === "export-calendar") {
    // Plan source: a file path, --stdin (MCP inline), or --active (stored plan).
    const fromStdin = args.includes("--stdin");
    const active = args.includes("--active");
    const hasFile = !!(args[1] && !args[1].startsWith("--"));
    if (!fromStdin && !active && !hasFile) {
      log.error("export-calendar requires a plan JSON file, --stdin, or --active");
      process.exit(1);
    }
    const calArgs: ExportCalendarArgs = {
      command: "export-calendar",
      stdin: fromStdin,
      inputFile: hasFile ? args[1] : "",
      json: args.includes("--json"),
    };
    for (let i = hasFile ? 2 : 1; i < args.length; i++) {
      if (args[i] === "--output" || args[i] === "-o") {
        calArgs.outputFile = args[i + 1];
        i++;
      } else if (args[i].startsWith("--output=")) {
        calArgs.outputFile = args[i].split("=")[1];
      }
    }
    return calArgs;
  }

  if (args[0] === "export-garmin") {
    const fromStdin = args.includes("--stdin");
    const active = args.includes("--active");
    const hasFile = !!(args[1] && !args[1].startsWith("--"));
    if (!fromStdin && !active && !hasFile) {
      log.error("export-garmin requires a plan JSON file, --stdin, or --active");
      process.exit(1);
    }
    return { command: "export-garmin", stdin: fromStdin, inputFile: hasFile ? args[1] : "" };
  }

  if (args[0] === "garmin-push") {
    const rest = args.slice(1);
    // Plan source: a file path, --stdin (MCP inline), or --active (stored plan).
    if (rest.includes("--stdin") || rest.includes("--active")) {
      return { command: "garmin-push", inputFile: "", flags: parseFlags(rest) };
    }
    if (!args[1] || args[1].startsWith("--")) {
      log.error(
        "garmin-push requires a plan JSON file, --stdin, or --active (e.g. garmin-push --active --dry-run)"
      );
      process.exit(1);
    }
    return { command: "garmin-push", inputFile: args[1], flags: parseFlags(args.slice(2)) };
  }

  if (args[0] === "garmin-route") {
    const rest = args.slice(1);
    // --stdin reads the GPX from stdin (used by the MCP to pass file content); otherwise need a path.
    if (rest.includes("--stdin")) {
      return { command: "garmin-route", inputFile: "", flags: parseFlags(rest) };
    }
    if (!args[1] || args[1].startsWith("--")) {
      log.error(
        "garmin-route requires a GPX file or --stdin (e.g. garmin-route route.gpx --name=… --type=mtb)"
      );
      process.exit(1);
    }
    return { command: "garmin-route", inputFile: args[1], flags: parseFlags(args.slice(2)) };
  }

  if (args[0] === "garmin-backfill") {
    return { command: "garmin-backfill", flags: parseFlags(args.slice(1)) };
  }
  if (args[0] === "garmin-tracks") {
    return { command: "garmin-tracks", flags: parseFlags(args.slice(1)) };
  }
  if (args[0] === "garmin-streams") {
    return { command: "garmin-streams", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "journal") {
    const sub = args[1] && !args[1].startsWith("--") ? args[1] : "list";
    const text = sub === "add" ? args[2] : undefined;
    const rest = sub === "add" ? args.slice(3) : args.slice(2);
    return { command: "journal", sub, text, flags: parseFlags(rest) };
  }

  if (args[0] === "summary") {
    return { command: "summary", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "plan") {
    // plan <sub> [<id|file>] [--flags]. Default sub = list.
    const sub = args[1] && !args[1].startsWith("--") ? args[1] : "list";
    const pos = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
    return { command: "plan", sub, pos, flags: parseFlags(args.slice(2)) };
  }

  if (args[0] === "query") {
    if (!args[1]) {
      log.error("query command requires a SQL statement");
      process.exit(1);
    }

    const queryArgs: QueryArgs = {
      command: "query",
      sql: args[1],
      json: args.includes("--json"),
    };

    return queryArgs;
  }

  if (args[0] === "auth") {
    const authArgs: AuthArgs = { command: "auth" };

    for (const arg of args) {
      if (arg.startsWith("--client-id=")) {
        authArgs.clientId = arg.slice("--client-id=".length);
      } else if (arg.startsWith("--client-secret=")) {
        authArgs.clientSecret = arg.slice("--client-secret=".length);
      } else if (arg.startsWith("--code=")) {
        authArgs.code = arg.slice("--code=".length);
      }
    }

    return authArgs;
  }

  if (args[0] === "log") {
    if (!args[1]) {
      log.error("log requires a type, e.g. 'log water 500' or 'log sleep 7.5'");
      process.exit(1);
    }
    // Second positional (the value) may be absent for some types; flags start with '--'.
    const value = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
    return {
      command: "log",
      type: args[1],
      value,
      flags: parseFlags(args.slice(2)),
    };
  }

  if (args[0] === "config") {
    return { command: "config", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "checkin") {
    return { command: "checkin", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "notify") {
    const message = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
    return { command: "notify", message, flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "garmin-sync") {
    return { command: "garmin-sync", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "garmin-fetch") {
    return { command: "garmin-fetch", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "wellness" || args[0] === "today") {
    return { command: "wellness", flags: parseFlags(args.slice(1)) };
  }

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    return { command: "help" };
  }

  log.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}

function printHelp(): void {
  console.log(`
Claude Coach - Training Plan Tools

Usage: npx claude-coach <command> [options]

Commands:
  sync              Sync activities from Strava
  auth              Get Strava authorization URL or exchange code for tokens
  render <file>     Render a training plan JSON to HTML
  export-calendar <file>  Plan → .ics (or --json events to push to Google Calendar)
  export-garmin <file>    Plan → structured workouts JSON (to create + schedule on Garmin)
  garmin-push <file>      Create + schedule a plan's workouts on Garmin (--dry-run to preview)
  garmin-route <file.gpx> Upload a GPX as a Garmin course (--name, --type, --dry-run)
  garmin-backfill         Backfill history into the DB (--from=|--days= --to= [--full] [--force])
  garmin-tracks           Download + store each activity's GPS track ([--limit=] [--id=] [--force])
  garmin-streams          Download + store each activity's real splits + HR stream ([--limit=] [--id=] [--force])
  journal add "<text>"    Add a free-text journal entry (--tag= --date=)
  journal list            List journal entries (--since= --until= --limit= --json)
  summary                 Bundle the week's journal + wellness as JSON (--since= --to=)
  query <sql>       Run a SQL query against the database
  log <type> <val>  Log wellness/intake (water|sleep|energy|soreness|mood|weight)
  wellness          Show today's hydration + wellness snapshot
  config            Show/set reminder preferences (bedtime, water goal, quiet hours)
  notify <message>  Send a push notification (webhook/Home Assistant, macOS, or stdout)
  garmin-fetch      Pull live data FROM Garmin Connect (wellness + activities) into coach.db
  garmin-sync       Cache Garmin metrics you already have (readiness, sleep, HRV…) to coach.db
  checkin           Assemble plan + Garmin + wellness into a coaching/reminder payload
  help              Show this help message

Auth Options (for headless/Claude environments):
  --client-id=ID        Strava API client ID
  --client-secret=SEC   Strava API client secret
  --code=URL_OR_CODE    Full redirect URL or just the authorization code

  Step 1: Run 'auth' with credentials to get authorization URL
  Step 2: User clicks URL, authorizes, copies entire redirect URL
  Step 3: Run 'auth --code=URL' to exchange for tokens
  Step 4: Run 'sync' to fetch activities

Sync Options:
  --client-id=ID        Strava API client ID (for OAuth flow)
  --client-secret=SEC   Strava API client secret (for OAuth flow)
  --days=N              Days of history to sync (default: 730)

Render Options:
  --output, -o FILE     Output HTML file (default: <input>.html)

Query Options:
  --json                Output as JSON (default: plain text)

Examples:
  # Headless auth flow (for Claude/automated environments)
  npx claude-coach auth --client-id=12345 --client-secret=abc123
  # User clicks URL, copies code from failed redirect
  npx claude-coach auth --code=AUTHORIZATION_CODE
  npx claude-coach sync

  # Interactive auth flow (opens browser)
  npx claude-coach sync --client-id=12345 --client-secret=abc123

  # Render a training plan to HTML
  npx claude-coach render plan.json --output my-plan.html

  # Export a plan to calendar (.ics to import, or --json to push via the Google Calendar MCP)
  npx claude-coach export-calendar plan.json
  npx claude-coach export-calendar plan.json --json

  # Export structured workouts to create + schedule on Garmin (syncs to your watch)
  npx claude-coach export-garmin plan.json

  # Create + schedule a plan's workouts directly on Garmin (preview first with --dry-run)
  npx claude-coach garmin-push plan.json --dry-run
  npx claude-coach garmin-push plan.json

  # Upload a GPX as a Garmin course/route — kept exactly as-is, no road-snapping
  npx claude-coach garmin-route route.gpx --name="Sunday loop" --type=mtb

  # Backfill historical Garmin data (range = cheap; --full = per-day complete, resumable)
  npx claude-coach garmin-backfill --from=2026-01-01 --to=2026-06-01
  npx claude-coach garmin-backfill --from=2026-05-01 --full

  # Journal free-text feedback, then bundle the week for a summary
  npx claude-coach journal add "legs heavy, work stress" --tag=note
  npx claude-coach summary --since=2026-05-26

  # Query the database
  npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5"

  # Log wellness / hydration
  npx claude-coach log water 500
  npx claude-coach log sleep 7.5 --score=82
  npx claude-coach log energy 4

  # Set reminder preferences
  npx claude-coach config --bedtime=22:30 --water-goal=3000 --quiet-start=22:00 --quiet-end=07:00 --enable

  # Push notifications (point at your Home Assistant webhook, then send)
  npx claude-coach config --notify-webhook=https://homeassistant.local/api/webhook/abc123
  npx claude-coach notify "Time to hydrate 💧"

  # Daily check-in (reads cached Garmin signals; run garmin-fetch first, or pass them in)
  npx claude-coach checkin --plan=my-plan.json --readiness=78 --sleep-hours=7.5 --json

  # Send due reminders as push notifications (for cron); --only filters types
  npx claude-coach checkin --notify
  npx claude-coach checkin --notify --only=hydration
  npx claude-coach checkin --greeting   # one-line wellness context for a SessionStart hook

  # Pull live data straight from Garmin Connect (native TS client; needs $GARMINTOKENS)
  npx claude-coach garmin-fetch
  npx claude-coach garmin-fetch --date=2026-06-01 --json

  # Cache a Garmin snapshot you already have (when something else fetched it for you)
  npx claude-coach garmin-sync --readiness=78 --sleep-hours=7.5 --hrv-status=balanced
`);
}

// ============================================================================
// Auth Command (for headless/Claude environments)
// ============================================================================

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";

async function runAuth(args: AuthArgs): Promise<void> {
  // If code is provided, exchange it for tokens
  if (args.code) {
    if (!configExists()) {
      log.error("No configuration found. Run 'auth' with --client-id and --client-secret first.");
      process.exit(1);
    }

    // Extract code from full URL if user pasted the entire redirect URL
    let code = args.code;
    if (code.includes("localhost") || code.startsWith("http")) {
      try {
        const url = new URL(code);
        const extractedCode = url.searchParams.get("code");
        if (extractedCode) {
          code = extractedCode;
        } else {
          log.error("Could not find 'code' parameter in URL");
          process.exit(1);
        }
      } catch {
        // Not a valid URL, use as-is
      }
    }

    const config = loadConfig();
    log.start("Exchanging authorization code for tokens...");

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.strava.client_id,
        client_secret: config.strava.client_secret,
        code: code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      log.error(`Token exchange failed: ${error}`);
      process.exit(1);
    }

    const data: StravaTokenResponse = await tokenResponse.json();

    const tokens: Tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete_id: data.athlete.id,
    };

    saveTokens(tokens);
    log.success(`Authenticated as ${data.athlete.firstname} ${data.athlete.lastname}`);
    log.ready("Now run: npx claude-coach sync");
    return;
  }

  // Otherwise, generate and print the authorization URL
  if (!args.clientId || !args.clientSecret) {
    log.error("Required: --client-id and --client-secret");
    log.info("Get these from: https://www.strava.com/settings/api");
    process.exit(1);
  }

  // Save config for later use
  const config = createConfig(args.clientId, args.clientSecret, 730);
  saveConfig(config);

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", args.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "activity:read_all");
  authUrl.searchParams.set("approval_prompt", "auto");

  console.log("\n📋 AUTHORIZATION URL:\n");
  console.log(authUrl.toString());
  console.log("\n📝 INSTRUCTIONS:");
  console.log("1. Open the URL above in a browser");
  console.log("2. Click 'Authorize' on Strava");
  console.log("3. You'll be redirected to a page that won't load (that's OK!)");
  console.log("4. Copy the ENTIRE URL from your browser's address bar");
  console.log("5. Paste it back to Claude\n");
}

// ============================================================================
// Sync Command
// ============================================================================

function escapeString(str: string | null | undefined): string {
  if (str == null) return "NULL";
  return `'${str.replace(/'/g, "''")}'`;
}

async function insertActivity(activity: StravaActivity): Promise<void> {
  const sql = `
    ${getDialect().replaceVerb()} INTO activities (
      id, name, sport_type, start_date, elapsed_time, moving_time,
      distance, total_elevation_gain, average_speed, max_speed,
      average_heartrate, max_heartrate, average_watts, max_watts,
      weighted_average_watts, kilojoules, suffer_score, average_cadence,
      calories, description, workout_type, gear_id, raw_json, synced_at
    ) VALUES (
      ${activity.id},
      ${escapeString(activity.name)},
      ${escapeString(activity.sport_type)},
      ${escapeString(activity.start_date)},
      ${activity.elapsed_time ?? "NULL"},
      ${activity.moving_time ?? "NULL"},
      ${activity.distance ?? "NULL"},
      ${activity.total_elevation_gain ?? "NULL"},
      ${activity.average_speed ?? "NULL"},
      ${activity.max_speed ?? "NULL"},
      ${activity.average_heartrate ?? "NULL"},
      ${activity.max_heartrate ?? "NULL"},
      ${activity.average_watts ?? "NULL"},
      ${activity.max_watts ?? "NULL"},
      ${activity.weighted_average_watts ?? "NULL"},
      ${activity.kilojoules ?? "NULL"},
      ${activity.suffer_score ?? "NULL"},
      ${activity.average_cadence ?? "NULL"},
      ${activity.calories ?? "NULL"},
      ${escapeString(activity.description)},
      ${activity.workout_type ?? "NULL"},
      ${escapeString(activity.gear_id)},
      ${escapeString(JSON.stringify(activity))},
      ${getDialect().now()}
    );
  `;

  await execute(sql);
}

async function insertAthlete(athlete: {
  id: number;
  firstname: string;
  lastname: string;
  weight?: number;
  ftp?: number;
}): Promise<void> {
  const sql = `
    ${getDialect().replaceVerb()} INTO athlete (id, firstname, lastname, weight, ftp, raw_json, updated_at)
    VALUES (
      ${athlete.id},
      ${escapeString(athlete.firstname)},
      ${escapeString(athlete.lastname)},
      ${athlete.weight ?? "NULL"},
      ${athlete.ftp ?? "NULL"},
      ${escapeString(JSON.stringify(athlete))},
      ${getDialect().now()}
    );
  `;
  await execute(sql);
}

async function runSync(args: SyncArgs): Promise<void> {
  log.box("Claude Coach - Strava Sync");

  // Step 0: Initialize SQLite backend
  await initDatabase();

  const syncDays = args.days || 730;

  // Step 1: Handle token-based auth (no browser needed)
  if (args.accessToken && args.refreshToken) {
    log.info("Using provided access tokens...");

    // Save tokens - we'll get athlete_id after fetching profile
    // Set expiry to 1 hour from now (we have refresh token for renewal)
    const tempTokens = {
      access_token: args.accessToken,
      refresh_token: args.refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete_id: 0, // Will be updated after fetching athlete
    };
    saveTokens(tempTokens);

    // Create minimal config if needed
    if (!configExists()) {
      // Token-based auth doesn't need client credentials for initial sync
      // but we need them for token refresh - use placeholders
      const config = createConfig("token-auth", "token-auth", syncDays);
      saveConfig(config);
    }

    // Initialize database
    await migrate();

    // Fetch athlete to get ID and validate tokens
    log.start("Validating tokens and fetching athlete profile...");
    const athlete = await getAthlete(tempTokens);

    // Update tokens with real athlete ID
    const tokens = { ...tempTokens, athlete_id: athlete.id };
    saveTokens(tokens);

    await insertAthlete(athlete);
    log.success(`Authenticated as ${athlete.firstname} ${athlete.lastname}`);

    // Fetch activities
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - syncDays);
    const activities = await getAllActivities(tokens, afterDate);

    // Store activities
    log.start("Storing activities in database...");
    let count = 0;
    for (const activity of activities) {
      await insertActivity(activity);
      count++;
      if (count % 50 === 0) {
        log.progress(`   Stored ${count}/${activities.length}...`);
      }
    }
    log.progressEnd();
    log.success(`Stored ${activities.length} activities`);

    await execute(`
      INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
      VALUES (${getDialect().now()}, ${getDialect().now()}, ${activities.length}, 'success');
    `);

    log.info(`Database: ${getDbPath()}`);
    log.ready("Sync complete! You can now create training plans.");
    return;
  }

  // Step 2: OAuth-based auth (requires browser)
  if (!configExists()) {
    if (args.clientId && args.clientSecret) {
      log.info("Creating configuration from command line arguments...");
      const config = createConfig(args.clientId, args.clientSecret, syncDays);
      saveConfig(config);
      log.success("Configuration saved");
    } else {
      log.info("No configuration found. Let's set things up.");
      const config = await promptForConfig();
      saveConfig(config);
      log.success("Configuration saved");
    }
  }

  const config = loadConfig();
  const configSyncDays = args.days || config.sync_days || 730;

  // Initialize database
  await migrate();

  // Authenticate with Strava (opens browser)
  const tokens = await getValidTokens();

  // Step 4: Fetch and store athlete profile
  log.start("Fetching athlete profile...");
  const athlete = await getAthlete(tokens);
  await insertAthlete(athlete);
  log.success(`Athlete: ${athlete.firstname} ${athlete.lastname}`);

  // Step 5: Fetch activities
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - configSyncDays);

  const activities = await getAllActivities(tokens, afterDate);

  // Step 6: Store activities
  log.start("Storing activities in database...");
  let count = 0;
  for (const activity of activities) {
    await insertActivity(activity);
    count++;
    if (count % 50 === 0) {
      log.progress(`   Stored ${count}/${activities.length}...`);
    }
  }
  log.progressEnd();
  log.success(`Stored ${activities.length} activities`);

  // Step 7: Log sync
  await execute(`
    INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
    VALUES (${getDialect().now()}, ${getDialect().now()}, ${activities.length}, 'success');
  `);

  log.info(`Database: ${getDbPath()}`);
  log.ready(`Query with: sqlite3 -json "${getDbPath()}" "SELECT * FROM weekly_volume"`);
}

// ============================================================================
// Render Command
// ============================================================================

function getTemplatePath(): string {
  // Look for template in multiple locations
  const locations = [
    join(__dirname, "..", "templates", "plan-viewer.html"),
    join(__dirname, "..", "..", "templates", "plan-viewer.html"),
    join(process.cwd(), "templates", "plan-viewer.html"),
  ];

  for (const loc of locations) {
    try {
      readFileSync(loc);
      return loc;
    } catch {
      // Continue to next location
    }
  }

  throw new Error("Could not find plan-viewer.html template");
}

interface CalendarEvent {
  date: string;
  title: string;
  sport: string;
  durationMinutes?: number;
  description: string;
}

/** Flatten a training plan into one calendar event per non-rest workout.
 *  Goes through planDays/normalizeWorkout so it handles both plan shapes. */
function planToEvents(plan: TrainingPlan): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const day of planDays(plan)) {
    for (const w of day.workouts) {
      if (!w.sport || w.sport === "rest") continue;
      const n = normalizeWorkout(w);
      const parts: string[] = [];
      if (n.description) parts.push(n.description);
      if (n.humanReadable) parts.push(n.humanReadable);
      if (n.primaryZone) parts.push(`Primary zone: ${n.primaryZone}`);
      events.push({
        date: day.date,
        title: `${getSportIcon(n.sport as Parameters<typeof getSportIcon>[0])} ${n.name}`.trim(),
        sport: n.sport,
        durationMinutes: n.durationMinutes,
        description: parts.join("\n\n"),
      });
    }
  }
  return events;
}

/**
 * Read a plan JSON document either inline from stdin (--stdin, how the MCP passes
 * content generated in-conversation) or from a file path, and parse it. Centralizes
 * the read so every plan command (export-calendar, export-garmin, garmin-push,
 * checkin) works over MCP without the file having to live on the server.
 */
function readPlanJson(inputFile: string, fromStdin: boolean): TrainingPlan {
  let raw: string;
  if (fromStdin) {
    try {
      raw = readFileSync(0, "utf-8"); // fd 0 = stdin (plan content piped in, e.g. by the MCP)
    } catch {
      log.error("--stdin: could not read plan JSON from stdin");
      process.exit(1);
    }
  } else {
    try {
      raw = readFileSync(inputFile, "utf-8");
    } catch {
      log.error(`Could not read plan JSON: ${inputFile}`);
      process.exit(1);
    }
  }
  try {
    return JSON.parse(raw) as TrainingPlan;
  } catch {
    log.error("Could not parse plan JSON (invalid JSON).");
    process.exit(1);
  }
}

/**
 * Resolve a plan for the plan-consuming commands (export-calendar/-garmin,
 * garmin-push, checkin): inline stdin, a file path, or — the default, and what
 * `--active` selects — the stored active plan. Exits clearly if none is found.
 */
async function resolvePlan(opts: { inputFile?: string; stdin?: boolean }): Promise<TrainingPlan> {
  if (opts.stdin) return readPlanJson("", true);
  if (opts.inputFile) return readPlanJson(opts.inputFile, false);
  await ensureDb();
  const plan = await getActivePlan();
  if (!plan) {
    log.error(
      "No plan given and no active plan stored — save one with `plan save`, or pass a file / --stdin."
    );
    process.exit(1);
  }
  return plan;
}

async function runExportCalendar(args: ExportCalendarArgs): Promise<void> {
  const plan = await resolvePlan({ inputFile: args.inputFile, stdin: args.stdin });

  // --json: emit a clean event list for an agent to push via the Google Calendar MCP.
  if (args.json) {
    console.log(JSON.stringify(planToEvents(plan), null, 2));
    return;
  }

  // Default: write an .ics the user can import into any calendar.
  const ics = generateIcs(plan);
  const outPath =
    args.outputFile ?? (args.inputFile ? args.inputFile.replace(/\.json$/i, "") : "plan") + ".ics";
  writeFileSync(outPath, ics);
  log.success(`Wrote ${planToEvents(plan).length} workouts to ${outPath}`);
  log.info(
    "Import this .ics into your calendar, or ask Claude to push them to your linked Google Calendar."
  );
}

interface GarminWorkoutExport {
  date: string;
  key: string;
  sport: string;
  type: string;
  name: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  targetHR?: { low: number; high: number };
  targetPace?: { low: string; high: string };
  targetPower?: { low: number; high: number };
  rpe?: number;
  structure?: unknown;
  humanReadable?: string;
}

/** Normalize a plan into per-workout records an agent can feed to the Garmin workout
 *  builders. Goes through planDays/normalizeWorkout so it handles both plan shapes. */
function planToGarminWorkouts(plan: TrainingPlan): GarminWorkoutExport[] {
  return keyedPlanWorkouts(plan).map(({ date, workout, key }) => {
    const n = normalizeWorkout(workout);
    return {
      date,
      key,
      sport: n.sport,
      type: n.type ?? "",
      name: n.name,
      durationMinutes: n.durationMinutes,
      distanceMeters: n.distanceMeters,
      primaryZone: n.primaryZone,
      targetHR: n.targetHR,
      targetPace: n.targetPace,
      targetPower: n.targetPower,
      rpe: n.rpe,
      structure: n.structure,
      humanReadable: n.humanReadable,
    };
  });
}

async function runExportGarmin(args: ExportGarminArgs): Promise<void> {
  const plan = await resolvePlan({ inputFile: args.inputFile, stdin: args.stdin });
  // A structured workout feed (also consumed by `garmin-push` to create + schedule
  // these on Garmin Connect natively, which then syncs them to the watch).
  console.log(JSON.stringify(planToGarminWorkouts(plan), null, 2));
}

async function runGarminPush(args: GarminPushArgs): Promise<void> {
  const explicitPlan = Boolean(args.flags["stdin"]) || Boolean(args.inputFile);
  const plan = await resolvePlan({
    inputFile: args.inputFile,
    stdin: Boolean(args.flags["stdin"]),
  });
  const dryRun = Boolean(args.flags["dry-run"]);

  // Pushing an explicit plan to Garmin means "this is my plan" — so register it
  // as the active plan (the app + future pushes read it). Skip on --dry-run (a
  // preview shouldn't mutate state) and on --active (it's already the stored plan).
  if (!dryRun && explicitPlan && plan.meta?.id) {
    await ensureDb();
    await savePlan(plan);
  }

  // Optional date window so a request can push just an upcoming block.
  const from = flagStr(args.flags, "from");
  const to = flagStr(args.flags, "to");
  let inputs: WorkoutInput[] = planToGarminWorkouts(plan).map((w) => ({
    date: w.date,
    key: w.key,
    sport: w.sport,
    name: w.name,
    durationMinutes: w.durationMinutes,
    distanceMeters: w.distanceMeters,
    targetHR: w.targetHR,
    targetPace: w.targetPace,
    targetPower: w.targetPower,
    structure: w.structure as WorkoutInput["structure"],
    zones: plan.zones,
  }));
  if (from) inputs = inputs.filter((i) => !i.date || i.date >= from);
  if (to) inputs = inputs.filter((i) => !i.date || i.date <= to);

  // Never fail silently: report an explicit, structured "nothing to push".
  if (inputs.length === 0) {
    const reason =
      from || to
        ? `the active plan has no workouts in ${from ?? "…"}..${to ?? "…"}`
        : "the plan has no non-rest workouts to push";
    const summary = {
      pushed: 0,
      failed: 0,
      planId: plan.meta?.id ?? null,
      dateRange: { from: from ?? null, to: to ?? null },
      reason,
    };
    if (args.flags["json"] || dryRun) console.log(JSON.stringify(summary, null, 2));
    else log.warn(`Nothing to push — ${reason}.`);
    return;
  }

  let results;
  try {
    // Live pushes use coach.db to dedup (update in place instead of duplicating).
    let store: PushStore | undefined;
    if (!dryRun) {
      await ensureDb();
      store = { lookup: lookupPushedWorkout, save: savePushedWorkout };
    }
    results = await pushWorkouts(inputs, { dryRun, store, planId: plan.meta?.id });
  } catch (e) {
    log.error(`garmin-push: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (args.flags["json"] || dryRun) {
    const pushed = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => r.error).length;
    console.log(
      JSON.stringify(
        {
          pushed,
          failed,
          dryRun,
          planId: plan.meta?.id ?? null,
          dateRange: { from: from ?? null, to: to ?? null },
          results,
        },
        null,
        2
      )
    );
    if (dryRun && !args.flags["json"])
      log.info(`Dry run — built ${results.length} workout payload(s), pushed nothing.`);
    return;
  }

  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  for (const r of ok) {
    log.success(
      `${r.name}${r.date ? ` (${r.date})` : ""} → workout ${r.workoutId}${
        r.scheduleId ? `, scheduled` : ""
      }`
    );
  }
  for (const r of failed) log.error(`${r.name}: ${r.error}`);
  log.info(`Pushed ${ok.length}/${results.length} workout(s) to Garmin.`);
}

async function runGarminRoute(args: GarminRouteArgs): Promise<void> {
  let gpx: string;
  if (args.flags["stdin"]) {
    try {
      gpx = readFileSync(0, "utf-8"); // fd 0 = stdin (GPX content piped in, e.g. by the MCP)
    } catch {
      log.error("garmin-route --stdin: could not read GPX from stdin");
      process.exit(1);
    }
  } else {
    try {
      gpx = readFileSync(args.inputFile, "utf-8");
    } catch {
      log.error(`Could not read GPX file: ${args.inputFile}`);
      process.exit(1);
    }
  }

  const name = flagStr(args.flags, "name");
  const type = flagStr(args.flags, "type");
  const dryRun = Boolean(args.flags["dry-run"]);

  let result;
  try {
    result = await uploadRoute({ gpx, name, type, dryRun });
  } catch (e) {
    log.error(`garmin-route: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (args.flags["json"] || dryRun) {
    console.log(JSON.stringify(result, null, 2));
    if (dryRun) {
      log.info(
        `Dry run — parsed ${result.points} points, uploaded nothing. (types: ${COURSE_TYPES})`
      );
    }
    return;
  }
  log.success(
    `Uploaded "${result.name}" (${result.points} points${
      result.type ? `, ${result.type}` : ""
    }) → course ${result.courseId}`
  );
}

async function runGarminBackfill(args: GarminBackfillArgs): Promise<void> {
  await ensureDb();
  const to = flagStr(args.flags, "to") ?? localDate();
  let from = flagStr(args.flags, "from");
  const days = flagNum(args.flags, "days");
  if (!from && days) {
    const d = new Date(to + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - Math.round(days));
    from = d.toISOString().slice(0, 10);
  }
  if (!from) {
    log.error(
      "garmin-backfill requires --from=YYYY-MM-DD or --days=N (and optional --to, default today)"
    );
    process.exit(1);
  }
  const full = Boolean(args.flags["full"]);
  const force = Boolean(args.flags["force"]);
  const delayMs = flagNum(args.flags, "delay-ms");

  const sink: BackfillSink = {
    saveWellness: (date, patch) => upsertWellness(date, patch as WellnessPatch),
    saveActivity: (a) => insertGarminActivity(a),
    hasFullSnapshot: async (date) => Boolean((await getWellness(date))?.garmin_raw),
  };

  log.start(`Backfilling Garmin ${from} → ${to}${full ? " (--full, per-day)" : " (range)"}…`);
  let res;
  try {
    res = await runBackfill({ from, to, full, force, delayMs }, sink);
  } catch (e) {
    log.error(`garmin-backfill: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (args.flags["json"]) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  log.success(
    `Backfill done: ${res.activities} activities, ${
      full
        ? `${res.fullDays} full days (${res.skipped} already had data)`
        : `${res.wellnessDays} wellness days`
    }.`
  );
  if (res.errors.length)
    log.warn(`${res.errors.length} non-fatal errors (first: ${res.errors[0]})`);

  // A --full backfill is the "complete" pass: also sweep any activities still
  // missing a GPS track (e.g. a daily fetch that ran before the track-pull
  // existed, or whose track fetch failed). NULL-only, so it's cheap once caught
  // up. Opt out with --no-tracks.
  if (full && !args.flags["no-tracks"]) {
    try {
      const missing = await queryJson<{ id: number }>(
        `SELECT id FROM activities WHERE gps_track IS NULL ORDER BY start_date DESC;`
      );
      if (missing.length > 0) {
        log.start(`Sweeping GPS tracks for ${missing.length} activities without one…`);
        const client = await GarminClient.create();
        const t = await fillTracks(
          client,
          missing.map((m) => m.id),
          flagNum(args.flags, "delay-ms") ?? 600
        );
        log.success(
          `GPS track sweep: ${t.withTrack} routes, ${t.empty} no-GPS, ${t.errors} errors.`
        );
      }
    } catch (e) {
      log.warn(`track sweep skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Fetch + store the GPS track for each given activity id (compact polyline).
 * Defensive per activity (never throws); throttled between calls. Shared by the
 * `garmin-tracks` backfill and the nightly `garmin-backfill --full` track sweep.
 */
async function fillTracks(
  client: GarminClient,
  ids: Array<number | string>,
  delayMs: number
): Promise<{ withTrack: number; empty: number; errors: number }> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let withTrack = 0;
  let empty = 0;
  let errors = 0;
  for (const id of ids) {
    try {
      const points = decimate(await fetchActivityTrack(client, id));
      await execute(
        `UPDATE activities SET gps_track = ${escapeString(toCompactTrack(points))} WHERE id = ${Math.trunc(Number(id))};`
      );
      if (points.length >= 2) withTrack++;
      else empty++;
    } catch {
      errors++;
    }
    await sleep(delayMs);
  }
  return { withTrack, empty, errors };
}

/**
 * Download + store each activity's GPS track (one compact polyline per activity),
 * for the map + "create a course from this activity" features. Resumable (skips
 * activities that already have a track unless --force), throttled with 429 backoff.
 */
async function runGarminTracks(args: GarminTracksArgs): Promise<void> {
  await ensureDb();
  const force = Boolean(args.flags["force"]);
  const limit = flagNum(args.flags, "limit");
  const onlyId = flagStr(args.flags, "id");
  const delayMs = flagNum(args.flags, "delay-ms") ?? 600;

  const where = onlyId ? `id = ${Math.trunc(Number(onlyId))}` : force ? "1=1" : "gps_track IS NULL";
  const rows = await queryJson<{ id: number }>(
    `SELECT id FROM activities WHERE ${where} ORDER BY start_date DESC${limit ? ` LIMIT ${Math.round(limit)}` : ""};`
  );
  if (rows.length === 0) {
    log.success("No activities need a GPS track.");
    return;
  }

  const client = await GarminClient.create();
  log.start(`Fetching GPS tracks for ${rows.length} activities…`);
  const { withTrack, empty, errors } = await fillTracks(
    client,
    rows.map((r) => r.id),
    delayMs
  );
  const result = { processed: rows.length, withTrack, empty, errors };
  if (args.flags["json"]) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  log.success(
    `GPS tracks: ${withTrack} with a route, ${empty} without (indoor/no-GPS), ${errors} errors.`
  );
}

/**
 * Fetch + store one activity's real splits + HR/pace streams. Returns whether
 * real data was found (so callers can tally). Defensive — never throws.
 */
async function storeActivityStreams(
  client: GarminClient,
  id: number
): Promise<"data" | "empty" | "error"> {
  try {
    const s = await fetchActivityStreams(client, id);
    await execute(
      `UPDATE activities SET activity_streams = ${escapeString(toCompactStreams(s))} WHERE id = ${Math.trunc(id)};`
    );
    return s.splits.length > 0 || s.hr.length > 0 ? "data" : "empty";
  } catch {
    return "error";
  }
}

/**
 * Download + store each activity's real splits + HR/pace streams (one compact
 * JSON blob per activity), for the activity-detail screen. Resumable (skips
 * activities that already have streams unless --force), throttled with 429 backoff.
 */
async function runGarminStreams(args: GarminStreamsArgs): Promise<void> {
  await ensureDb();
  const force = Boolean(args.flags["force"]);
  const limit = flagNum(args.flags, "limit");
  const onlyId = flagStr(args.flags, "id");
  const delayMs = flagNum(args.flags, "delay-ms") ?? 600;

  const where = onlyId
    ? `id = ${Math.trunc(Number(onlyId))}`
    : force
      ? "1=1"
      : "activity_streams IS NULL";
  const rows = await queryJson<{ id: number }>(
    `SELECT id FROM activities WHERE ${where} ORDER BY start_date DESC${limit ? ` LIMIT ${Math.round(limit)}` : ""};`
  );
  if (rows.length === 0) {
    log.success("No activities need splits/streams.");
    return;
  }

  const client = await GarminClient.create();
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let withData = 0;
  let empty = 0;
  let errors = 0;
  log.start(`Fetching splits + HR streams for ${rows.length} activities…`);
  for (const r of rows) {
    const res = await storeActivityStreams(client, r.id);
    if (res === "data") withData++;
    else if (res === "empty") empty++;
    else errors++;
    await sleep(delayMs);
  }
  const result = { processed: rows.length, withData, empty, errors };
  if (args.flags["json"]) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  log.success(
    `Streams: ${withData} with splits/HR, ${empty} without (indoor/no-stream), ${errors} errors.`
  );
}

async function runJournal(args: JournalArgs): Promise<void> {
  await ensureDb();
  if (args.sub === "add") {
    if (!args.text) {
      log.error('journal add needs text, e.g. journal add "legs felt heavy on the climb"');
      process.exit(1);
    }
    await addJournalEntry(args.text, {
      date: flagStr(args.flags, "date"),
      tag: flagStr(args.flags, "tag"),
    });
    log.success("Journaled 📝");
    return;
  }
  if (args.sub === "list") {
    const entries = await listJournalEntries({
      since: flagStr(args.flags, "since"),
      until: flagStr(args.flags, "until"),
      limit: flagNum(args.flags, "limit"),
    });
    if (args.flags["json"]) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      log.info("No journal entries.");
      return;
    }
    for (const e of entries) {
      console.log(`${e.local_date}${e.tag ? ` [${e.tag}]` : ""}: ${e.entry}`);
    }
    return;
  }
  log.error('journal: use `journal add "…"` or `journal list [--since=YYYY-MM-DD]`');
  process.exit(1);
}

/** Data provider for a period summary: journal entries + daily wellness as JSON
 *  (Claude composes the prose summary; this just bundles the inputs). */
async function runSummary(args: SummaryArgs): Promise<void> {
  await ensureDb();
  const until = flagStr(args.flags, "to") ?? localDate();
  let since = flagStr(args.flags, "since");
  if (!since) {
    const d = new Date(until + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 6); // default: the last 7 days inclusive
    since = d.toISOString().slice(0, 10);
  }
  const journal = await listJournalEntries({ since, until });
  const wellness = await queryJson(
    `SELECT * FROM wellness_state WHERE local_date >= ${escapeString(since)}
     AND local_date <= ${escapeString(until)} ORDER BY local_date;`
  );
  console.log(JSON.stringify({ since, until, journal, wellness }, null, 2));
}

function runRender(args: RenderArgs): void {
  log.start("Rendering training plan...");

  // Read the plan JSON
  let planJson: string;
  try {
    planJson = readFileSync(args.inputFile, "utf-8");
  } catch (err) {
    log.error(`Could not read input file: ${args.inputFile}`);
    process.exit(1);
  }

  // Validate it's valid JSON
  try {
    JSON.parse(planJson);
  } catch (err) {
    log.error("Input file is not valid JSON");
    process.exit(1);
  }

  // Read the template
  const templatePath = getTemplatePath();
  let template = readFileSync(templatePath, "utf-8");

  // Replace the plan data in the template
  const planDataRegex = /<script type="application\/json" id="plan-data">[\s\S]*?<\/script>/;
  const newPlanData = `<script type="application/json" id="plan-data">\n${planJson}\n</script>`;
  template = template.replace(planDataRegex, newPlanData);

  // Output
  if (args.outputFile) {
    writeFileSync(args.outputFile, template);
    log.success(`Training plan rendered to: ${args.outputFile}`);
  } else {
    // Output to stdout
    console.log(template);
  }
}

// ============================================================================
// Query Command
// ============================================================================

async function runQuery(args: QueryArgs): Promise<void> {
  await initDatabase();

  if (args.json) {
    const results = await queryJson(args.sql);
    console.log(JSON.stringify(results, null, 2));
  } else {
    const result = await query(args.sql);
    console.log(result);
  }
}

// ============================================================================
// Wellness CLI: log / config / wellness / checkin
// ============================================================================

/** Open the DB and ensure the (idempotent) schema, quietly. */
async function ensureDb(): Promise<void> {
  await initDatabase();
  await migrate(true);
}

function nowLocalMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function clampScale(value: number, label: string): number {
  if (value < 1 || value > 5) {
    log.error(`${label} must be between 1 and 5`);
    process.exit(1);
  }
  return Math.round(value);
}

const LOG_TYPES = "water, sleep, energy, soreness, mood, weight";

async function runLog(args: LogArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();
  const note = flagStr(args.flags, "note");
  const type = args.type.toLowerCase();

  if (args.value === undefined) {
    log.error(`log ${type} requires a value, e.g. 'log ${type} <value>'`);
    process.exit(1);
  }
  const num = Number(args.value);
  const requireNum = () => {
    if (!Number.isFinite(num)) {
      log.error(`'${args.value}' is not a number`);
      process.exit(1);
    }
    return num;
  };

  switch (type) {
    case "water":
    case "hydration": {
      const ml = Math.round(requireNum());
      if (ml <= 0) {
        log.error("water amount must be positive (ml)");
        process.exit(1);
      }
      await logHydration(ml, { date, source: flagStr(args.flags, "source") ?? "manual", note });
      const total = await hydrationTotal(date);
      const goal = (await getPrefs()).hydration_goal_ml;
      log.success(`Logged ${ml} ml water — ${total}/${goal} ml today (${date}).`);
      break;
    }
    case "sleep": {
      const patch: WellnessPatch = { sleep_hours: requireNum() };
      const score = flagNum(args.flags, "score");
      if (score !== undefined) patch.sleep_score = Math.round(score);
      if (note) patch.notes = note;
      await upsertWellness(date, patch);
      log.success(
        `Logged ${patch.sleep_hours} h sleep${score !== undefined ? ` (score ${score})` : ""} for ${date}.`
      );
      break;
    }
    case "energy":
    case "soreness":
    case "mood": {
      const col = type === "energy" ? "subjective_energy" : type;
      const v = clampScale(requireNum(), type);
      await upsertWellness(date, { [col]: v } as WellnessPatch);
      log.success(`Logged ${type} ${v}/5 for ${date}.`);
      break;
    }
    case "weight": {
      await upsertWellness(date, { weight_kg: requireNum() });
      log.success(`Logged weight ${requireNum()} kg for ${date}.`);
      break;
    }
    default:
      log.error(`Unknown log type '${type}'. Supported: ${LOG_TYPES}.`);
      process.exit(1);
  }
}

async function runConfig(args: ConfigArgs): Promise<void> {
  await ensureDb();

  const patch: PrefsPatch = {};
  const setTime = (flag: string, col: keyof PrefsPatch) => {
    const v = flagStr(args.flags, flag);
    if (v === undefined) return;
    if (parseHHMM(v) === null) {
      log.error(`--${flag} must be HH:MM (24h), got '${v}'`);
      process.exit(1);
    }
    (patch as Record<string, unknown>)[col] = v;
  };

  setTime("bedtime", "bedtime_target");
  setTime("wake", "wake_target");
  setTime("quiet-start", "quiet_hours_start");
  setTime("quiet-end", "quiet_hours_end");

  const waterGoal = flagNum(args.flags, "water-goal");
  if (waterGoal !== undefined) patch.hydration_goal_ml = Math.round(waterGoal);
  const cadence = flagNum(args.flags, "cadence");
  if (cadence !== undefined) patch.water_cadence_minutes = Math.round(cadence);
  const moveCadence = flagNum(args.flags, "move-cadence");
  if (moveCadence !== undefined) patch.move_cadence_minutes = Math.max(0, Math.round(moveCadence));
  const hydrationPerHour = flagNum(args.flags, "hydration-per-hour");
  if (hydrationPerHour !== undefined)
    patch.hydration_per_active_hour_ml = Math.round(hydrationPerHour);
  const tz = flagStr(args.flags, "timezone");
  if (tz !== undefined) patch.timezone = tz;
  if (args.flags["enable"]) patch.reminders_enabled = 1;
  if (args.flags["disable"]) patch.reminders_enabled = 0;
  const notifyWebhook = flagStr(args.flags, "notify-webhook");
  if (notifyWebhook !== undefined) patch.notify_webhook_url = notifyWebhook;
  const notifyChannel = flagStr(args.flags, "notify-channel");
  if (notifyChannel !== undefined) patch.notify_channel = notifyChannel.toLowerCase();

  if (Object.keys(patch).length > 0) {
    await updatePrefs(patch);
  }

  const prefs = await getPrefs();
  if (args.flags["json"]) {
    console.log(JSON.stringify(prefs, null, 2));
    return;
  }
  // Report the EFFECTIVE notify config: env (COACH_NOTIFY_*) overrides the DB at
  // runtime, so show what reminders will actually use — not just the stored row.
  const effChannel = process.env.COACH_NOTIFY_CHANNEL ?? prefs.notify_channel;
  const effWebhook = process.env.COACH_NOTIFY_WEBHOOK_URL ?? prefs.notify_webhook_url;
  const webhookNote = effWebhook
    ? ` (webhook set${process.env.COACH_NOTIFY_WEBHOOK_URL ? ", from env" : ""})`
    : " (no webhook)";
  log.box(
    [
      "Reminder preferences",
      `  Reminders:     ${prefs.reminders_enabled ? "enabled" : "disabled"}`,
      `  Bedtime:       ${prefs.bedtime_target ?? "—"}`,
      `  Wake:          ${prefs.wake_target ?? "—"}`,
      `  Water goal:    ${prefs.hydration_goal_ml} ml/day`,
      `  Water cadence: every ${prefs.water_cadence_minutes} min`,
      `  Water +load:   +${prefs.hydration_per_active_hour_ml} ml / training hour`,
      `  Move cadence:  ${prefs.move_cadence_minutes > 0 ? `every ${prefs.move_cadence_minutes} min` : "off"}`,
      `  Quiet hours:   ${prefs.quiet_hours_start ?? "—"}–${prefs.quiet_hours_end ?? "—"}`,
      `  Timezone:      ${prefs.timezone ?? "(host default)"}`,
      `  Notify:        ${effChannel}${webhookNote}`,
    ].join("\n")
  );
  if (Object.keys(patch).length === 0) {
    log.info(
      "Update with flags, e.g. --bedtime=22:30 --water-goal=3000 --quiet-start=22:00 --quiet-end=07:00 --enable"
    );
  }
}

async function runGarminSync(args: GarminSyncArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();
  const patch: WellnessPatch = {};
  const setInt = (flag: string, col: keyof WellnessPatch) => {
    const v = flagNum(args.flags, flag);
    if (v !== undefined) (patch as Record<string, unknown>)[col] = Math.round(v);
  };

  setInt("readiness", "readiness_score");
  setInt("training-minutes", "training_minutes");
  setInt("sleep-score", "sleep_score");
  setInt("body-battery", "body_battery_morning");
  setInt("resting-hr", "resting_hr");
  const sleepHours = flagNum(args.flags, "sleep-hours");
  if (sleepHours !== undefined) patch.sleep_hours = sleepHours;
  const weight = flagNum(args.flags, "weight-kg");
  if (weight !== undefined) patch.weight_kg = weight;
  const hrvStatus = flagStr(args.flags, "hrv-status");
  if (hrvStatus !== undefined) patch.hrv_status = hrvStatus;
  const trainingStatus = flagStr(args.flags, "training-status");
  if (trainingStatus !== undefined) patch.training_status = trainingStatus;

  if (Object.keys(patch).length === 0) {
    log.error(
      "garmin-sync needs at least one metric, e.g. --readiness=78 --sleep-hours=7.5 --hrv-status=balanced"
    );
    process.exit(1);
  }

  await upsertWellness(date, patch);
  const snapshot = await getWellness(date);
  if (args.flags["json"]) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  log.success(`Cached Garmin snapshot for ${date}: ${Object.keys(patch).join(", ")}.`);
}

// ----------------------------------------------------------------------------
// garmin-fetch: the *real* Garmin sync. Pulls a day's snapshot straight from
// Garmin Connect (src/garmin, using $GARMINTOKENS), then ingests the wellness
// snapshot + recent activities through the tested DB upsert paths.
// ----------------------------------------------------------------------------

/** Numeric/text wellness columns the fetcher is allowed to write. */
const GARMIN_FETCH_NUMERIC = [
  "readiness_score",
  "sleep_hours",
  "sleep_score",
  "body_battery_morning",
  "resting_hr",
  "hrv_weekly_avg",
  "hrv_baseline_low",
  "hrv_baseline_upper",
  "avg_stress",
  "acwr",
  "acute_load",
  "chronic_load",
  "vo2max",
  "total_steps",
  "total_distance_m",
  "floors_climbed",
  "intensity_min_moderate",
  "intensity_min_vigorous",
  "active_calories",
  "total_calories",
  "avg_spo2",
  "avg_waking_respiration",
  "rhr_7day_avg",
  "body_battery_charged",
] as const;
const GARMIN_FETCH_TEXT = ["hrv_status", "training_status", "garmin_raw"] as const;

function sqlNum(value: unknown): string {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? "NULL" : String(n);
}

async function insertGarminActivity(a: Record<string, unknown>): Promise<void> {
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  await execute(
    `${getDialect().replaceVerb()} INTO activities (
       id, name, sport_type, start_date, elapsed_time, moving_time,
       distance, total_elevation_gain, average_speed, max_speed,
       average_heartrate, max_heartrate, average_cadence, calories,
       raw_json, synced_at
     ) VALUES (
       ${sqlNum(a.id)}, ${escapeString(str(a.name))}, ${escapeString(str(a.sport_type))},
       ${escapeString(str(a.start_date))}, ${sqlNum(a.elapsed_time)}, ${sqlNum(a.moving_time)},
       ${sqlNum(a.distance)}, ${sqlNum(a.total_elevation_gain)}, ${sqlNum(a.average_speed)},
       ${sqlNum(a.max_speed)}, ${sqlNum(a.average_heartrate)}, ${sqlNum(a.max_heartrate)},
       ${sqlNum(a.average_cadence)}, ${sqlNum(a.calories)},
       ${escapeString(JSON.stringify(a.raw ?? a))}, ${getDialect().now()}
     );`
  );
}

async function runGarminFetch(args: GarminFetchArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();

  let payload: DailySnapshot;
  try {
    payload = await getDataSource().fetchDailySnapshot(date);
  } catch (e) {
    log.error(`garmin-fetch: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Ingest the wellness snapshot (only the whitelisted, well-typed fields).
  const patch: WellnessPatch = {};
  for (const col of GARMIN_FETCH_NUMERIC) {
    const v = payload.wellness?.[col];
    if (typeof v === "number" && Number.isFinite(v)) (patch as Record<string, unknown>)[col] = v;
  }
  for (const col of GARMIN_FETCH_TEXT) {
    const v = payload.wellness?.[col];
    if (typeof v === "string" && v) (patch as Record<string, unknown>)[col] = v;
  }
  if (Object.keys(patch).length > 0) await upsertWellness(payload.date, patch);

  // Ingest recent activities (skip any without a usable id).
  let stored = 0;
  const ids: number[] = [];
  for (const a of payload.activities ?? []) {
    if (a.id == null || !Number.isFinite(Number(a.id))) continue;
    await insertGarminActivity(a);
    ids.push(Math.trunc(Number(a.id)));
    stored++;
  }

  // Pull each new activity's GPS track + splits/HR streams now, so the web app
  // reads them from the DB instead of a live Garmin call on first view. Bounded
  // to the just-ingested activities, throttled, non-fatal, skips ones already
  // populated. `--no-streams` opts out (e.g. a fast wellness-only refresh).
  let streamed = 0;
  let tracked = 0;
  if (ids.length > 0 && !args.flags["no-streams"]) {
    try {
      const idSet = (col: string): Promise<Set<number>> =>
        queryJson<{ id: number }>(
          `SELECT id FROM activities WHERE ${col} IS NOT NULL AND id IN (${ids.join(",")});`
        ).then((rows) => new Set(rows.map((r) => r.id)));
      const haveStreams = await idSet("activity_streams");
      const haveTracks = await idSet("gps_track");
      const todo = ids.filter((id) => !haveStreams.has(id) || !haveTracks.has(id));
      if (todo.length > 0) {
        const client = await GarminClient.create();
        for (const id of todo) {
          if (!haveTracks.has(id)) {
            try {
              const points = decimate(await fetchActivityTrack(client, id));
              await execute(
                `UPDATE activities SET gps_track = ${escapeString(toCompactTrack(points))} WHERE id = ${id};`
              );
              if (points.length >= 2) tracked++;
            } catch {
              /* non-fatal */
            }
          }
          if (!haveStreams.has(id) && (await storeActivityStreams(client, id)) === "data") {
            streamed++;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {
      /* non-fatal: the app's lazy fetch + the garmin-streams/garmin-tracks backfills still cover it */
    }
  }

  if (args.flags["json"]) {
    console.log(
      JSON.stringify(
        {
          date: payload.date,
          wellness: patch,
          activitiesStored: stored,
          streamsStored: streamed,
          tracksStored: tracked,
          errors: payload.errors,
        },
        null,
        2
      )
    );
    return;
  }

  const fields = Object.keys(patch);
  if (fields.length === 0 && stored === 0) {
    log.warn(
      `garmin-fetch: nothing stored for ${payload.date}.${
        payload.errors?.length ? ` (${payload.errors.join("; ")})` : ""
      }`
    );
    process.exit(1);
  }
  log.success(
    `Garmin fetch ${payload.date}: ${fields.length} wellness field(s) [${fields.join(", ") || "—"}], ${stored} activit${stored === 1 ? "y" : "ies"}.`
  );
  if (payload.errors?.length)
    log.warn(`Partial (some metrics skipped): ${payload.errors.join("; ")}`);
}

async function runNotify(args: NotifyArgs): Promise<void> {
  await ensureDb();
  const prefs = await getPrefs();
  const message = args.message ?? flagStr(args.flags, "message");
  if (!message) {
    log.error('notify requires a message, e.g. coach notify "Time to hydrate"');
    process.exit(1);
  }
  const title = flagStr(args.flags, "title") ?? "Claude Coach";
  const resolved = resolveNotify({
    channel:
      flagStr(args.flags, "channel") ?? process.env.COACH_NOTIFY_CHANNEL ?? prefs.notify_channel,
    webhookUrl:
      flagStr(args.flags, "url") ??
      process.env.COACH_NOTIFY_WEBHOOK_URL ??
      prefs.notify_webhook_url,
  });
  const result = await sendNotification(message, title, resolved);
  await logNotify("manual", resolved.channel, result.ok, result.detail);

  // Fan out to PWA web-push too, unless a channel was explicitly forced.
  let pushed = 0;
  if (!flagStr(args.flags, "channel") && webPushConfigured()) {
    const wp = await sendWebPush(title, message);
    pushed = wp.sent;
    await logNotify("manual", "webpush", wp.sent > 0, wp.detail);
  }

  if (result.ok || pushed > 0) {
    log.success(
      `Notified via ${resolved.channel} (${result.detail})${pushed > 0 ? ` + ${pushed} PWA push` : ""}.`
    );
  } else {
    log.error(`Notify failed via ${resolved.channel}: ${result.detail}`);
    process.exit(1);
  }
}

async function runWellness(args: WellnessArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();
  const prefs = await getPrefs();
  const wellness = await getWellness(date);
  const total = await hydrationTotal(date);
  const summary = {
    date,
    hydration: {
      total_ml: total,
      goal_ml: prefs.hydration_goal_ml,
      remaining_ml: Math.max(0, prefs.hydration_goal_ml - total),
    },
    wellness,
  };

  if (args.flags["json"]) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  log.box(
    [
      `Wellness — ${date}`,
      `  Water:     ${total}/${prefs.hydration_goal_ml} ml`,
      `  Sleep:     ${wellness?.sleep_hours ?? "—"} h${wellness?.sleep_score != null ? ` (score ${wellness.sleep_score})` : ""}`,
      `  Readiness: ${wellness?.readiness_score ?? "—"}`,
      `  Energy:    ${wellness?.subjective_energy ?? "—"}/5   Soreness: ${wellness?.soreness ?? "—"}/5   Mood: ${wellness?.mood ?? "—"}/5`,
      `  RHR:       ${wellness?.resting_hr ?? "—"}   HRV: ${wellness?.hrv_status ?? "—"}`,
      `  Weight:    ${wellness?.weight_kg ?? "—"} kg`,
    ].join("\n")
  );
}

/** Find the day entry matching `date` in a plan JSON string. Delegates to the
 *  shared deriveTodaysWorkout so there's one implementation. */
function findTodaysWorkout(planText: string, date: string): PlanDay | null {
  let plan: unknown;
  try {
    plan = JSON.parse(planText);
  } catch {
    log.warn("Could not parse plan JSON.");
    return null;
  }
  return deriveTodaysWorkout(plan as Parameters<typeof deriveTodaysWorkout>[0], date);
}

interface Reminder {
  type: string;
  priority: "high" | "normal";
  suppressed: boolean;
  message: string;
}

/**
 * Send due, non-suppressed reminders as push notifications, with per-type
 * dedup so a cron schedule doesn't spam: hydration respects water_cadence_minutes,
 * bedtime fires at most once per local day. `only` (if set) restricts which
 * reminder types are delivered (e.g. just "hydration" for an hourly job).
 */
async function deliverReminders(
  date: string,
  prefs: ReminderPrefs,
  wellness: WellnessRow | null,
  reminders: Reminder[],
  only: Set<string> | null
): Promise<void> {
  if (prefs.reminders_enabled !== 1) return;
  const nowIso = new Date().toISOString();
  const cadenceMs = (prefs.water_cadence_minutes || 60) * 60_000;
  const resolved = resolveNotify({
    channel: process.env.COACH_NOTIFY_CHANNEL ?? prefs.notify_channel,
    webhookUrl: process.env.COACH_NOTIFY_WEBHOOK_URL ?? prefs.notify_webhook_url,
  });
  const moveCadenceMs = (prefs.move_cadence_minutes || 0) * 60_000;
  const labels: Record<string, string> = {
    bedtime: "Bedtime",
    hydration: "Hydration",
    move: "Move",
    recovery: "Recovery",
  };
  const patch: WellnessPatch = {};
  for (const rem of reminders) {
    if (rem.suppressed) continue;
    if (only && !only.has(rem.type)) continue;
    // Per-type dedup so a cron schedule doesn't spam. Computed up-front; the
    // bookkeeping timestamp is only committed once delivery actually succeeds
    // (so a momentarily-unreachable webhook doesn't silently swallow a nudge).
    if (rem.type === "hydration") {
      const last = wellness?.last_water_reminder_at;
      if (last && Date.now() - Date.parse(last) < cadenceMs) continue;
    } else if (rem.type === "move") {
      const last = wellness?.last_move_reminder_at;
      if (last && Date.now() - Date.parse(last) < moveCadenceMs) continue;
    } else if (rem.type === "bedtime") {
      const last = wellness?.last_bedtime_reminder_at;
      if (last && new Date(last).toDateString() === new Date().toDateString()) continue;
    }
    const title = `Claude Coach — ${labels[rem.type] ?? "Recovery"}`;
    const res = await sendNotification(rem.message, title, resolved);
    await logNotify(rem.type, resolved.channel, res.ok, res.detail);

    // Fan out to PWA web-push too (a second, independent channel). The nudge
    // counts as delivered if EITHER channel reached the user.
    let delivered = res.ok;
    if (webPushConfigured()) {
      // Hydration nudges carry quick-log buttons so water can be logged straight
      // from the notification. Platforms cap/ignore these, so they're additive only.
      const actions =
        rem.type === "hydration"
          ? [
              { action: "log-water-100", title: "100 ml" },
              { action: "log-water-200", title: "200 ml" },
              { action: "log-water-500", title: "500 ml" },
            ]
          : undefined;
      const wp = await sendWebPush(title, rem.message, actions);
      await logNotify(rem.type, "webpush", wp.sent > 0, wp.detail);
      delivered = delivered || wp.sent > 0;
    }
    if (!delivered) {
      log.warn(`notify (${rem.type}) failed: ${res.detail}`);
      continue; // don't mark it sent — retry on the next cron tick
    }
    if (rem.type === "hydration") patch.last_water_reminder_at = nowIso;
    else if (rem.type === "move") patch.last_move_reminder_at = nowIso;
    else if (rem.type === "bedtime") patch.last_bedtime_reminder_at = nowIso;
  }
  if (Object.keys(patch).length > 0) await upsertWellness(date, patch);
}

async function runCheckin(args: CheckinArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();

  // 1. Cache any Garmin signals passed in on the command line (already fetched elsewhere).
  const garminPatch: WellnessPatch = {};
  const readiness = flagNum(args.flags, "readiness");
  if (readiness !== undefined) garminPatch.readiness_score = Math.round(readiness);
  const sleepHours = flagNum(args.flags, "sleep-hours");
  if (sleepHours !== undefined) garminPatch.sleep_hours = sleepHours;
  const sleepScore = flagNum(args.flags, "sleep-score");
  if (sleepScore !== undefined) garminPatch.sleep_score = Math.round(sleepScore);
  const bodyBattery = flagNum(args.flags, "body-battery");
  if (bodyBattery !== undefined) garminPatch.body_battery_morning = Math.round(bodyBattery);
  const restingHr = flagNum(args.flags, "resting-hr");
  if (restingHr !== undefined) garminPatch.resting_hr = Math.round(restingHr);
  const hrvStatus = flagStr(args.flags, "hrv-status");
  if (hrvStatus !== undefined) garminPatch.hrv_status = hrvStatus;
  const trainingStatus = flagStr(args.flags, "training-status");
  if (trainingStatus !== undefined) garminPatch.training_status = trainingStatus;
  if (Object.keys(garminPatch).length > 0) await upsertWellness(date, garminPatch);

  const prefs = await getPrefs();
  const wellness = await getWellness(date);
  const enabled = prefs.reminders_enabled === 1;
  const nowMin = nowLocalMinutes();

  // 2. Quiet hours
  const quietStart = parseHHMM(prefs.quiet_hours_start);
  const quietEnd = parseHHMM(prefs.quiet_hours_end);
  const inQuiet =
    quietStart != null && quietEnd != null
      ? quietStart <= quietEnd
        ? nowMin >= quietStart && nowMin < quietEnd
        : nowMin >= quietStart || nowMin < quietEnd
      : false;

  const reminders: Reminder[] = [];

  // Today's plan + a training-load-aware hydration goal (more fluid on big days).
  // The plan comes from --plan-stdin (MCP inline), --plan=<file>, or — the default —
  // the stored active plan. Missing/unreadable plans degrade to no workout.
  const planFromStdin = Boolean(args.flags["plan-stdin"]);
  const planPath = flagStr(args.flags, "plan");
  let workout: PlanDay | null = null;
  if (planFromStdin || planPath) {
    let planText: string | null = null;
    try {
      planText = planFromStdin
        ? readFileSync(0, "utf-8")
        : readFileSync(planPath as string, "utf-8");
    } catch {
      log.warn(
        planFromStdin
          ? "checkin --plan-stdin: could not read plan from stdin"
          : `Could not read plan file: ${planPath}`
      );
    }
    if (planText != null) workout = findTodaysWorkout(planText, date);
  } else {
    const active = await getActivePlan();
    if (active) workout = deriveTodaysWorkout(active, date);
  }
  let trainingMinutes = flagNum(args.flags, "training-minutes");
  if (trainingMinutes === undefined && workout) {
    trainingMinutes = (workout.workouts as Array<{ durationMinutes?: number }>).reduce(
      (sum, w) => sum + (w.durationMinutes ?? 0),
      0
    );
  }
  if (trainingMinutes === undefined) {
    trainingMinutes = wellness?.training_minutes ?? 0;
  } else if (Math.round(trainingMinutes) !== (wellness?.training_minutes ?? null)) {
    // Cache plan/flag-derived load so later (cron) hydration runs scale too.
    await upsertWellness(date, { training_minutes: Math.round(trainingMinutes) });
  }
  const baseGoal = prefs.hydration_goal_ml ?? 0;
  const loadBonus = Math.round(
    (trainingMinutes / 60) * (prefs.hydration_per_active_hour_ml ?? 500)
  );
  const goal = baseGoal + loadBonus;

  // 3. Hydration pace
  const total = await hydrationTotal(date);
  const wake = parseHHMM(prefs.wake_target) ?? 7 * 60;
  const bed = parseHHMM(prefs.bedtime_target) ?? 23 * 60;
  let expected = 0;
  if (goal > 0 && bed > wake) {
    const frac = Math.min(1, Math.max(0, (nowMin - wake) / (bed - wake)));
    expected = Math.round(goal * frac);
  }
  const behind = expected - total;
  if (enabled && goal > 0 && behind >= 250 && nowMin >= wake && nowMin < bed) {
    reminders.push({
      type: "hydration",
      priority: behind >= 750 ? "high" : "normal",
      suppressed: inQuiet,
      message: `Drink water — about ${behind} ml behind pace (${total}/${goal} ml so far today).`,
    });
  }

  // 4. Bedtime (intentionally ignores quiet hours — it IS the wind-down signal)
  if (enabled && parseHHMM(prefs.bedtime_target) != null) {
    const toBed = bed - nowMin;
    if (toBed >= 0 && toBed <= 90) {
      reminders.push({
        type: "bedtime",
        priority: "normal",
        suppressed: false,
        message: `Winding down soon — bedtime target ${prefs.bedtime_target} is in ${toBed} min. Have some water before bed. 💧`,
      });
    } else if (toBed < 0 && toBed > -180) {
      reminders.push({
        type: "bedtime",
        priority: "high",
        suppressed: false,
        message: `You're ${-toBed} min past your ${prefs.bedtime_target} bedtime target — time to wrap up and sleep (hydrate first). 💧`,
      });
    }
  }

  // 4b. Move / get-up nudge (gentle, Garmin move-bar style). The per-type cadence
  // (move_cadence_minutes; 0 = off) and dedup live in deliverReminders — here we
  // only emit it inside the active day window, suppressed during quiet hours.
  if (enabled && (prefs.move_cadence_minutes ?? 0) > 0 && nowMin >= wake && nowMin < bed) {
    reminders.push({
      type: "move",
      priority: "normal",
      suppressed: inQuiet,
      message: "Time to move — stand up and walk or stretch for a couple of minutes. 🚶",
    });
  }

  // 5. Recovery assessment from cached Garmin / logged signals.
  // Prefer Garmin's Training Readiness; if the device doesn't surface it,
  // derive a 0–100 proxy from body battery / sleep / HRV / energy / resting HR.
  const r = wellness?.readiness_score ?? null;
  let recoveryLevel: RecoveryLevel;
  let recoveryScore: number | null = r;
  let recoveryDerived = false;
  let derivedFrom: string[] = [];
  const recoveryFlags: string[] = [];

  if (r != null) {
    recoveryLevel = recoveryLevelFromScore(r);
    if (r < 50)
      recoveryFlags.push(
        `Training readiness ${r} (${recoveryLevel}) — consider easing today's intensity.`
      );
  } else {
    // Reconstructed readiness: assembles the wellness row + rolling-history
    // signals (sleep-score history, RHR baseline, HRV/sleep-regularity from the
    // stored garmin_raw blobs) and runs the from-scratch model.
    const derived = await assembleReadiness(date);
    if (derived) {
      recoveryLevel = derived.level;
      recoveryScore = derived.score;
      recoveryDerived = true;
      derivedFrom = derived.factors.map((f) => f.detail);
      const capNote = derived.cappedBySubjective ? " — capped by how you reported feeling" : "";
      if (derived.score < 50 || derived.cappedBySubjective)
        recoveryFlags.push(
          `Readiness ~${derived.score} (${derived.level}, reconstructed from ${derived.factors.map((f) => f.detail).join(", ")})${capNote} — no native Garmin readiness on this device; consider easing today's intensity.`
        );
    } else {
      recoveryLevel = "unknown";
    }
  }
  if (wellness?.sleep_hours != null && wellness.sleep_hours < 6)
    recoveryFlags.push(`Only ${wellness.sleep_hours} h sleep — prioritise recovery today.`);
  if (wellness?.sleep_score != null && wellness.sleep_score < 50)
    recoveryFlags.push(`Low sleep score (${wellness.sleep_score}).`);
  if (wellness?.hrv_status && wellness.hrv_status.toLowerCase() !== "balanced")
    recoveryFlags.push(`HRV status: ${wellness.hrv_status} — watch for accumulating fatigue.`);
  if (recoveryFlags.length > 0) {
    reminders.push({
      type: "recovery",
      priority: recoveryLevel === "poor" ? "high" : "normal",
      suppressed: false,
      message: recoveryFlags.join(" "),
    });
  }

  // 6. Today's planned workout (optional)
  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    remindersEnabled: enabled,
    inQuietHours: inQuiet,
    workout,
    recovery: {
      level: recoveryLevel,
      readiness: r,
      score: recoveryScore,
      derived: recoveryDerived,
      derivedFrom,
      sleepHours: wellness?.sleep_hours ?? null,
      sleepScore: wellness?.sleep_score ?? null,
      bodyBattery: wellness?.body_battery_morning ?? null,
      restingHr: wellness?.resting_hr ?? null,
      hrvStatus: wellness?.hrv_status ?? null,
      trainingStatus: wellness?.training_status ?? null,
      flags: recoveryFlags,
    },
    hydration: {
      totalMl: total,
      goalMl: goal,
      baseGoalMl: baseGoal,
      trainingLoadBonusMl: loadBonus,
      trainingMinutes,
      expectedByNowMl: expected,
      remainingMl: Math.max(0, goal - total),
    },
    reminders,
  };

  if (args.flags["notify"]) {
    const onlyStr = flagStr(args.flags, "only");
    const only = onlyStr ? new Set(onlyStr.split(",").map((s) => s.trim())) : null;
    await deliverReminders(date, prefs, wellness, reminders, only);
  }

  // Compact one-line context for a SessionStart hook: print only if something is due.
  if (args.flags["greeting"]) {
    const due = reminders.filter((rem) => !rem.suppressed);
    if (due.length > 0) {
      console.log(
        `[Claude Coach wellness] ${due.map((rem) => rem.message).join(" ")} (If it fits naturally, gently surface this; for recovery, consider adjusting today's session per adaptive.md.)`
      );
    }
    return;
  }

  if (args.flags["json"]) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  log.box(`Coach check-in — ${date}`);
  const recoveryNote =
    r != null
      ? ` (readiness ${r})`
      : recoveryDerived
        ? ` (derived ~${recoveryScore} from ${derivedFrom.join(", ")})`
        : "";
  console.log(`Recovery: ${recoveryLevel}${recoveryNote}`);
  console.log(
    `Hydration: ${total}/${goal} ml (expected ~${expected} by now)${loadBonus > 0 ? ` — incl. +${loadBonus} ml for ${Math.round(trainingMinutes)} min training` : ""}`
  );
  if (workout) {
    const names = (workout.workouts as Array<{ sport?: string; name?: string }>)
      .map((w) => `${w.sport ?? "?"}: ${w.name ?? "?"}`)
      .join("; ");
    console.log(`Today's plan (${workout.dayOfWeek ?? ""}): ${names || "rest"}`);
  } else if (planPath) {
    console.log(`Today's plan: no entry found for ${date} in ${planPath}`);
  }
  if (reminders.length === 0) {
    console.log("Reminders: none due right now ✅");
  } else {
    console.log("Reminders:");
    for (const rem of reminders) {
      const tag = rem.suppressed ? " (suppressed: quiet hours)" : "";
      console.log(`  • [${rem.priority}] ${rem.message}${tag}`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

/** The `plan` command group — CRUD over the persisted training-plan store. */
async function runPlan(args: PlanArgs): Promise<void> {
  await ensureDb();
  const json = Boolean(args.flags["json"]);

  switch (args.sub) {
    case "save": {
      const fromStdin = Boolean(args.flags["stdin"]);
      const plan = readPlanJson(args.pos ?? "", fromStdin);
      const v = validatePlan(plan);
      if (!v.ok) {
        log.error(`plan save rejected:\n- ${v.errors.join("\n- ")}`);
        process.exit(1);
      }
      await savePlan(plan);
      if (json) {
        console.log(
          JSON.stringify({ saved: plan.meta.id, active: true, warnings: v.warnings }, null, 2)
        );
      } else {
        log.success(`Saved plan ${plan.meta.id} (${plan.meta.event ?? "—"}) and set it active.`);
        for (const w of v.warnings) log.warn(w);
      }
      break;
    }
    case "list": {
      const plans = await listPlans();
      if (json) {
        console.log(JSON.stringify(plans, null, 2));
      } else if (plans.length === 0) {
        log.info("No plans saved yet.");
      } else {
        for (const p of plans) {
          log.info(`${p.active ? "●" : "○"} ${p.id} — ${p.event ?? "—"} (${p.event_date ?? "?"})`);
        }
      }
      break;
    }
    case "get": {
      const plan = args.pos ? await getPlan(args.pos) : await getActivePlan();
      if (!plan) {
        log.error(args.pos ? `No plan with id ${args.pos}` : "No active plan.");
        process.exit(1);
      }
      console.log(JSON.stringify(plan, null, 2));
      break;
    }
    case "activate": {
      if (!args.pos) {
        log.error("plan activate requires a plan id");
        process.exit(1);
      }
      if (!(await getPlan(args.pos))) {
        log.error(`No plan with id ${args.pos}`);
        process.exit(1);
      }
      await setActivePlan(args.pos);
      if (json) console.log(JSON.stringify({ active: args.pos }, null, 2));
      else log.success(`Activated plan ${args.pos}.`);
      break;
    }
    case "delete": {
      if (!args.pos) {
        log.error("plan delete requires a plan id");
        process.exit(1);
      }
      await deletePlan(args.pos);
      if (json) console.log(JSON.stringify({ deleted: args.pos }, null, 2));
      else log.success(`Deleted plan ${args.pos}.`);
      break;
    }
    case "show-today": {
      const date = flagStr(args.flags, "date") ?? localDate();
      const plan = await getActivePlan();
      const day = plan ? deriveTodaysWorkout(plan, date) : null;
      console.log(
        JSON.stringify(
          {
            date,
            hasActivePlan: !!plan,
            planId: plan?.meta?.id ?? null,
            day,
            sessions: plan ? sessionsForDate(plan, date) : [],
          },
          null,
          2
        )
      );
      break;
    }
    case "upcoming": {
      const from = flagStr(args.flags, "date") ?? localDate();
      const days = flagNum(args.flags, "days") ?? 14;
      const cutoff = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const plan = await getActivePlan();
      const sessions = plan
        ? upcomingWorkouts(plan, from, 200).filter((s) => s.date <= cutoff)
        : [];
      console.log(JSON.stringify({ from, days, hasActivePlan: !!plan, sessions }, null, 2));
      break;
    }
    default:
      log.error(
        `unknown plan subcommand: ${args.sub} (use save|list|get|activate|delete|show-today|upcoming)`
      );
      process.exit(1);
  }
}

async function main() {
  const args = parseArgs();

  switch (args.command) {
    case "help":
      printHelp();
      break;
    case "auth":
      await runAuth(args);
      break;
    case "sync":
      await runSync(args);
      break;
    case "render":
      runRender(args);
      break;
    case "export-calendar":
      await runExportCalendar(args);
      break;
    case "export-garmin":
      await runExportGarmin(args);
      break;
    case "garmin-route":
      await runGarminRoute(args);
      break;
    case "garmin-backfill":
      await runGarminBackfill(args);
      break;
    case "garmin-tracks":
      await runGarminTracks(args);
      break;
    case "garmin-streams":
      await runGarminStreams(args);
      break;
    case "journal":
      await runJournal(args);
      break;
    case "summary":
      await runSummary(args);
      break;
    case "garmin-push":
      await runGarminPush(args);
      break;
    case "query":
      await runQuery(args);
      break;
    case "log":
      await runLog(args);
      break;
    case "config":
      await runConfig(args);
      break;
    case "notify":
      await runNotify(args);
      break;
    case "garmin-sync":
      await runGarminSync(args);
      break;
    case "garmin-fetch":
      await runGarminFetch(args);
      break;
    case "wellness":
      await runWellness(args);
      break;
    case "checkin":
      await runCheckin(args);
      break;
    case "plan":
      await runPlan(args);
      break;
  }
}

main()
  .then(async () => {
    // Release the DB handle (the MySQL socket keeps the event loop alive otherwise)
    // so this one-shot process exits cleanly — critical for the MCP, which spawns
    // the CLI and waits for it to exit.
    await closeDatabase();
  })
  .catch(async (err) => {
    log.error(err.message);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
