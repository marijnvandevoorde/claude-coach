# Coach Web App — Product & Data Spec

The build spec for the read-mostly web app at **coach.small-victories.co/app**. Distilled from
the coach/athlete panel (head endurance coach, HRV/recovery sports scientist, semi-pro trail
runner, amateur age-group triathlete). Companion to [`app-design.md`](app-design.md) (UX) and the
engineering tickets in the Sprint-6 epic.

## North star

When the athlete opens the app in the morning, it should answer one question fast: **train as
planned / modify / back off — today?** Everything else is browsing history. The dashboard serves
that decision; the calendar, trends, activities, and journal serve exploration.

One app, two literacy levels (amateur ↔ semi-pro), resolved by **progressive disclosure** — plain
language + colour bands by default, raw numbers + the factor math one tap deeper — not two modes.

## Non-negotiable principles

1. **Readiness is reconstructed — say so.** The 0–100 readiness is our model (sleep + ACWR +
   HRV-vs-SWC + sleep-regularity + stress + subjective), not Garmin-native. Always: label it
   "reconstructed", show the **factor breakdown**, the **computation window**, and a
   **data-coverage badge** when inputs are missing (e.g. "HRV: 2 of 3 nights missing — score
   degraded"). Never present a confident number built on silently-imputed data.
2. **No single-night metric with an arrow.** HRV, resting HR, and weight as last-night values with
   up/down arrows are noise theatre. Default to **rolling means vs a baseline band**; bury the
   daily value behind a tap.
3. **Journal lives with the numbers.** Surface entries as annotations on calendar days and on
   trend charts (an "illness" tag annotates the HRV dip), not in an orphan tab.
4. **6-week default window** on every trend (the load-adaptation timescale); 7d / 6w / season are
   one-tap toggles. Season view carries **race/goal markers**.
5. **It's a browse app.** Writes are limited to ~3 quick actions (below). Do not rebuild a
   training log; workouts and wellness imports stay read-only (provenance-tagged "from Garmin").

## Feature list (MUST / SHOULD / COULD)

### Dashboard / Today

- **MUST — Readiness, plain + honest.** Reconstructed 0–100 as a ring gauge with a green/amber/red
  band and a one-sentence verdict ("Recovered — proceed as planned"). "Reconstructed" label +
  info icon; tap → factor breakdown.
- **MUST — Readiness factor breakdown.** Each factor (sleep, ACWR, HRV-vs-SWC, sleep regularity,
  stress, subjective) as a signed contribution (diverging bars) with raw value beside it + the
  data-coverage badge.
- **MUST — Load status.** ACWR (band chip "Optimal/Building/Caution" by default, decimal on tap),
  acute vs chronic load sparkline (6w), training_status label.
- **MUST — Last night's sleep.** sleep_hours, sleep_score, body_battery_morning as stat tiles; tap
  sleep → stage breakdown (deep/light/REM/awake) from `garmin_raw`.
- **MUST — Yesterday's session.** One activity card (sport, distance, time, elevation, avg HR,
  suffer_score); tap → full activity.
- **SHOULD — Morning HRV vs baseline.** LnRMSSD 7-day mean vs the SWC band; dot coloured
  in/below/above band. Never a bare single-night number.
- **SHOULD — One-sentence "today" verdict** synthesising readiness + load, clearly labelled
  guidance not gospel.

### Trends (every chart: 7d / 6w / season; default 6w)

- **MUST — Performance Management Chart.** acute (fatigue) vs chronic (fitness) load + form area;
  season default; **race/goal markers** on the axis.
- **MUST — HRV trend.** weekly avg / LnRMSSD vs shaded baseline band.
- **SHOULD — Resting HR.** rhr_7day_avg line with faint daily dots + baseline reference.
- **SHOULD — Sleep duration & regularity.** duration bars + a bed/wake consistency strip.
- **SHOULD — Weekly volume & vertical.** stacked weekly bars by sport; **trail/ultra: vertical &
  time-on-feet lead; amateur: distance + intensity minutes.**
