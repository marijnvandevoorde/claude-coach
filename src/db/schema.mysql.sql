-- MySQL port of schema.sql (loaded when COACH_DB_DRIVER=mysql).
-- Differences from SQLite: BIGINT for Garmin's large activity ids, VARCHAR for
-- primary-key / indexed / app-read text columns, indexes declared inline (MySQL
-- has no CREATE INDEX IF NOT EXISTS), AUTO_INCREMENT, and DATE_FORMAT in views.
-- Auto-metadata timestamps default to CURRENT_TIMESTAMP; the app also overwrites
-- them via UTC_TIMESTAMP() (see dialect.now()). Reminder timestamps stay VARCHAR
-- because the app reads/compares them as ISO strings.

CREATE TABLE IF NOT EXISTS activities (
  id BIGINT PRIMARY KEY,
  name TEXT,
  sport_type VARCHAR(48),
  start_date VARCHAR(40),
  elapsed_time INT,
  moving_time INT,
  distance DOUBLE,
  total_elevation_gain DOUBLE,
  average_speed DOUBLE,
  max_speed DOUBLE,
  average_heartrate DOUBLE,
  max_heartrate DOUBLE,
  average_watts DOUBLE,
  max_watts DOUBLE,
  weighted_average_watts DOUBLE,
  kilojoules DOUBLE,
  suffer_score INT,
  average_cadence DOUBLE,
  calories DOUBLE,
  description TEXT,
  workout_type INT,
  gear_id VARCHAR(64),
  raw_json LONGTEXT,
  gps_track LONGTEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_activities_date (start_date),
  KEY idx_activities_sport (sport_type),
  KEY idx_activities_sport_date (sport_type, start_date)
);

CREATE TABLE IF NOT EXISTS streams (
  activity_id BIGINT PRIMARY KEY,
  time_data LONGTEXT,
  distance_data LONGTEXT,
  heartrate_data LONGTEXT,
  watts_data LONGTEXT,
  cadence_data LONGTEXT,
  altitude_data LONGTEXT,
  velocity_data LONGTEXT
);

CREATE TABLE IF NOT EXISTS athlete (
  id BIGINT PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  weight DOUBLE,
  ftp INT,
  max_heartrate INT,
  raw_json LONGTEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goals (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_name TEXT,
  event_date VARCHAR(40),
  event_type VARCHAR(48),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  started_at DATETIME,
  completed_at DATETIME,
  activities_synced INT,
  status VARCHAR(16)
);

CREATE TABLE IF NOT EXISTS reminder_prefs (
  id INT PRIMARY KEY,
  bedtime_target VARCHAR(8),
  wake_target VARCHAR(8),
  hydration_goal_ml INT DEFAULT 2500,
  water_cadence_minutes INT DEFAULT 60,
  hydration_per_active_hour_ml INT DEFAULT 500,
  quiet_hours_start VARCHAR(8),
  quiet_hours_end VARCHAR(8),
  timezone VARCHAR(64),
  reminders_enabled INT DEFAULT 1,
  notify_channel VARCHAR(16) DEFAULT 'auto',
  notify_webhook_url TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO reminder_prefs (id) VALUES (1);

CREATE TABLE IF NOT EXISTS hydration_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  local_date VARCHAR(10),
  amount_ml INT NOT NULL,
  source VARCHAR(16) DEFAULT 'manual',
  note TEXT,
  KEY idx_hydration_local_date (local_date)
);

CREATE TABLE IF NOT EXISTS wellness_state (
  local_date VARCHAR(10) PRIMARY KEY,
  sleep_hours DOUBLE,
  sleep_score INT,
  subjective_energy INT,
  soreness INT,
  mood INT,
  weight_kg DOUBLE,
  notes TEXT,
  readiness_score INT,
  body_battery_morning INT,
  resting_hr INT,
  hrv_status VARCHAR(16),
  training_status VARCHAR(48),
  training_minutes INT,
  hrv_weekly_avg DOUBLE,
  hrv_baseline_low INT,
  hrv_baseline_upper INT,
  avg_stress INT,
  acwr DOUBLE,
  acute_load INT,
  chronic_load INT,
  vo2max DOUBLE,
  total_steps INT,
  total_distance_m INT,
  floors_climbed INT,
  intensity_min_moderate INT,
  intensity_min_vigorous INT,
  active_calories INT,
  total_calories INT,
  avg_spo2 INT,
  avg_waking_respiration INT,
  rhr_7day_avg INT,
  body_battery_charged INT,
  garmin_raw LONGTEXT,
  last_water_reminder_at VARCHAR(32),
  last_bedtime_reminder_at VARCHAR(32),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS garmin_pushed_workouts (
  push_key VARCHAR(160) PRIMARY KEY,
  workout_id BIGINT NOT NULL,
  schedule_id BIGINT,
  name TEXT,
  date VARCHAR(10),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  local_date VARCHAR(10),
  entry TEXT NOT NULL,
  tag VARCHAR(48),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_journal_date (local_date)
);

CREATE OR REPLACE VIEW hydration_daily AS
SELECT local_date, SUM(amount_ml) AS total_ml, COUNT(*) AS entries
FROM hydration_log
GROUP BY local_date
ORDER BY local_date DESC;

CREATE OR REPLACE VIEW weekly_volume AS
SELECT
  DATE_FORMAT(start_date, '%x-W%v') AS week,
  sport_type,
  COUNT(*) AS sessions,
  ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
  ROUND(SUM(distance) / 1000.0, 1) AS km,
  ROUND(AVG(average_heartrate), 0) AS avg_hr,
  ROUND(AVG(suffer_score), 0) AS avg_effort
FROM activities
GROUP BY week, sport_type
ORDER BY week DESC, sport_type;

CREATE OR REPLACE VIEW recent_activities AS
SELECT
  DATE(start_date) AS date,
  sport_type,
  name,
  moving_time / 60 AS minutes,
  ROUND(distance / 1000.0, 1) AS km,
  ROUND(average_heartrate, 0) AS hr,
  suffer_score
FROM activities
ORDER BY start_date DESC
LIMIT 50;
