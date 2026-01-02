# Claude Coach Architecture

A Node.js tool that syncs Strava activity data to a local SQLite database, enabling Claude to create personalized triathlon and endurance training plans.

## Design Principles

- **Portable**: Single database file, queries via `sqlite3` CLI (no native Node modules)
- **Composable**: Small, focused tools that do one thing well
- **Claude-friendly**: Database can be queried directly via CLI

## Overview

```
┌─────────────┐     OAuth2      ┌─────────────┐
│   Strava    │◄───────────────►│   Node.js   │
│     API     │   + REST API    │    CLI      │
└─────────────┘                 └──────┬──────┘
                                       │
                                       ▼
                                ┌─────────────┐
                                │   SQLite    │
                                │  coach.db   │
                                └──────┬──────┘
                                       │
                                       ▼
                                ┌─────────────┐
                                │   Claude    │
                                │  (queries)  │
                                └─────────────┘
```

## Prerequisites

- **Node.js** 20+
- **sqlite3 CLI** - Usually pre-installed on macOS/Linux. Windows: `winget install SQLite.SQLite`

## Why SQLite?

- **Single file**: `coach.db` contains everything, easy to backup/move
- **Ubiquitous**: `sqlite3` CLI is pre-installed on macOS and most Linux distros
- **No native modules**: Shell out to `sqlite3` CLI from Node.js
- **Claude-friendly**: Claude can query directly via `sqlite3 ~/.claude-coach/coach.db "..."`

## Components

### 1. Strava OAuth Flow

**Setup (one-time):**

1. User creates a Strava API application at https://www.strava.com/settings/api
   - Set "Authorization Callback Domain" to `localhost`
2. User runs `npx coach auth` and enters client_id + client_secret when prompted
3. Browser opens, user authorizes, tokens saved locally

**Authorization flow:**

1. CLI starts local HTTP server on `localhost:8765`
2. CLI opens browser to:
   ```
   https://www.strava.com/oauth/authorize?
     client_id={CLIENT_ID}&
     response_type=code&
     redirect_uri=http://localhost:8765/callback&
     scope=activity:read_all&
     approval_prompt=auto
   ```
3. User authorizes in browser
4. Strava redirects to `localhost:8765/callback?code={CODE}`
5. CLI exchanges code for access + refresh tokens
6. Tokens stored in `~/.claude-coach/tokens.json`

**Token refresh:**

- Access tokens expire after 6 hours
- Automatically refreshed before API calls
- Refresh tokens are long-lived

### 2. CLI Tools

Separate focused commands instead of one monolithic CLI:

```bash
# Authentication
npx coach auth                    # Run OAuth flow, store tokens

# Sync
npx coach sync                    # Sync new activities from Strava
npx coach sync --full             # Re-sync all historical data

# Query (thin wrapper around duckdb CLI)
npx coach query "SELECT ..."      # Run arbitrary SQL
npx coach summary                 # Show training summary

# Goals
npx coach goal add "Ironman 70.3" "2026-03-29"
npx coach goal list
```

Or query SQLite directly (this is what Claude will typically do):

```bash
sqlite3 ~/.claude-coach/coach.db "SELECT * FROM activities LIMIT 5"
sqlite3 -json ~/.claude-coach/coach.db "SELECT * FROM weekly_volume"
```

### 3. SQLite Schema

