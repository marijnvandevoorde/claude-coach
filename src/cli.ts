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
import { execute, initDatabase, query, queryJson } from "./db/client.js";
import {
  getPrefs,
  updatePrefs,
  logHydration,
  hydrationTotal,
  getWellness,
  upsertWellness,
  localDate,
  type PrefsPatch,
  type WellnessPatch,
  type WellnessRow,
  type ReminderPrefs,
} from "./db/wellness.js";
import { resolveNotify, sendNotification } from "./lib/notify.js";
import { deriveRecovery, recoveryLevelFromScore, type RecoveryLevel } from "./lib/recovery.js";
import { generateIcs } from "./viewer/lib/export/ics.js";
import { getSportIcon } from "./viewer/lib/utils.js";
import type { TrainingPlan } from "./schema/training-plan.js";
import { getValidTokens } from "./strava/oauth.js";
import { getAllActivities, getAthlete } from "./strava/api.js";
import type { StravaActivity, StravaTokenResponse } from "./strava/types.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "node:child_process";
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
}

interface ExportGarminArgs {
  command: "export-garmin";
  inputFile: string;
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

interface WellnessArgs {
  command: "wellness";
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
  | WellnessArgs;

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
    if (!args[1]) {
      log.error("export-calendar requires a plan JSON file");
      process.exit(1);
    }
    const calArgs: ExportCalendarArgs = {
      command: "export-calendar",
      inputFile: args[1],
      json: args.includes("--json"),
    };
    for (let i = 2; i < args.length; i++) {
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
    if (!args[1]) {
      log.error("export-garmin requires a plan JSON file");
      process.exit(1);
    }
    return { command: "export-garmin", inputFile: args[1] };
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

  # Daily check-in (agent passes Garmin signals fetched via the garmin MCP)
  npx claude-coach checkin --plan=my-plan.json --readiness=78 --sleep-hours=7.5 --json

  # Send due reminders as push notifications (for cron); --only filters types
  npx claude-coach checkin --notify
  npx claude-coach checkin --notify --only=hydration
  npx claude-coach checkin --greeting   # one-line wellness context for a SessionStart hook

  # Pull live data straight from Garmin Connect (needs $GARMINTOKENS + the python fetcher)
  npx claude-coach garmin-fetch
  npx claude-coach garmin-fetch --date=2026-06-01 --json

  # Cache a Garmin snapshot you already have (e.g. an agent fetched it via the garmin MCP)
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

function insertActivity(activity: StravaActivity): void {
  const sql = `
    INSERT OR REPLACE INTO activities (
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
      datetime('now')
    );
  `;

  execute(sql);
}

function insertAthlete(athlete: {
  id: number;
  firstname: string;
  lastname: string;
  weight?: number;
  ftp?: number;
}): void {
  const sql = `
    INSERT OR REPLACE INTO athlete (id, firstname, lastname, weight, ftp, raw_json, updated_at)
    VALUES (
      ${athlete.id},
      ${escapeString(athlete.firstname)},
      ${escapeString(athlete.lastname)},
      ${athlete.weight ?? "NULL"},
      ${athlete.ftp ?? "NULL"},
      ${escapeString(JSON.stringify(athlete))},
      datetime('now')
    );
  `;
  execute(sql);
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
    migrate();

    // Fetch athlete to get ID and validate tokens
    log.start("Validating tokens and fetching athlete profile...");
    const athlete = await getAthlete(tempTokens);

    // Update tokens with real athlete ID
    const tokens = { ...tempTokens, athlete_id: athlete.id };
    saveTokens(tokens);

    insertAthlete(athlete);
    log.success(`Authenticated as ${athlete.firstname} ${athlete.lastname}`);

    // Fetch activities
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - syncDays);
    const activities = await getAllActivities(tokens, afterDate);

    // Store activities
    log.start("Storing activities in database...");
    let count = 0;
    for (const activity of activities) {
      insertActivity(activity);
      count++;
      if (count % 50 === 0) {
        log.progress(`   Stored ${count}/${activities.length}...`);
      }
    }
    log.progressEnd();
    log.success(`Stored ${activities.length} activities`);

    execute(`
      INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
      VALUES (datetime('now'), datetime('now'), ${activities.length}, 'success');
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
  migrate();

  // Authenticate with Strava (opens browser)
  const tokens = await getValidTokens();

  // Step 4: Fetch and store athlete profile
  log.start("Fetching athlete profile...");
  const athlete = await getAthlete(tokens);
  insertAthlete(athlete);
  log.success(`Athlete: ${athlete.firstname} ${athlete.lastname}`);

  // Step 5: Fetch activities
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - configSyncDays);

  const activities = await getAllActivities(tokens, afterDate);

  // Step 6: Store activities
  log.start("Storing activities in database...");
  let count = 0;
  for (const activity of activities) {
    insertActivity(activity);
    count++;
    if (count % 50 === 0) {
      log.progress(`   Stored ${count}/${activities.length}...`);
    }
  }
  log.progressEnd();
  log.success(`Stored ${activities.length} activities`);

  // Step 7: Log sync
  execute(`
    INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
    VALUES (datetime('now'), datetime('now'), ${activities.length}, 'success');
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

/** Flatten a training plan into one calendar event per non-rest workout. */
function planToEvents(plan: TrainingPlan): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      for (const w of day.workouts ?? []) {
        if (w.sport === "rest") continue;
        const parts: string[] = [];
        if (w.description) parts.push(w.description);
        if (w.humanReadable) parts.push(w.humanReadable);
        if (w.primaryZone) parts.push(`Primary zone: ${w.primaryZone}`);
        events.push({
          date: day.date,
          title: `${getSportIcon(w.sport)} ${w.name}`.trim(),
          sport: w.sport,
          durationMinutes: w.durationMinutes,
          description: parts.join("\n\n"),
        });
      }
    }
  }
  return events;
}

function runExportCalendar(args: ExportCalendarArgs): void {
  let plan: TrainingPlan;
  try {
    plan = JSON.parse(readFileSync(args.inputFile, "utf-8"));
  } catch {
    log.error(`Could not read/parse plan JSON: ${args.inputFile}`);
    process.exit(1);
  }

  // --json: emit a clean event list for an agent to push via the Google Calendar MCP.
  if (args.json) {
    console.log(JSON.stringify(planToEvents(plan), null, 2));
    return;
  }

  // Default: write an .ics the user can import into any calendar.
  const ics = generateIcs(plan);
  const outPath = args.outputFile ?? args.inputFile.replace(/\.json$/i, "") + ".ics";
  writeFileSync(outPath, ics);
  log.success(`Wrote ${planToEvents(plan).length} workouts to ${outPath}`);
  log.info(
    "Import this .ics into your calendar, or ask Claude to push them to your linked Google Calendar."
  );
}

interface GarminWorkoutExport {
  date: string;
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

/** Normalize a plan into per-workout records an agent can feed to the Garmin workout builders. */
function planToGarminWorkouts(plan: TrainingPlan): GarminWorkoutExport[] {
  const out: GarminWorkoutExport[] = [];
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      for (const w of day.workouts ?? []) {
        if (w.sport === "rest") continue;
        out.push({
          date: day.date,
          sport: w.sport,
          type: w.type,
          name: w.name,
          durationMinutes: w.durationMinutes,
          distanceMeters: w.distanceMeters,
          primaryZone: w.primaryZone,
          targetHR: w.targetHR,
          targetPace: w.targetPace,
          targetPower: w.targetPower,
          rpe: w.rpe,
          structure: w.structure,
          humanReadable: w.humanReadable,
        });
      }
    }
  }
  return out;
}