- **COULD — VO₂max & race predictions** (motivating for amateurs; caveat "treadmill-biased, ignore
  on technical terrain"). **COULD — heat/altitude acclimation** (only during such a block).
  **COULD — daytime stress / body-battery curve.**

### Calendar

- **MUST — Month/year grid, multi-signal cells.** Each day: readiness tint (background), a load
  dot, a sport icon if trained, a journal/tag marker. Reveals a block's shape and missed recoveries
  at a glance.
- **MUST — Day Detail panel.** Tapping a day shows everything: readiness + factors, sleep,
  activities, subjective ratings, hydration total, and **the day's journal inline**.
- **SHOULD — Block/phase shading + race markers** so build/taper/recovery weeks are visible.

### Journaling

- **MUST — Entries as day annotations** (calendar cell marker + inline in Day Detail).
- **SHOULD — Tag markers pinned onto trend charts**; tag filter to highlight all "calf"/"travel"
  days.
- **COULD — Tag mini-insights** ("days tagged 'poor sleep' average −9 readiness") — descriptive,
  explicitly correlational, never causal advice.

### Activity detail (per sport)

Tapping an activity opens a detail whose fields **adapt to the sport** — show what that session
actually records, never fake fields:

- **Run** (incl. treadmill w/ GPS): distance, duration, avg pace, avg/max HR, cadence, elevation,
  calories, effort; per-km **splits**; HR-over-time.
- **Outdoor cycling:** distance, duration, avg/NP/max **power**, avg speed, avg HR, elevation, calories.
- **Indoor cycling (trainer):** duration, avg/NP/max **power**, cadence, avg/max HR, calories (no GPS/distance).
- **Swim:** distance (m), duration, pace /100m, avg HR, calories.
- **Strength / gym & machine cardio (treadmill / stairmaster / elliptical):** **duration + heart rate
  (+ calories) only** — that's all these record. Say so honestly; let the athlete add sets/reps,
  incline, or level as a **day-linked journal note** (tied to the day, not the activity — there are no
  per-activity custom fields, and that's fine).

Data note: `activities` already has power columns (`average_watts` / `max_watts` /
`weighted_average_watts` / `kilojoules`) + `suffer_score`, and `raw_json` retains the full Garmin
payload — so these per-sport fields exist today (the daily mapper just doesn't promote all of them to
columns yet; a small ticket if a field needs to be queryable).

### Quick actions (writes — strictly limited)

- **MUST — Water log, 100 ml taps.** `+100 / +250 / +500 ml` → `hydration_log`; running daily total
  - goal ring; optimistic + 5s undo. The flagship write.
- **MUST — Subjective check-in.** energy / soreness / mood (1–5), one tap each; upserts today's
  `wellness_state` and visibly updates the readiness factors.
- **SHOULD — Quick journal note.** one text field + tag, posts to `journal` for today.
- **COULD — "Felt like" RPE** on yesterday's session. Nothing beyond this — no workout logging, no
  editing imported wellness.

### Amateur vs semi-pro

- **MUST — Progressive disclosure** everywhere (bands + plain language default; numbers/decimals/
  factor math one tap deeper).
- **SHOULD — A density/"experience level" toggle** that reorders the dashboard (amateur surfaces
  readiness verdict + VO₂max + race predictor; semi-pro surfaces PMC + ACWR decimal + vertical/
  time-on-feet).

## Pitfalls to avoid

1. False precision / fake authority on readiness (always label, show factors, window, coverage).
2. Single-night metrics with arrows (use rolling means vs bands).
3. Dashboard clutter (if a metric doesn't change today's session, it's not on the dashboard).
4. Decimal-dumping for amateurs (lead with colour + a sentence; reveal numbers on demand).
5. Journal as an orphan tab (annotate days and charts).
6. Scope creep on quick actions (3–4 writes max).
7. Wrong default window (6 weeks, not 7 days or full season).
8. VO₂max worship (show, caveat, never let it drive a recovery decision).
9. Over-interpreting correlations (descriptive only).
10. Reconstruction drift — if the readiness formula changes, historical scores shift; version the
    score / note recompute dates so trends stay trustworthy.

## Data sources (MySQL `coach`)

- `wellness_state` (per day, PK `local_date`): the metrics above + `garmin_raw` JSON (sleep stages,
  ~100 nightly HRV readings, load focus, heat/altitude acclimation).
- `activities`: sport_type, name, start_date, distance, moving/elapsed_time, elevation, avg/max HR,
  watts, suffer_score, calories, cadence.
- `journal`: entry, tag, local_date. `hydration_log`: amount_ml, local_date, source.
- Views: `weekly_volume`, `recent_activities`, `hydration_daily`.