```sql
-- Core activity data
CREATE TABLE activities (
  id INTEGER PRIMARY KEY,           -- Strava activity ID
  name TEXT,
  sport_type TEXT,                  -- Run, Ride, Swim, etc.
  start_date TEXT,                  -- ISO 8601 UTC
  elapsed_time INTEGER,             -- seconds
  moving_time INTEGER,              -- seconds
  distance REAL,                    -- meters
  total_elevation_gain REAL,        -- meters
  average_speed REAL,               -- m/s
  max_speed REAL,                   -- m/s
  average_heartrate REAL,
  max_heartrate REAL,
  average_watts REAL,               -- cycling/running power
  max_watts REAL,
  weighted_average_watts REAL,      -- normalized power
  kilojoules REAL,
  suffer_score INTEGER,             -- Strava's relative effort
  average_cadence REAL,
  calories REAL,
  description TEXT,
  workout_type INTEGER,             -- 0=default, 1=race, 2=workout, 3=long run
  gear_id TEXT,
  raw_json TEXT,                    -- full Strava response as JSON
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Time-series streams (HR, power, pace over time)
CREATE TABLE streams (
  activity_id INTEGER PRIMARY KEY,
  time_data TEXT,                   -- JSON array: seconds from start
  distance_data TEXT,               -- JSON array: cumulative meters
  heartrate_data TEXT,              -- JSON array
  watts_data TEXT,                  -- JSON array
  cadence_data TEXT,                -- JSON array
  altitude_data TEXT,               -- JSON array
  velocity_data TEXT,               -- JSON array: m/s
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Athlete profile
CREATE TABLE athlete (
  id INTEGER PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  weight REAL,                      -- kg
  ftp INTEGER,                      -- functional threshold power (watts)
  max_heartrate INTEGER,
  raw_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Training goals
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT,                  -- "Ironman 70.3 Oceanside"
  event_date TEXT,                  -- ISO 8601
  event_type TEXT,                  -- triathlon, marathon, ultra, century
  notes TEXT,                       -- constraints, injuries, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sync metadata
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  completed_at TEXT,
  activities_synced INTEGER,
  status TEXT                       -- success, failed, partial
);

-- Indexes for common queries
CREATE INDEX idx_activities_date ON activities(start_date);
CREATE INDEX idx_activities_sport ON activities(sport_type);
CREATE INDEX idx_activities_sport_date ON activities(sport_type, start_date);

-- Useful views
CREATE VIEW weekly_volume AS
SELECT
  strftime('%Y-W%W', start_date) AS week,
  sport_type,
  COUNT(*) AS sessions,
  ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
  ROUND(SUM(distance) / 1000.0, 1) AS km,
  ROUND(AVG(average_heartrate), 0) AS avg_hr,
  ROUND(AVG(suffer_score), 0) AS avg_effort
FROM activities
GROUP BY week, sport_type
ORDER BY week DESC, sport_type;

CREATE VIEW recent_activities AS
SELECT
  date(start_date) AS date,
  sport_type,
  name,
  moving_time / 60 AS minutes,
  ROUND(distance / 1000.0, 1) AS km,
  ROUND(average_heartrate, 0) AS hr,
  suffer_score
FROM activities
ORDER BY start_date DESC
LIMIT 50;
```

### 4. Claude Integration

Claude queries the database via the `duckdb` CLI. The CLAUDE.md skill teaches Claude:

1. Where the database lives: `~/.claude-coach/coach.db`
2. Schema and useful queries
3. How to interpret training data
4. Training plan output format

**Example queries for coaching:**

```sql
-- Weekly volume trend (last 12 weeks)
SELECT * FROM weekly_volume
WHERE week >= strftime('%Y-W%W', date('now', '-12 weeks'));

-- Average weekly running distance
SELECT ROUND(AVG(km), 1) as avg_weekly_km
FROM weekly_volume
WHERE sport_type = 'Run';

-- Long endurance sessions (2+ hours, low HR)
SELECT date(start_date) as date, sport_type, name,
       ROUND(moving_time/3600.0, 1) as hours, ROUND(average_heartrate) as hr
FROM activities
WHERE moving_time > 7200
  AND average_heartrate < 140
ORDER BY start_date DESC;

-- Training load by week (suffer score)
SELECT
  strftime('%Y-W%W', start_date) AS week,
  SUM(suffer_score) AS weekly_load
FROM activities
GROUP BY week
ORDER BY week DESC;

-- Sport distribution (last 6 months)
SELECT
  sport_type,
  COUNT(*) AS count,
  ROUND(SUM(moving_time) / 3600.0, 1) AS total_hours
FROM activities
WHERE start_date >= date('now', '-6 months')
GROUP BY sport_type
ORDER BY total_hours DESC;
```

**Training plan output format:**

