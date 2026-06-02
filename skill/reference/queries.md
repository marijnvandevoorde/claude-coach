# SQL Queries for Athlete Assessment

Run these queries using the claude-coach CLI:

```bash
npx claude-coach query "YOUR_QUERY" --json
```

This works on any Node.js version (uses built-in SQLite on Node 22.5+, falls back to CLI otherwise).

> **Garmin first for readiness & load.** The SQL below queries the **Strava** activity history in `coach.db`. When Garmin Connect is connected, get _current form_ (readiness, sleep, HRV) and _training load_ (CTL/ATL/TSB, training status, VO₂max) from Garmin instead — the coach pulls these itself via `mcp__coach__garmin_refresh` / `garmin-fetch` (no separate Garmin MCP needed); see `garmin.md`. Use these Strava queries for athletic **foundation** (lifetime peaks, race history, training depth) and as the fallback when Garmin is unavailable.

## Current Form (Last 8 Weeks)

```sql
-- Weekly volume by sport
SELECT
  strftime('%Y-W%W', start_date) AS week,
  sport_type,
  COUNT(*) AS sessions,
  ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
  ROUND(SUM(distance) / 1000.0, 1) AS km
FROM activities
WHERE start_date >= date('now', '-8 weeks')
GROUP BY week, sport_type
ORDER BY week DESC, sport_type;

-- Longest recent sessions by sport
SELECT sport_type,
  ROUND(MAX(moving_time) / 3600.0, 1) AS longest_hours,
  ROUND(MAX(distance) / 1000.0, 1) AS longest_km
FROM activities
WHERE start_date >= date('now', '-12 weeks')
GROUP BY sport_type;

-- Average session duration
SELECT sport_type,
  ROUND(AVG(moving_time) / 60.0, 0) AS avg_minutes,
  ROUND(AVG(distance) / 1000.0, 1) AS avg_km,
  COUNT(*) AS total_sessions
FROM activities
WHERE start_date >= date('now', '-8 weeks')
GROUP BY sport_type;

-- Weekly training load trend
SELECT
  strftime('%Y-W%W', start_date) AS week,
  SUM(suffer_score) AS weekly_load,
  ROUND(SUM(moving_time) / 3600.0, 1) AS total_hours
FROM activities
WHERE start_date >= date('now', '-12 weeks')
GROUP BY week
ORDER BY week;
```

## Athletic Foundation (Lifetime / 2 Years)

```sql
-- Race history (workout_type = 1)
SELECT
  strftime('%Y-%m', start_date) AS month,
  name,
  sport_type,
  ROUND(distance / 1000.0, 1) AS km,
  ROUND(moving_time / 3600.0, 1) AS hours
FROM activities
WHERE workout_type = 1
ORDER BY start_date DESC;

-- Lifetime peaks by sport
SELECT sport_type,
  ROUND(MAX(distance) / 1000.0, 1) AS max_km,
  ROUND(MAX(moving_time) / 3600.0, 1) AS max_hours
FROM activities
GROUP BY sport_type;

-- Peak training weeks ever
SELECT
  strftime('%Y-W%W', start_date) AS week,
  ROUND(SUM(moving_time) / 3600.0, 1) AS total_hours,
  COUNT(*) AS sessions
FROM activities
GROUP BY week
ORDER BY total_hours DESC
LIMIT 5;

-- Training history depth
SELECT sport_type,
  MIN(start_date) AS first_activity,
  MAX(start_date) AS last_activity,
  COUNT(*) AS total_activities,
  ROUND(SUM(distance) / 1000.0, 0) AS lifetime_km
FROM activities
GROUP BY sport_type;
```

## Strength Detection

```sql
-- Efficiency: Low suffer_score per minute = strength
SELECT sport_type,
  ROUND(AVG(distance) / 1000.0, 1) AS avg_km,
  ROUND(AVG(moving_time) / 60.0, 0) AS avg_minutes,
  ROUND(AVG(suffer_score), 0) AS avg_suffer,
  ROUND(AVG(suffer_score * 60.0 / moving_time), 2) AS suffer_per_minute,
  ROUND(AVG(average_heartrate), 0) AS avg_hr
FROM activities
WHERE start_date >= date('now', '-6 months')
  AND moving_time > 1800
GROUP BY sport_type
ORDER BY suffer_per_minute ASC;

-- Long sessions at low HR = aerobic strength
SELECT sport_type,
  COUNT(*) AS easy_long_sessions,
  ROUND(AVG(distance) / 1000.0, 1) AS avg_km,
  ROUND(AVG(moving_time) / 60.0, 0) AS avg_minutes,
  ROUND(AVG(average_heartrate), 0) AS avg_hr
FROM activities
WHERE moving_time > 3600
  AND average_heartrate < 145
  AND start_date >= date('now', '-12 months')
GROUP BY sport_type;

-- Last activity by sport (detect dormant skills)
SELECT sport_type,
  MAX(start_date) AS last_session,
  ROUND(julianday('now') - julianday(MAX(start_date)), 0) AS days_ago,
  COUNT(*) AS total_sessions_last_year
FROM activities
WHERE start_date >= date('now', '-1 year')
GROUP BY sport_type
ORDER BY last_session DESC;

-- Historical peaks (last 2 years)
SELECT sport_type,
  ROUND(MAX(distance) / 1000.0, 1) AS peak_km,
  ROUND(MAX(moving_time) / 3600.0, 1) AS peak_hours,
  MAX(start_date) AS when_achieved
FROM activities
WHERE start_date >= date('now', '-2 years')
GROUP BY sport_type;
```

