# Handoff: Coach — Endurance Training & Recovery App

## Overview

**Coach** is a personal, single-user web app to browse one athlete's endurance-training & health
data (2021→today, ~1,900 days), pulled from a watch (Garmin) and training log. It is **read-mostly**
with a few one-tap, optimistic, undoable writes.

The one job: answer fast — **"train as planned / modify / back off — today?"** The dashboard serves
that decision; the calendar, trends, activities, and journal serve exploration.

- **Mobile-first**, then scale up. **Dark + light both supported.**
- It will be a static SPA behind Cloudflare Access talking to a **read-only JSON API** — design for
  client-rendered data with loading/empty/error states.

## About the Design Files

The files in this bundle are **design references created in HTML/React (via in-browser Babel)** —
prototypes that show the intended look, layout, and behavior. They are **not production code to copy
directly**. The task is to **recreate these designs in your target codebase** using its established
framework, component library, and patterns (React/Vue/Svelte/SwiftUI/etc.). If no front-end exists
yet, pick the framework best suited to the project and implement there.

The prototype uses a deterministic mock-data engine (`data.js`) purely to populate realistic content;
in production this is replaced by your read-only JSON API. Treat `data.js` as a **data-shape
reference** (see Data Model) rather than code to port.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, chart styling, and interactions are all
specified. Recreate the UI faithfully using your codebase's libraries. The exact token values are in
**Design Tokens** below; the running prototype is the source of truth for anything ambiguous.

## How to run the prototype

Open `Coach App.html` in a browser (it loads React 18 + Babel from a CDN and the local `.jsx`/`.css`
files). No build step. A **Tweaks** panel (palette + light/dark + demo-state switches) is wired via a
host protocol; it stays hidden unless activated, so you can ignore it when reading the UI.

---

## Global Layout & Shell

- The app is rendered inside a **mock iPhone frame** (`.phone` → `.phone-screen`) only for
  presentation. In production, the **`.phone-screen` contents** are the actual app viewport. Design
  width reference: **390 px** (content), 844 px tall frame.
- Structure inside the screen:
  - **Status bar** (mock; drop in production).
  - **Scrollable screen content** (`.scroll` → `.page`, padding `0 16px 120px`).
  - **Fixed bottom tab bar** (`.tabbar`) + iOS home indicator (mock).
  - **Bottom sheets** (`.sheet`) + **undo toast** (`.toast`) overlay the whole screen.
- `data-theme` (`light`|`dark`) and `data-scheme` (palette name) are set on `.phone-screen`; in
  production set them on your root app element. **Default: `light` + `lagoon`.**

### Bottom tab bar

Five tabs, equal width, icon + 9.5px mono label. Active tab uses `--accent`; inactive uses
`--text-3`. Order: **Today, Calendar, Trends, Activity, Journal**. Backdrop-blur translucent bar with
a top hairline. Min 44px tap targets.

---

## Responsive / Desktop

The app is **responsive with a shell swap**, not just a fluid mobile layout:

- **< 900px (mobile):** bottom **tab bar**, single-column cards, Day Detail / Activity Detail as a
  **bottom sheet** (slide up).
- **≥ 900px (desktop):** a fixed **left sidebar** (244px: brand, vertical nav, a readiness status
  line, and the light/dark toggle) replaces the tab bar; content is centered (max-width ~1080px) and
  the Dashboard + Trends become a **2-column masonry** at ≥1180px (single column 900–1180px); Day
  Detail / Activity Detail open as a **440px right-side drawer** (slide in from the right).
- The prototype exposes a **Layout** tweak (`auto` / `phone` / `desktop`) to force a mode; production
  should just use `auto` (a CSS/JS breakpoint at ~900px). In code, the only structural difference is
  the shell (sidebar vs tab bar) and the drawer-vs-sheet direction — all screen cards are shared.
- Implementation note from the prototype: the desktop CSS is scoped under a `.desktop` root class so
  the same screen markup reflows; the right-drawer is the same sheet component with
  `transform: translateX` instead of `translateY`.

---

## Screens / Views

### 1. Today / Dashboard

**Purpose:** Answer the train/modify/back-off question in <5s, then offer quick logging.

**Layout** (single column, 12px gaps between cards):

1. **Top bar** — eyebrow (full date, mono uppercase 11px) + `Today` (display 27px/600); a
   theme-toggle icon button (sun/moon) on the right.
