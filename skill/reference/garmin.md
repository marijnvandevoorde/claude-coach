# Garmin Connect: Tool → Coaching-Signal Map

Garmin Connect is the **primary source for recovery, readiness, and load** in Claude Coach. Where Strava tells you _what the athlete did_, Garmin tells you _how their body is responding_ — sleep, HRV, stress, body battery, resting heart rate, training readiness, and Garmin's own training-status/load model (CTL/ATL/TSB) and VO₂max.

**By default the coach reads Garmin itself** — `mcp__coach__garmin_refresh` (remote connector) or `npx claude-coach garmin-fetch` (local CLI) pull live data from Garmin Connect using the saved tokens and cache it in `coach.db`, where `checkin` / `wellness` surface it as recovery readiness. **No separate Garmin MCP is required.**

The standalone [`garmin_mcp`](https://github.com/Taxuspt/garmin_mcp) server (`mcp__garmin__*` tools, e.g. `mcp__garmin__get_training_readiness`) is **optional** — useful only in a local Claude Code session for richer _live_ signals the coach doesn't yet cache (full CTL/ATL/TSB load trend, VO₂max trend, endurance/hill scores) or to push workouts to the watch. This document refers to Garmin signals by a **bare name** (`get_training_readiness`); those map to `mcp__garmin__*` tools when that server is present, but the headline signals (readiness, sleep, HRV + baseline, stress, body battery, training status, activities) also come through `garmin_refresh` → `checkin` / `wellness` without it.

> **Garmin is optional — never block plan creation on it.** Prefer `mcp__coach__garmin_refresh` (or `claude-coach garmin-fetch`); use `mcp__garmin__*` only if present and you need a signal the coach doesn't cache. If no Garmin path is available at all, fall back to Strava/manual and skip the Garmin-specific steps.

## Conventions

- **Dates** are `YYYY-MM-DD` strings. "Today" means the athlete's local date.
- Single-day tools take `date`; trend tools take `start_date` and `end_date`.
- Garmin metrics reflect **last night / today** — pull them fresh at assessment time and again at each daily check-in, not from a cached sync.
- Many values come from Garmin's FirstBeat algorithms and are **smoothed**: a one-day swing matters less than a multi-day direction. Always prefer trends over single readings for load and fitness decisions.

---

## The map: which signal, which tool, what it means

### 1. Daily readiness — "how hard can the athlete go today?"

| Signal                 | Tool                                                       | Read                                                                                          | Coaching decision                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Training readiness** | `get_training_readiness(date)`                             | `score` (0–100) + contributors (sleep, recovery time, HRV status, acute load, stress history) | The single best "go / hold back" number. **<25 poor / 25–40 low / 40–55 moderate / 55–75 high / 75+ prime.** Low → swap a quality session for easy aerobic or recovery; prime/high → green-light a key session. _Not every watch computes this_ — when it's empty, the coach reconstructs it (see below). |
| **Body battery**       | `get_body_battery(start_date, end_date)`                   | Morning charge (0–100) + overnight drain/recharge                                             | Confirms readiness. A morning start <30 means the athlete went to bed under-recovered — protect the day.                                                                                                                                                                                                  |
| **Sleep**              | `get_sleep_summary(date)` (or `get_sleep_data` for stages) | `score`, total duration, deep/REM, restlessness                                               | Sleep is the foundation of readiness. <6 h or score <50 after a hard day → downgrade intensity. Recurring poor sleep → flag lifestyle/load, not just today's session.                                                                                                                                     |
| **HRV (overnight)**    | `get_hrv_data(date)`                                       | `status` (balanced/unbalanced/low) + last-night avg vs. baseline                              | A drop below the athlete's balanced range is an early overreaching signal **before** performance falls. Two+ days low → insert recovery.                                                                                                                                                                  |
| **Resting HR**         | `get_rhr_day(date)`                                        | RHR for the day                                                                               | Elevated RHR (≳5–7 bpm over baseline) corroborates HRV suppression / incoming illness / under-recovery.                                                                                                                                                                                                   |
| **Stress**             | `get_stress_data(date)`                                    | All-day stress avg + rest minutes                                                             | Chronically high daytime stress means recovery sessions aren't actually recovering. Factor into total load, not just training.                                                                                                                                                                            |

**Daily-readiness recipe** (use at assessment and at each check-in):

1. `get_training_readiness(today)` → headline number + the limiting contributor.
2. If readiness is low/moderate, look at _why_: `get_sleep_summary(today)`, `get_hrv_data(today)`, `get_rhr_day(today)`, `get_body_battery(today, today)`.
3. Translate into an adjustment to **today's planned workout** (keep / reduce intensity / reduce volume / convert to recovery / rest). Always explain the "why" from the data.

#### Reconstructed readiness (devices without native Training Readiness)

Training Readiness is device-dependent; some watches (and the unofficial API for them) return nothing. The coach handles this server-side:

- **`mcp__coach__garmin_refresh`** (or `npx claude-coach garmin-fetch`) pulls live Garmin data — sleep score, **HRV 7-day average + personal baseline band**, **all-day average stress**, **ACWR with acute/chronic load**, **Body Battery at wake time**, and recent activities — and stores it in `coach.db`. The server also runs this every morning before the check-in.
- **`mcp__coach__checkin`** then returns a **reconstructed readiness** when the native score is absent: it weights the same factors Garmin documents — **sleep score + recovery/load (ACWR)** as primary drivers, then **HRV-vs-baseline, stress, sleep history** as secondary — onto the same 0–100 / Poor→Prime scale, and reports the factor breakdown. It deliberately does **not** fold in Body Battery or Training Status (they're composites of these same signals — that would double-count); those stay as context. See `adaptive.md` → "Native vs. reconstructed readiness" for how to read the factors.

> This is the primary path on **Claude Desktop / mobile**, where the `mcp__garmin__*` tools usually aren't present but the coach connector is. Prefer `mcp__coach__garmin_refresh` → `mcp__coach__checkin` there.

### 2. Training load & fitness trend — "is the plan working / is the athlete digging a hole?"

| Signal                       | Tool                                                            | Read                                                                                                                                | Coaching decision                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Training status**          | `get_training_status(date)`                                     | Status label (Productive / Maintaining / Peaking / Overreaching / Unproductive / Detraining / Recovery), acute load, current VO₂max | The headline state of the athlete's training. "Overreaching"/"Unproductive" → back off or add recovery; "Detraining"/"Maintaining" when you want progression → load is too low.                         |
| **Load trend (CTL/ATL/TSB)** | `get_training_load_trend(start_date, end_date)`                 | Garmin's Performance Management Chart: chronic load (CTL/fitness), acute load (ATL/fatigue), and balance (TSB/form)                 | Use these values **directly** as fitness/fatigue/form instead of estimating from Strava suffer scores. See `load-management.md` for targets (e.g. ramp rate, TSB ranges for key sessions and race day). |
| **VO₂max (current)**         | `get_training_status(date)` → `vo2_max`                         | Current estimate                                                                                                                    | Anchor for aerobic fitness and pace/power potential. Cross-check zones.                                                                                                                                 |
| **VO₂max (trend)**           | `get_vo2max_trend(start_date, end_date)`                        | Smoothed estimates + net change                                                                                                     | Rising = stimulus is landing. Flat/declining over 4+ weeks = insufficient stimulus or overreaching.                                                                                                     |
| **HRV trend**                | `get_hrv_trend(start_date, end_date)`                           | Multi-week HRV direction                                                                                                            | Confirms whether the athlete is adapting (stable/rising baseline) or accumulating fatigue (declining).                                                                                                  |
| **Endurance / hill score**   | `get_endurance_score(start, end)`, `get_hill_score(start, end)` | Garmin's durability & climbing scores                                                                                               | Useful for ultra/hilly-course athletes to verify event-specific fitness is building.                                                                                                                    |
| **Fitness age**              | `get_fitnessage_data(date)`                                     | Fitness age vs. chronological                                                                                                       | A motivational, holistic check; secondary to the metrics above.                                                                                                                                         |

### 3. Thresholds & zones — anchoring intensity

| Signal                           | Tool                               | Read                       | Use                                                                                                            |
| -------------------------------- | ---------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Cycling FTP**                  | `get_cycling_ftp()`                | Latest FTP (watts)         | Seed/validate bike power zones (`zones.md`). Prefer a recent field test if Garmin's value looks stale.         |
| **Lactate threshold**            | `get_lactate_threshold()`          | LTHR and/or threshold pace | Seed run/HR zones.                                                                                             |
| **Per-activity training effect** | `get_training_effect(activity_id)` | Aerobic & anaerobic TE     | Verify a workout delivered its intended stimulus (e.g. a "threshold" session actually scored high aerobic TE). |

### 4. Activity history — what was actually done

Garmin can also serve activity history (useful when the athlete is Garmin-only, no Strava):

| Need                                             | Tool                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Recent activities (paged)                        | `get_activities(start, limit)`                                               |
| Activities in a date range                       | `get_activities_by_date(start_date, end_date)`                               |
| One activity's detail                            | `get_activity(activity_id)`                                                  |
| Splits / laps                                    | `get_activity_splits(activity_id)`, `get_activity_typed_splits(activity_id)` |
| Time in HR / power zones                         | `get_activity_hr_in_timezones(id)`, `get_activity_power_in_timezones(id)`    |
| Weather during activity                          | `get_activity_weather(activity_id)`                                          |
| Total count                                      | `count_activities()`                                                         |
| Advanced cycling (FIT parse: PDC, HR drift, Di2) | `get_activity_fit_data(...)`, `get_power_duration_curve(...)`                |

> If both Strava and Garmin are connected, prefer **Strava's `coach.db`** for bulk activity history (it's already synced and queryable via `npx claude-coach query`) and use **Garmin** for the recovery/readiness/load signals above.

### 5. Daily stats, body & hydration

| Need                                                                 | Tool                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Curated daily stats (steps, HR, stress, body battery, sleep summary) | `get_stats(date)`                                     |
| Stats + body composition together                                    | `get_stats_and_body(date)`                            |
| Body composition (weight, body fat)                                  | `get_body_composition(start_date, end_date)`          |
| Steps detail / range                                                 | `get_steps_data(date)`, `get_daily_steps(start, end)` |
| Resting HR                                                           | `get_rhr_day(date)`                                   |
| Hydration logged on Garmin                                           | `get_hydration_data(date)`                            |

**Write-back tools** (Garmin can also store data the coach/athlete logs):

| Action                     | Tool                        |
| -------------------------- | --------------------------- |
| Log water intake to Garmin | `add_hydration_data(...)`   |
| Log a weigh-in             | `add_body_composition(...)` |

> Claude Coach keeps its **own** wellness/hydration state in `coach.db` (see `coach log` / `coach checkin`). Garmin's hydration tool is optional and only relevant if the athlete wants intake mirrored into Garmin Connect.

---

## How Garmin fits the coaching workflow

- **Assessment (Phase 1):** lead with Garmin readiness/sleep/HRV for _current form_ and `get_training_load_trend` for _fitness/fatigue_; use Strava/`coach.db` history for the longer _foundation_ picture. See `assessment.md`.
- **Load setting (Phase 3):** take CTL/ATL/TSB from `get_training_load_trend` instead of estimating from suffer scores. See `load-management.md`.
- **Daily check-ins (ongoing):** the `coach checkin` CLI routine pulls today's readiness + sleep alongside the planned workout and wellness state to produce a recovery-aware nudge. See `coach checkin` in `SKILL.md`.

## Graceful degradation

If no Garmin path resolves a signal — `mcp__coach__garmin_refresh` / `garmin-fetch` returns nothing for it, and the optional `mcp__garmin__*` tools are absent too — or a specific call returns "no data found" (common for metrics a given watch model doesn't record — e.g. some devices lack HRV or training readiness):

- Continue with whatever signals _are_ available.
- Fall back to Strava-derived load (suffer score / duration) and HR data.
- Tell the athlete which signal is missing and what you used instead, so the recommendation stays transparent.
