-- Core activity data
CREATE TABLE IF NOT EXISTS activities (
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
  gps_track TEXT,                   -- compact GPS track [[lat,lon,ele?],…]; '[]' = fetched, no track
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Time-series streams (HR, power, pace over time)
CREATE TABLE IF NOT EXISTS streams (
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
CREATE TABLE IF NOT EXISTS athlete (
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
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT,                  -- "Ironman 70.3 Oceanside"
  event_date TEXT,                  -- ISO 8601
  event_type TEXT,                  -- triathlon, marathon, ultra, century
  notes TEXT,                       -- constraints, injuries, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  completed_at TEXT,
  activities_synced INTEGER,
  status TEXT                       -- success, failed, partial
);

-- ============================================================================
-- Wellness & reminder state (Garmin + proactive coaching)
-- ============================================================================

-- Reminder preferences (single row, id = 1). Drives cron + in-session nudges.
CREATE TABLE IF NOT EXISTS reminder_prefs (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- enforce a single config row
  bedtime_target TEXT,                    -- local 'HH:MM' lights-out target
  wake_target TEXT,                       -- local 'HH:MM' wake target
  hydration_goal_ml INTEGER DEFAULT 2500, -- daily water goal (ml)
  water_cadence_minutes INTEGER DEFAULT 60, -- min between water nudges while awake
  hydration_per_active_hour_ml INTEGER DEFAULT 500, -- extra fluid goal per hour of training
  quiet_hours_start TEXT,                 -- local 'HH:MM' — no reminders after
  quiet_hours_end TEXT,                   -- local 'HH:MM' — no reminders before
  timezone TEXT,                          -- IANA tz, e.g. 'Europe/Brussels'
  reminders_enabled INTEGER DEFAULT 1,    -- 0/1 master switch
  notify_channel TEXT DEFAULT 'auto',     -- auto | webhook | macos | stdout
  notify_webhook_url TEXT,                -- push webhook (e.g. Home Assistant webhook URL)
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Ensure the single config row always exists so reads never return empty.
INSERT OR IGNORE INTO reminder_prefs (id) VALUES (1);

-- Hydration intake log (many events per day; totals are summed per local_date).
CREATE TABLE IF NOT EXISTS hydration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at TEXT DEFAULT (datetime('now')), -- UTC ISO 8601
  local_date TEXT,                          -- athlete-local 'YYYY-MM-DD' for daily totals
  amount_ml INTEGER NOT NULL,
  source TEXT DEFAULT 'manual',             -- manual | reminder | garmin
  note TEXT
);

-- Daily wellness snapshot (one row per local_date). Mix of athlete-logged
-- subjective data, cached Garmin signals, and reminder bookkeeping.
CREATE TABLE IF NOT EXISTS wellness_state (
  local_date TEXT PRIMARY KEY,    -- athlete-local 'YYYY-MM-DD'
  -- athlete-logged / subjective
  sleep_hours REAL,
  sleep_score INTEGER,            -- 0-100
  subjective_energy INTEGER,      -- 1-5 self-reported
  soreness INTEGER,               -- 1-5
  mood INTEGER,                   -- 1-5
  weight_kg REAL,
  notes TEXT,
  -- cached Garmin signals (snapshot taken at last check-in)
  readiness_score INTEGER,        -- 0-100 (Garmin Training Readiness, when the device exposes it)
  body_battery_morning INTEGER,   -- 0-100 (Body Battery at wake time)
  resting_hr INTEGER,
  hrv_status TEXT,                -- balanced | unbalanced | low
  training_status TEXT,          -- Garmin training status label
  training_minutes INTEGER,      -- today's planned/actual training load (minutes)
  -- raw inputs for the from-scratch readiness model (when readiness_score is null)
  hrv_weekly_avg REAL,           -- 7-day average overnight HRV (ms)
  hrv_baseline_low INTEGER,      -- personal HRV "balanced" band lower bound (ms)
  hrv_baseline_upper INTEGER,    -- personal HRV "balanced" band upper bound (ms)
  avg_stress INTEGER,            -- Garmin all-day average stress (0-100; rest <=25)
  acwr REAL,                     -- acute:chronic workload ratio (7d/28d)
  acute_load INTEGER,            -- acute training load (EPOC, 7-day normalized)
  chronic_load INTEGER,          -- chronic training load (28-day)
  -- expanded daily Garmin metrics (from usersummary + training status)
  vo2max REAL,                   -- current VO2max (precise value)
  total_steps INTEGER,
  total_distance_m INTEGER,      -- daily distance, meters
  floors_climbed INTEGER,
  intensity_min_moderate INTEGER,
  intensity_min_vigorous INTEGER,
  active_calories INTEGER,
  total_calories INTEGER,
  avg_spo2 INTEGER,              -- daily average SpO2 %
  avg_waking_respiration INTEGER,-- breaths/min while awake
  rhr_7day_avg INTEGER,          -- Garmin's 7-day average resting HR
  body_battery_charged INTEGER,  -- body battery charged over the day (recovery proxy)
  garmin_raw TEXT,               -- full daily payload (summary + training status + sleep + hrv) as JSON
  -- reminder bookkeeping (so nudges don't repeat)
  last_water_reminder_at TEXT,    -- UTC ISO 8601
  last_bedtime_reminder_at TEXT,  -- UTC ISO 8601
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Garmin workouts this coach has pushed, so re-pushing a plan UPDATES them in place
-- (by stored workoutId) instead of creating duplicates.
CREATE TABLE IF NOT EXISTS garmin_pushed_workouts (
  push_key TEXT PRIMARY KEY,       -- stable per plan day-workout: `${date}|${name}`
  workout_id INTEGER NOT NULL,     -- Garmin workoutId
  schedule_id INTEGER,             -- Garmin workoutScheduleId (when scheduled on a date)
  name TEXT,
  date TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Free-text journal entries (athlete feedback / notes). One row per entry; a day
-- can have several. Complements the structured mood/energy/soreness `log`.
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_date TEXT,                          -- athlete-local 'YYYY-MM-DD'
  entry TEXT NOT NULL,
  tag TEXT,                                 -- optional free label (e.g. 'race', 'niggle')
  created_at TEXT DEFAULT (datetime('now')) -- UTC ISO 8601
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(local_date);

CREATE INDEX IF NOT EXISTS idx_hydration_local_date ON hydration_log(local_date);

DROP VIEW IF EXISTS hydration_daily;
CREATE VIEW hydration_daily AS
SELECT
  local_date,
  SUM(amount_ml) AS total_ml,
  COUNT(*) AS entries
FROM hydration_log
GROUP BY local_date
ORDER BY local_date DESC;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(start_date);
CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
CREATE INDEX IF NOT EXISTS idx_activities_sport_date ON activities(sport_type, start_date);

-- Useful views
DROP VIEW IF EXISTS weekly_volume;
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

DROP VIEW IF EXISTS recent_activities;
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