2. **Readiness hero card** (the centerpiece):
   - **Ring gauge**, 196px, a ¾-sweep arc (270°, rotated so the gap is bottom-center). Track =
     `--track`; value arc = the **readiness band color** with a soft outer glow
     (`drop-shadow(0 0 7px <band>/45%)`). Arc animates from 0 on mount (1.1s ease).
     - Center: big number (display 60px/600, band-colored) + `/ 100 · est.` (mono 12px, `--text-3`).
   - **"Estimated readiness" pill button** (mono 10px uppercase, info icon) → opens the
     **reconstruction info popover** (see Interactions). This is mandatory: readiness must read as a
     **derived/estimated score, not a device metric**.
   - **Verdict headline** (display 21px/600, band-colored) + **sub-sentence** (`--text-2`, 14px,
     centered, max ~280px). Verdict text maps from the score (see Verdict Mapping).
3. **Hydration quick-add card** (the flagship write) — see Quick Actions. Placed second so the
   primary tap target is high.
4. **"What moved it" card** — plain-language summary of the factor contributions
   ("Sleep and how you felt lifted your score; HRV and training load held it back.") with a **"Show
   numbers"** toggle that expands the **signed factor bars** (progressive disclosure).
5. **Last night card** (tap → opens Day Detail) — `Nh Mm` asleep (mono 30px), sleep score, and a
   **sleep-stage bar** (deep/REM/light/awake segments with a legend).
6. **Recovery signals** — section label + a 2×2 **metric tile** grid:
   - **HRV** (ms) — value + a **context bar** showing the rolling **baseline band** with a dot for
     today; note reads "within/above/below baseline band". Color `--m-hrv`.
   - **Resting HR** (bpm) — value + a 14-day **sparkline**; note "14-day trend". Color `--m-rhr`.
   - **Body battery** (/100) — value + fill bar. Color `--m-batt`.
   - **Load · ACWR** — 2-decimal ratio; color = `--go` if 0.8–1.3 else `--modify`; note
     "in the sweet spot / ramping — caution / detraining risk".
7. **Today's plan card** — derived session (sport chip + title + detail) and a **coach suggestion**
   row (band-colored, mirrors the verdict).

**States:**

- **Loading** — skeleton shimmer version (ring circle + bars). Shown briefly on mount (~850ms) and
  whenever data is pending.
- **Empty / "no sync"** — ring shows `—`, headline "Waiting on your watch", explanatory sub, an
  empty-state block, and the hydration quick-add still available (you can log water without device
  data). Readiness cannot be computed without sleep + HRV.

### 2. Calendar

**Purpose:** Make a training block's _shape_ (build / recover / race) legible at a glance.

- **Metric picker** (segmented): Readiness (default) / Load / Sleep / HRV — recolors the cells.
- **GitHub-style heatmap**, "Last 14 months", horizontally scrollable; **13px cells, 3px gaps**,
  7 rows (Sun→Sat) × ~60 week columns; month labels along the top. Color = chosen metric (readiness
  uses the 6-stop band ramp `--r1..--r6`; other metrics use a pale→accent intensity ramp).
  **Gap days** (watch not worn) render as a diagonal-hatch cell; **future/no-data** cells are
  transparent. Tap any cell → Day Detail. Legend: "low … high" + a hatch swatch for "no watch".
- **Month grid** below (finger-friendly), with prev/next month nav. Each cell: day number (top-left),
  metric tint background, readiness number centered (when on readiness), a **journal marker dot**
  (top-right, colored by tag), today ringed in `--accent`, future days dimmed. Tag legend row.
- Mobile is the month grid + scrollable heatmap; on desktop the heatmap can run wider.

### 3. Day Detail (shared overlay)

**Purpose:** Everything for one day. Opens as a **bottom sheet** (mobile) — on desktop, implement as
a right side-drawer. Reused from Dashboard, Calendar, Trends, and Journal.

- Header: weekday + full date, and **‹ / ›** stepper to move between days (disabled at range ends).
- Body (when data present): small **readiness ring** (92px) + band pill + verdict; **factor
  breakdown** bars; **sleep** card (hours + stage bar); a grid of **MiniStats** (HRV w/ band,
  Resting HR, Body battery, Stress, ACWR w/ acute/chronic load, Steps); **activity** card if any;
  **subjective check-in** values; **hydration** total (today); and the day's **journal entries**
  inline.