```markdown
# Training Plan: Ironman 70.3 Oceanside

## March 2026

Based on your data:

- Current weekly running: ~35km
- Current weekly cycling: ~120km
- Current weekly swimming: ~4km
- Average training load: 450 suffer score/week

### Week 1 (Dec 30 - Jan 5): Base Building

Focus: Aerobic base, technique work

| Day | Workout | Duration | Notes                                 |
| --- | ------- | -------- | ------------------------------------- |
| Mon | Rest    | -        | Active recovery                       |
| Tue | Swim    | 45 min   | Drill focus: catch-up, fingertip drag |
| Wed | Run     | 50 min   | Zone 2, HR < 145                      |
| Thu | Bike    | 60 min   | Easy spin, cadence 90+                |
| Fri | Swim    | 30 min   | Technique                             |
| Sat | Bike    | 90 min   | Long ride, Zone 2                     |
| Sun | Run     | 70 min   | Long run, easy effort                 |

Weekly totals: Swim 1:15, Bike 2:30, Run 2:00
...
```

## Directory Structure

```
claude-coach/
├── package.json
├── tsconfig.json
├── architecture.md
├── CLAUDE.md                    # Claude skill instructions
├── src/
│   ├── cli.ts                   # CLI entry point
│   ├── commands/
│   │   ├── auth.ts              # OAuth flow
│   │   ├── sync.ts              # Strava sync
│   │   ├── query.ts             # Database queries
│   │   └── goal.ts              # Goal management
│   ├── strava/
│   │   ├── api.ts               # Strava API client
│   │   ├── oauth.ts             # OAuth utilities
│   │   └── types.ts             # Strava types
│   ├── db/
│   │   ├── client.ts            # DuckDB CLI wrapper
│   │   ├── schema.sql           # Schema definitions
│   │   └── migrate.ts           # Schema setup
│   └── lib/
│       ├── config.ts            # Config management
│       └── http.ts              # Local HTTP server for OAuth
├── bin/
│   └── coach.js                 # CLI shim
└── tests/
```

## Configuration

All config stored in `~/.claude-coach/`:

```
~/.claude-coach/
├── config.json          # Strava client_id, client_secret
├── tokens.json          # OAuth tokens (access, refresh, expires_at)
└── coach.db             # SQLite database
```

**config.json:**

```json
{
  "strava": {
    "client_id": "123456",
    "client_secret": "abc..."
  }
}
```

**tokens.json:**

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1234567890,
  "athlete_id": 12345
}
```

## Node.js Config

**package.json:**

```json
{
  "name": "claude-coach",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "coach": "./bin/coach.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "open": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Note:** No native DuckDB npm module. We shell out to the `duckdb` CLI instead, which:

- Avoids native compilation issues
- Works with any DuckDB version the user has installed
- Makes Claude's queries use the same interface as the sync tool

## Implementation Notes

### SQLite via CLI

Shell out to `sqlite3` for all database operations:

```typescript
import { execSync } from "child_process";
import { homedir } from "os";

function query(sql: string): string {
  const dbPath = `${homedir()}/.claude-coach/coach.db`;
  return execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: "utf-8" });
}

// For JSON output (easier to parse)
function queryJson<T>(sql: string): T[] {
  const dbPath = `${homedir()}/.claude-coach/coach.db`;
  const result = execSync(`sqlite3 -json "${dbPath}" "${sql}"`, { encoding: "utf-8" });
  return JSON.parse(result);
}
```

The `sqlite3` CLI is pre-installed on macOS and most Linux distros. For Windows: `winget install SQLite.SQLite`

### Rate Limit Handling

```typescript
async function fetchWithRateLimit(url: string, options: RequestInit) {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") || "900";
    console.log(`Rate limited. Waiting ${retryAfter}s...`);
    await sleep(parseInt(retryAfter) * 1000);
    return fetchWithRateLimit(url, options);
  }

  return response;
}
```

### Sync Strategy

1. **First sync**: Fetch all activities (paginated), then fetch streams for each
2. **Incremental**: Query latest `start_date` from DB, only fetch newer
3. **Streams**: Optional (large data), fetch on-demand or skip for speed

## Future Considerations

- **Garmin supplement**: Add Garmin Connect support for sleep/HRV data Strava lacks
- **Training plan storage**: Persist generated plans, track adherence
- **Workout comparison**: Compare planned vs. actual workouts
- **Export formats**: Generate .ics calendar files, sync to TrainingPeaks