## Schedule Preferences

```sql
-- Preferred days for long rides (>90 min)
-- Day mapping: 0=Sunday, 1=Monday, ..., 6=Saturday
SELECT
  CASE strftime('%w', start_date)
    WHEN '0' THEN 'Sunday'
    WHEN '1' THEN 'Monday'
    WHEN '2' THEN 'Tuesday'
    WHEN '3' THEN 'Wednesday'
    WHEN '4' THEN 'Thursday'
    WHEN '5' THEN 'Friday'
    WHEN '6' THEN 'Saturday'
  END AS day_name,
  COUNT(*) AS long_rides
FROM activities
WHERE sport_type = 'Ride'
  AND moving_time > 5400
GROUP BY strftime('%w', start_date)
ORDER BY long_rides DESC;

-- Preferred days for long runs (>60 min)
SELECT
  CASE strftime('%w', start_date)
    WHEN '0' THEN 'Sunday'
    WHEN '1' THEN 'Monday'
    WHEN '2' THEN 'Tuesday'
    WHEN '3' THEN 'Wednesday'
    WHEN '4' THEN 'Thursday'
    WHEN '5' THEN 'Friday'
    WHEN '6' THEN 'Saturday'
  END AS day_name,
  COUNT(*) AS long_runs
FROM activities
WHERE sport_type IN ('Run', 'Trail Run')
  AND moving_time > 3600
GROUP BY strftime('%w', start_date)
ORDER BY long_runs DESC;

-- Preferred days for swim sessions
SELECT
  CASE strftime('%w', start_date)
    WHEN '0' THEN 'Sunday'
    WHEN '1' THEN 'Monday'
    WHEN '2' THEN 'Tuesday'
    WHEN '3' THEN 'Wednesday'
    WHEN '4' THEN 'Thursday'
    WHEN '5' THEN 'Friday'
    WHEN '6' THEN 'Saturday'
  END AS day_name,
  COUNT(*) AS swim_sessions
FROM activities
WHERE sport_type = 'Swim'
GROUP BY strftime('%w', start_date)
ORDER BY swim_sessions DESC;
```

## HR / Zone Data

```sql
-- Average HR by sport
SELECT
  sport_type,
  ROUND(AVG(average_heartrate), 0) AS avg_hr,
  ROUND(AVG(max_heartrate), 0) AS avg_max_hr,
  COUNT(*) AS sessions
FROM activities
WHERE average_heartrate IS NOT NULL
  AND start_date >= date('now', '-8 weeks')
GROUP BY sport_type;

-- HR distribution for zone estimation
SELECT
  sport_type,
  ROUND(MIN(average_heartrate), 0) AS min_avg_hr,
  ROUND(AVG(average_heartrate), 0) AS mean_avg_hr,
  ROUND(MAX(average_heartrate), 0) AS max_avg_hr,
  ROUND(MAX(max_heartrate), 0) AS highest_max_hr
FROM activities
WHERE average_heartrate IS NOT NULL
  AND start_date >= date('now', '-12 weeks')
GROUP BY sport_type;
```

## Garmin Readiness & Load (When Connected)

The live readiness/load signals come from **Garmin**, not from SQL — the coach pulls them itself via `mcp__coach__garmin_refresh` / `npx claude-coach garmin-fetch`, then surfaces them through `checkin` / `wellness` (see `garmin.md`). The bare tool names below are the signals; they map to the optional `mcp__garmin__*` server when it's present:

- **Readiness today:** `get_training_readiness(today)` — score + limiting contributor.
- **Recovery context:** `get_sleep_summary(today)`, `get_hrv_data(today)`, `get_rhr_day(today)`, `get_body_battery(today, today)`.
- **Fitness/fatigue/form:** `get_training_load_trend(start, end)` → CTL/ATL/TSB; `get_training_status(today)` → status label + VO₂max.

Claude Coach **caches** the latest readiness/sleep snapshot into `coach.db` whenever `coach checkin` runs, so you can query recent history (and athlete-logged wellness) without re-hitting Garmin:

```sql
-- Last 14 days of cached readiness / sleep / wellness
SELECT
  local_date,
  readiness_score,
  sleep_hours,
  sleep_score,
  resting_hr,
  hrv_status,
  training_status,
  subjective_energy,
  soreness,
  mood
FROM wellness_state
ORDER BY local_date DESC
LIMIT 14;

-- Hydration totals per day (vs. goal in reminder_prefs)
SELECT local_date, total_ml, entries
FROM hydration_daily
LIMIT 14;
```