- **Gap state:** "Watch wasn't worn" empty block (+ any manually-logged activity + journal).
- **No-data state:** "No data for this day".

### 4. Trends

**Purpose:** Explore history. **Window selector: 7 days / 6 weeks (default) / Season.**
Every chart can carry **journal annotations** (vertical markers colored by tag).

- **Readiness** line over the window, with translucent **horizontal zone bands** (go/modify/back) and
  a Go/Modify/Back-off legend; shows the window average.
- **HRV vs baseline band** — line with a shaded rolling **baseline band** (below band = under-recovered).
- **Acute vs chronic load** — two lines (acute solid `--accent`, chronic dashed `--text-3`) + current
  ACWR.
- **ACWR sweet-spot gauge** — horizontal zones (0.5–1.8): modify / **go (0.8–1.3)** / modify / back,
  with a marker + value.
- **Weekly volume** — bars of training hours per ISO week (last ~8), latest highlighted in `--accent`.
- Each chart card includes a screen-reader summary (`sr-only`) — **don't encode meaning by color
  alone** (WCAG).

### 5. Activity

**Purpose:** Workout list → detail.

- **Sport filter** (All / Run / Ride) + an **"Upload a GPX → push to Garmin"** card (file picker;
  optimistic "Pushing… → Pushed to Garmin").
- List grouped by month: sport chip, name (+ "● PB" for races), date · distance · duration, and a
  right-aligned HR + pace/speed. **"Load more"** paginates (40 at a time) — never render the full
  multi-year list at once (perf).
- **Activity Detail** (bottom sheet): stat grid (distance, time, pace, elev, avg/max HR, suffer);
  **Route map** rendered from the GPS track (inline SVG polyline, start dot `--go`, finish dot
  `--back`, faint grid backdrop); a **"Create Garmin route from this GPX"** action (optimistic:
  building → "Route created, queued to sync"); a **heart-rate session** line chart; and a **splits**
  table (per-km bar + pace + HR).

### 6. Journal

**Purpose:** Notes woven into the data, not a silo.

- **Today's check-in** card at top: **Energy** and **Mood** as 1–5 **sliders** (`Drained→Fresh`,
  `Low→Great`); thumb is `--accent`, muted until set. (Soreness was intentionally removed.)
- **Compose** card: a multi-line textarea (min-height ~92px) + tag chips
  (note / race / niggle / travel / illness) + Add button. New entries post to today.
- **Tag filter** (segmented) + entry list (tag chip, date, text). Tapping an entry → Day Detail for
  that date.
- Entries surface elsewhere as **calendar day markers** and **trend-chart annotations**.

---

## Interactions & Behavior

- **Water quick-add:** `+100 / +250 / +500 ml` buttons increment a daily total against a goal ring.
  Each tap is **optimistic** and shows an **undo toast** with a 5-second countdown ring; rapid taps
  **batch** into one undo (undo reverts the whole batch). After 5s the toast auto-dismisses and the
  batch commits.
- **Subjective check-in:** Energy/Mood sliders (1–5), today only. In production this upserts today's
  `wellness_state` and should visibly nudge the readiness factors.
- **Journal note:** text + tag → posts to today; shows a brief confirmation toast (no undo).
- **Readiness info popover:** explains the score is **reconstructed**, lists the **5 inputs** with a
  **data-coverage badge** (e.g. "4/5 synced"), and notes lower confidence when inputs are missing.
- **Factor breakdown:** plain language first; "Show numbers" reveals signed bars (progressive
  disclosure). Points are contributions vs a typical day; they don't sum to the score.
- **Bottom sheet:** scrim fade + slide-up (transform translateY, 0.32s cubic-bezier). Use a **timer**
  (not `requestAnimationFrame`) to trigger the open transition so it works when the tab is backgrounded.
- **Day stepping:** ‹/› moves the sheet's date within [2021-01-01 … today].
- **Animations:** entrance uses a transform-only slide (never animate opacity from 0 as a base state —
  it can leave content invisible if the timeline is paused). Respect `prefers-reduced-motion`.

### Verdict Mapping (readiness → headline / sub)

- ≥80 "Train as planned" / "You're primed. Green light for the hard session."
- 67–79 "Train as planned" / "Recovered and ready. Hit the plan as written."
- 53–66 "Modify — keep it aerobic" / "Some fatigue lingering. Hold intensity, keep it easy."
- 40–52 "Modify — ease off" / "Recovery's incomplete. Trim volume or drop the intervals."
- 25–39 "Back off today" / "Your body's asking for recovery. Easy or rest."
- <25 "Rest" / "Deep fatigue. Prioritize sleep and an easy day off."
- null "Not enough data" / "No recovery signals synced for today yet."