function runExportGarmin(args: ExportGarminArgs): void {
  let plan: TrainingPlan;
  try {
    plan = JSON.parse(readFileSync(args.inputFile, "utf-8"));
  } catch {
    log.error(`Could not read/parse plan JSON: ${args.inputFile}`);
    process.exit(1);
  }
  // A structured workout feed for an agent to create + schedule on Garmin Connect
  // (via the garmin MCP), which then syncs scheduled workouts to the watch.
  console.log(JSON.stringify(planToGarminWorkouts(plan), null, 2));
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
    const results = queryJson(args.sql);
    console.log(JSON.stringify(results, null, 2));
  } else {
    const result = query(args.sql);
    console.log(result);
  }
}

// ============================================================================
// Wellness CLI: log / config / wellness / checkin
// ============================================================================

/** Open the DB and ensure the (idempotent) schema, quietly. */
async function ensureDb(): Promise<void> {
  await initDatabase();
  migrate(true);
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
      logHydration(ml, { date, source: flagStr(args.flags, "source") ?? "manual", note });
      const total = hydrationTotal(date);
      const goal = getPrefs().hydration_goal_ml;
      log.success(`Logged ${ml} ml water — ${total}/${goal} ml today (${date}).`);
      break;
    }
    case "sleep": {
      const patch: WellnessPatch = { sleep_hours: requireNum() };
      const score = flagNum(args.flags, "score");
      if (score !== undefined) patch.sleep_score = Math.round(score);
      if (note) patch.notes = note;
      upsertWellness(date, patch);
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
      upsertWellness(date, { [col]: v } as WellnessPatch);
      log.success(`Logged ${type} ${v}/5 for ${date}.`);
      break;
    }
    case "weight": {
      upsertWellness(date, { weight_kg: requireNum() });
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
    updatePrefs(patch);
  }

  const prefs = getPrefs();
  if (args.flags["json"]) {
    console.log(JSON.stringify(prefs, null, 2));
    return;
  }
  log.box(
    [
      "Reminder preferences",
      `  Reminders:     ${prefs.reminders_enabled ? "enabled" : "disabled"}`,
      `  Bedtime:       ${prefs.bedtime_target ?? "—"}`,
      `  Wake:          ${prefs.wake_target ?? "—"}`,
      `  Water goal:    ${prefs.hydration_goal_ml} ml/day`,
      `  Water cadence: every ${prefs.water_cadence_minutes} min`,
      `  Water +load:   +${prefs.hydration_per_active_hour_ml} ml / training hour`,
      `  Quiet hours:   ${prefs.quiet_hours_start ?? "—"}–${prefs.quiet_hours_end ?? "—"}`,
      `  Timezone:      ${prefs.timezone ?? "(host default)"}`,
      `  Notify:        ${prefs.notify_channel}${prefs.notify_webhook_url ? " (webhook set)" : ""}`,
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

  upsertWellness(date, patch);
  const snapshot = getWellness(date);
  if (args.flags["json"]) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  log.success(`Cached Garmin snapshot for ${date}: ${Object.keys(patch).join(", ")}.`);
}

// ----------------------------------------------------------------------------
// garmin-fetch: the *real* Garmin sync. Spawns the Python fetcher (which logs
// in to Garmin Connect via $GARMINTOKENS and prints JSON), then ingests the
// wellness snapshot + recent activities through the tested DB upsert paths.
// ----------------------------------------------------------------------------

interface GarminFetchPayload {
  date: string;
  wellness: Record<string, number | string | null>;
  activities: Array<Record<string, unknown>>;
  errors: string[];
}

/** Numeric/text wellness columns the fetcher is allowed to write. */
const GARMIN_FETCH_NUMERIC = [
  "readiness_score",
  "sleep_hours",
  "sleep_score",
  "body_battery_morning",
  "resting_hr",
] as const;
const GARMIN_FETCH_TEXT = ["hrv_status", "training_status"] as const;

function resolveGarminFetcher(): { python: string; script: string } {
  const scriptCandidates = [
    process.env.COACH_GARMIN_FETCH_SCRIPT,
    join(__dirname, "..", "scripts", "garmin_fetch.py"),
    "/app/scripts/garmin_fetch.py",
  ].filter((p): p is string => Boolean(p));
  const script = scriptCandidates.find((p) => existsSync(p)) ?? scriptCandidates[0];

  const pythonCandidates = [process.env.COACH_GARMIN_PYTHON, "/opt/garmin-venv/bin/python"].filter(
    (p): p is string => Boolean(p)
  );
  const python = pythonCandidates.find((p) => existsSync(p)) ?? "python3";

  return { python, script };
}

function sqlNum(value: unknown): string {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? "NULL" : String(n);
}

function insertGarminActivity(a: Record<string, unknown>): void {
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  execute(
    `INSERT OR REPLACE INTO activities (
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
       ${escapeString(JSON.stringify(a.raw ?? a))}, datetime('now')
     );`
  );
}

async function runGarminFetch(args: GarminFetchArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();
  const { python, script } = resolveGarminFetcher();

  const res = spawnSync(python, [script, date], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) {
    log.error(`garmin-fetch: could not run ${python} ${script}: ${res.error.message}`);
    process.exit(1);
  }

  let payload: GarminFetchPayload;
  try {
    payload = JSON.parse((res.stdout || "").trim());
  } catch {
    const detail = (res.stderr || res.stdout || "no output").trim().slice(0, 400);
    log.error(`garmin-fetch: unexpected output from the fetcher: ${detail}`);
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
  if (Object.keys(patch).length > 0) upsertWellness(payload.date, patch);

  // Ingest recent activities (skip any without a usable id).
  let stored = 0;
  for (const a of payload.activities ?? []) {
    if (a.id == null || !Number.isFinite(Number(a.id))) continue;
    insertGarminActivity(a);
    stored++;
  }

  if (args.flags["json"]) {
    console.log(
      JSON.stringify(
        { date: payload.date, wellness: patch, activitiesStored: stored, errors: payload.errors },
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
  const prefs = getPrefs();
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
  if (result.ok) {
    log.success(`Notified via ${resolved.channel} (${result.detail}).`);
  } else {
    log.error(`Notify failed via ${resolved.channel}: ${result.detail}`);
    process.exit(1);
  }
}

async function runWellness(args: WellnessArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();
  const prefs = getPrefs();
  const wellness = getWellness(date);
  const total = hydrationTotal(date);
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

interface PlanWorkout {
  date: string;
  dayOfWeek?: string;
  weekNumber?: number;
  phase?: string;
  isRecoveryWeek?: boolean;
  workouts: unknown[];
}

/** Find the day entry matching `date` in a rendered plan JSON file. */
function findTodaysWorkout(planPath: string, date: string): PlanWorkout | null {
  let plan: {
    weeks?: Array<{
      weekNumber?: number;
      phase?: string;
      isRecoveryWeek?: boolean;
      days?: Array<{ date: string; dayOfWeek?: string; workouts?: unknown[] }>;
    }>;
  };
  try {
    plan = JSON.parse(readFileSync(planPath, "utf-8"));
  } catch {
    log.warn(`Could not read plan file: ${planPath}`);
    return null;
  }
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      if (day.date === date) {
        return {
          date,
          dayOfWeek: day.dayOfWeek,
          weekNumber: week.weekNumber,
          phase: week.phase,
          isRecoveryWeek: week.isRecoveryWeek,
          workouts: day.workouts ?? [],
        };
      }
    }
  }
  return null;
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
  const patch: WellnessPatch = {};
  for (const rem of reminders) {
    if (rem.suppressed) continue;
    if (only && !only.has(rem.type)) continue;
    if (rem.type === "hydration") {
      const last = wellness?.last_water_reminder_at;
      if (last && Date.now() - Date.parse(last) < cadenceMs) continue;
      patch.last_water_reminder_at = nowIso;
    } else if (rem.type === "bedtime") {
      const last = wellness?.last_bedtime_reminder_at;
      if (last && new Date(last).toDateString() === new Date().toDateString()) continue;
      patch.last_bedtime_reminder_at = nowIso;
    }
    const label =
      rem.type === "bedtime" ? "Bedtime" : rem.type === "hydration" ? "Hydration" : "Recovery";
    const res = await sendNotification(rem.message, `Claude Coach — ${label}`, resolved);
    if (!res.ok) log.warn(`notify (${rem.type}) failed: ${res.detail}`);
  }
  if (Object.keys(patch).length > 0) upsertWellness(date, patch);
}

/** Rolling mean of resting HR over recent days (excludes `beforeDate`). Needs a
 *  few samples to be meaningful — returns null until enough history exists. */
function restingHrBaseline(beforeDate: string): number | null {
  const rows = queryJson<{ resting_hr: number }>(
    `SELECT resting_hr FROM wellness_state
     WHERE resting_hr IS NOT NULL AND local_date < ${escapeString(beforeDate)}
     ORDER BY local_date DESC LIMIT 30;`
  );
  const vals = rows.map((row) => Number(row.resting_hr)).filter(Number.isFinite);
  if (vals.length < 5) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function runCheckin(args: CheckinArgs): Promise<void> {
  await ensureDb();
  const date = flagStr(args.flags, "date") ?? localDate();

  // 1. Cache any Garmin signals passed in by the agent (fetched via mcp__garmin__*).
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
  if (Object.keys(garminPatch).length > 0) upsertWellness(date, garminPatch);

  const prefs = getPrefs();
  const wellness = getWellness(date);
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
  const planPath = flagStr(args.flags, "plan");
  const workout = planPath ? findTodaysWorkout(planPath, date) : null;
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
    upsertWellness(date, { training_minutes: Math.round(trainingMinutes) });
  }
  const baseGoal = prefs.hydration_goal_ml ?? 0;
  const loadBonus = Math.round(
    (trainingMinutes / 60) * (prefs.hydration_per_active_hour_ml ?? 500)
  );
  const goal = baseGoal + loadBonus;

  // 3. Hydration pace
  const total = hydrationTotal(date);
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
    const derived = deriveRecovery({
      bodyBattery: wellness?.body_battery_morning,
      sleepScore: wellness?.sleep_score,
      sleepHours: wellness?.sleep_hours,
      hrvStatus: wellness?.hrv_status,
      trainingStatus: wellness?.training_status,
      energy: wellness?.subjective_energy,
      restingHr: wellness?.resting_hr,
      restingHrBaseline: restingHrBaseline(date),
    });
    if (derived) {
      recoveryLevel = derived.level;
      recoveryScore = derived.score;
      recoveryDerived = true;
      derivedFrom = derived.components;
      if (derived.score < 50)
        recoveryFlags.push(
          `Recovery ~${derived.score} (${derived.level}, derived from ${derived.components.join(", ")}) — no Garmin readiness on this device; consider easing today's intensity.`
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
      runExportCalendar(args);
      break;
    case "export-garmin":
      runExportGarmin(args);
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
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
