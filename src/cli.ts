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
  logHydration,
  hydrationTotal,
  getWellness,
  upsertWellness,
  localDate,
  type WellnessPatch,
} from "./db/wellness.js";
import { getValidTokens } from "./strava/oauth.js";
import { getAllActivities, getAthlete } from "./strava/api.js";
import type { StravaActivity, StravaTokenResponse } from "./strava/types.js";
import { readFileSync, writeFileSync } from "fs";
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

interface WellnessArgs {
  command: "wellness";
  flags: Flags;
}

type CliArgs = SyncArgs | RenderArgs | QueryArgs | AuthArgs | HelpArgs | LogArgs | WellnessArgs;

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
  query <sql>       Run a SQL query against the database
  log <type> <val>  Log wellness/intake (water|sleep|energy|soreness|mood|weight)
  wellness          Show today's hydration + wellness snapshot
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

  # Query the database
  npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5"

  # Log wellness / hydration
  npx claude-coach log water 500
  npx claude-coach log sleep 7.5 --score=82
  npx claude-coach log energy 4
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
// Wellness CLI: log / wellness
// ============================================================================

/** Open the DB and ensure the (idempotent) schema, quietly. */
async function ensureDb(): Promise<void> {
  await initDatabase();
  migrate(true);
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
    case "query":
      await runQuery(args);
      break;
    case "log":
      await runLog(args);
      break;
    case "wellness":
      await runWellness(args);
      break;
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