### Readiness band thresholds

`≥67` = **go**, `40–66` = **modify**, `<40` = **back**. (Used for the ring, verdict, pills, factor
signs.)

---

## State Management

Client-rendered SPA. Suggested state:

- `tab` (active screen), `theme`, `scheme` (palette), `daySheetDate`, `activitySheet`.
- `water` (ml today) + a batch ref + 5s timer for undo; `toast`.
- `subjective` (today's energy/mood overrides); `journal` entries (append on add).
- `trendWindow` (7/42/120 days), `calendarMetric`, `calendarCursor` (year/month).
- Data fetching: a read-only JSON API keyed by `local_date`; design **loading / empty / error** for
  each surface. Empty days are common across the 1,900-day span.

---

## Design Tokens

> Colors are **OKLCH**. The app is themeable: **neutrals** come from `data-theme` (light/dark); the
> **accent + readiness bands + heatmap ramp** come from `data-scheme` (the palette). **Default
> shipping palette = `lagoon`** in both light and dark. Other palettes (pop, savanna, neon, sunset,
> calm) exist in the prototype as a switcher — keep or drop per product needs; lagoon is the chosen one.

### Type

- Display / headings: **Space Grotesk** (400–700). Numerics & labels: **IBM Plex Mono** (400–600,
  tabular figures). Body: system-ui stack.
- Scale (px): hero number 60; H1 27; verdict 21; big-num 22–30; body 14–14.5; label/mono 10–13;
  caption (`ctx-note`) 10.5–11. Mono labels are uppercase with ~0.1em letter-spacing.

### Neutrals — LIGHT (warm sand)

- `--bg` oklch(0.965 0.012 82) · `--bg-2` oklch(0.94 0.014 80)
- `--surface` oklch(0.995 0.006 85) · `--surface-2` oklch(0.955 0.012 82)
- `--text` oklch(0.30 0.022 58) · `--text-2` oklch(0.48 0.020 60) · `--text-3` oklch(0.62 0.018 64)
- `--hairline` oklch(0.34 0.03 60 / 0.10) · `--hairline-2` …/0.16 · `--track` oklch(0.45 0.03 70 / 0.11)
- `--shadow` 0 1px 2px rgb(60 50 30/.05), 0 10px 30px rgb(60 50 30/.07) · `--scrim` oklch(0.35 0.02 70/.4)

### Neutrals — DARK (warm charcoal)

- `--bg` oklch(0.195 0.008 70) · `--bg-2` oklch(0.155 0.008 70)
- `--surface` oklch(0.235 0.009 72) · `--surface-2` oklch(0.285 0.011 74)
- `--text` oklch(0.95 0.006 75) · `--text-2` oklch(0.73 0.012 75) · `--text-3` oklch(0.56 0.012 75)
- `--hairline` oklch(1 0 0 / 0.07) · `--hairline-2` …/0.12 · `--track` oklch(1 0 0 / 0.08)
- `--scrim` oklch(0.1 0.008 70 / 0.62)

### Lagoon palette (default — teal · coral · cream)

- `--accent` oklch(0.64 0.12 202) _(dark: oklch(0.74 0.12 202))_
- `--accent-2` oklch(0.66 0.16 28) _(coral — used for resting-HR & sleep-REM)_
- `--go` oklch(0.68 0.12 192) · `--modify` oklch(0.74 0.12 62) · `--back` oklch(0.64 0.16 26)
  _(dark back: oklch(0.70 0.16 26))_
- Heatmap ramp (low→high): `--r1` oklch(0.70 0.15 27) · `--r2` oklch(0.81 0.11 52) ·
  `--r3` oklch(0.90 0.09 92) · `--r4` oklch(0.81 0.09 178) · `--r5` oklch(0.72 0.12 196) ·
  `--r6` oklch(0.63 0.13 205)

### Derived tokens (must resolve against the active scheme — declare on the app root, NOT `:root`)

- `--accent-dim` = color-mix(in oklch, var(--accent) 16%, transparent)
- `--accent-line` = color-mix(in oklch, var(--accent) 40%, transparent)
- `--m-hrv` = var(--accent) · `--m-rhr` = var(--accent-2) · `--m-batt` = var(--go)
- `--m-deep` = color-mix(var(--accent) 68%, var(--text) 16%) · `--m-rem` = var(--accent-2) ·
  `--m-light` = color-mix(var(--accent) 40%, var(--surface-2))
- ⚠️ **Important:** if you use CSS custom properties this way, declare these derived tokens on the
  same element that carries the theme/scheme overrides (the app root), not on `:root` — otherwise the
  inner `var(--accent)` resolves against `:root`'s default and won't follow the palette. (Equivalent
  care needed in any token system: derive from the _active_ accent.)

### Spacing / radius / shadow

- Card radius **18px**; tiles **16px**; pills/chips **8–100px**; sheet top corners **26px**;
  icon buttons **13px**. Card padding **16px**. Gaps **12px** between cards, **8–12px** within.
- One elevation shadow (`--shadow`); cards mostly use a 1px `--hairline` border, not shadows.

### Iconography

Functional line icons (1.6px stroke, round caps), 24px grid — see `icons.jsx` for the set
(today, calendar, trends, activity, journal, water/drop, moon, heart, pulse, battery, gauge, bolt,
run, bike, swim, hike, info, chevrons, etc.). Recreate with your icon library (e.g. Lucide/Phosphor)
— these are generic and have close equivalents.

---

## Data Model (shape reference — from the product spec)

- **`wellness_state`** (per day, PK `local_date`): `readiness` 0–100 (+ signed factor contributions:
  sleep, training-load/ACWR, HRV-vs-baseline, stress, subjective), `sleep_hours`, `sleep_score`,
  sleep stages (deep/light/REM/awake mins), `hrv` (+ baseline band low/high), `resting_hr`,
  `body_battery`, `acwr` + acute/chronic load, `vo2max`, `stress`, `steps`, `weight`, subjective
  `energy/soreness/mood` (1–5), and a per-input **coverage** flag.
- **`activities`**: sport (run/ride/swim/hike), name, date, distance, duration, elevation, avg/max HR,
  suffer score (+ optional GPS track for the route map).
- **`journal`**: text, tag (note/race/niggle/travel/illness), date.
- **`hydration_log`**: amount_ml, date, source; daily total vs goal.

`data.js` in this bundle generates all of the above deterministically for ~1,900 days (with realistic
gaps and a hand-tuned recent build→race→recovery arc) — use it to understand value ranges and the
readiness factor math, then replace with your API.

## Assets

No external image/font assets beyond **Google Fonts** (Space Grotesk, IBM Plex Mono). All charts,
rings, gauges, sport icons, and the route map are **drawn (SVG/CSS)** — no raster assets. The route
map is a stylized polyline, not real map tiles; swap in your mapping library if you want tiles.

## Files in this bundle

- `Coach App.html` — entry point (loads everything; cache-busting `?v=` query params can be dropped).
- `styles.css` — design tokens (themes + all palette schemes) + base.
- `app.css` — component/layout classes.
- `data.js` — deterministic mock-data engine (data-shape reference).
- `icons.jsx` — line-icon set.
- `charts.jsx` — LineChart (baseline band + annotations + zone bands), ACWRGauge, VolumeBars,
  heatmap color logic, RouteMap.
- `components.jsx` — ReadinessRing, BandPill, FactorBars, Sparkline, MetricTile, Sheet, UndoToast,
  TabBar, EmptyState, Skeleton, SportChip, status bar.
- `screen-dashboard.jsx` · `screen-detail.jsx` · `screen-calendar.jsx` · `screen-trends.jsx` ·
  `screen-misc.jsx` — the six surfaces + Day Detail + Activity Detail + Journal.
- `tweaks-panel.jsx` — prototype-only palette/theme/demo switcher (not part of the product).
- `app.jsx` — root: routing, quick-action state, sheets, theme/scheme wiring.

## Acceptance criteria (from the brief)

1. A first-time viewer understands "how recovered am I and what should I do today" in <5s.
2. Readiness never reads as a hard device metric — its reconstructed nature + factors + coverage are evident.
3. The calendar makes a training block's shape (build/recover/race) legible at a glance.
4. Quick actions feel instant and reversible.
5. Works one-handed on a phone, in the dark; WCAG-AA contrast; ≥44px targets; keyboard + screen-reader
   support; `prefers-reduced-motion` respected.
