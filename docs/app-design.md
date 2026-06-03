# Coach Web App — UX Design Spec

Build-ready UX for the **coach.small-victories.co/app** browse app. Distilled from the design panel
(data-viz, mobile-first interaction, accessibility). Pairs with
[`app-product-spec.md`](app-product-spec.md) (what to show) and gates the Round-2 UI tickets.

> Stack note: this is a hosted Svelte SPA (reusing the `src/viewer/` toolchain + look), **distinct**
> from the offline single-file plan viewer (`templates/plan-viewer.html`). Dark mode is the default.

## Principles

- **Today-first.** The athlete is mostly on a phone, glancing post-wakeup. Today is the front door;
  the calendar heatmap is the lean-back exploration surface.
- **Every number carries context.** Never a bare "HRV 64" — always "HRV 64, band 58–72, balanced".
  Sparklines + baseline bands everywhere.
- **Writes are tiny, optimistic, undoable.** No typing on a sweaty phone; one-tap, with a 5s undo.
- **Charts are accessible from day one.** Each ships a "view as table" toggle + an aria summary.

## Information architecture

Five destinations + a shared **Day Detail** overlay reachable from anywhere (Today, Calendar,
Activities, Journal):

```
/app
├── /today        Dashboard — default landing
├── /calendar     Multi-year heatmap → day drill-in
├── /trends       Charts (metric + range pickers)
├── /activities   Workout list → activity detail
└── /journal      Entry list + free-text + tag filter
        └── Day Detail sheet (?day=YYYY-MM-DD) — shared overlay
```

- **Mobile:** bottom tab bar (5 items, thumb-reachable, icon+label). Quick-add lives _inside_ Today
  (contextual, not a global FAB). Day Detail = swipe-down bottom sheet.
- **Desktop:** collapsible left sidebar + a top date-range control. Day Detail = right-side drawer
  (content stays visible behind). Keyboard: `g t/c/r/a/j` to jump, `/` search, `←/→` step days in
  Day Detail, `Esc` closes sheets.

## Screen layouts (wireframes)

### Today (mobile)

```
┌─────────────────────────────┐
│ Mon Jun 1            ☾  ⚙︎  │
├─────────────────────────────┤
│  READINESS                  │
│      ╭───────╮              │
│      │  72   │  Moderate    │   ring gauge, band-coloured
│      ╰───────╯  ▲ +6 vs avg │
│  Sleep + good · HRV ~ bal   │   top factors (tap → full breakdown)
│  Prior load − high          │   "reconstructed ⓘ"
├─────────────────────────────┤
│ SLEEP 7h42 (81) ▁▃▆█▆▃▁     │
├──────────────┬──────────────┤
│ BODY BATT 64 │ RESTING HR 48│
│ HRV 64 ✓band │ ACWR ▮ optim │
├─────────────────────────────┤
│ TODAY'S PLAN  Z2 run 60min  │  [View plan]
├─────────────────────────────┤
│ 💧 +100 +250 +500  (1.2L ▓) │  optimistic + undo
│ Mood 😖😐🙂😄  Energy ▁▃▅   │  ✎ note
├─────────────────────────────┤
│ [Today][Cal][Trend][Act][Jrnl]
└─────────────────────────────┘
```

Desktop = same data in a 3-column card grid (readiness | sleep/HRV | training/plan) with the
quick-add bar across the bottom.

### Calendar — multi-year heatmap

```
Desktop (year grid)                         Mobile (month-strip)
┌──────────────────────────────────┐        ┌─────────────────────────┐
│ Metric:[Readiness ▾] Year:[2026‹›]│        │ Calendar [Readiness ▾]  │
│      Jan Feb Mar Apr May Jun …    │        │  ‹ June 2026 ›          │
│ Mon  ░▒▓█ ▒▒▓░ …                  │        │ Mo Tu We Th Fr Sa Su    │
│ Wed  ▓█▒░ █▓▒▒ …  (7×53 cells)    │        │      ▓ ▒ █ ░ ▒ ▓        │
│ Sun  ▒░▓█ …                       │        │ █ ▓ ▒ ░ ▓ █ ▒  (44px)   │
│ Less ░▒▓█ More   ○ no data        │        │ ▒ ▓ █ ▓ ▒ ░ ▓           │
│ ‹2021 2022 2023 2024 2025 2026›   │        │ Less ░▒▓█ More          │
└──────────────────────────────────┘        └─────────────────────────┘
       click a cell → Day Detail                 tap a day → bottom sheet
```

Cells are multi-signal: background tint = selected metric (readiness default), a small load dot, a
sport icon if trained, a journal marker. Virtualized (never 1900 cells in the DOM at once).

### Day Detail (shared sheet / drawer)

```
┌─────────────────────────────┐
│ ‹  Sat May 3 2026  ›     ✕  │  ←/→ step days
│ Readiness 72 Moderate ▲+6   │
│  Sleep      +12 ▰▰▰▰▱        │  signed factor bars
│  HRV         +3 ▰▱▱▱▱        │
│  Prior load −8  ▰▰▱▱▱        │
│  Stress/RHR −5  ▰▰▱▱▱        │
│ Sleep 7h42(81) deep1:10 rem1:48
│ HRV 64 · RHR 48 · BB 64     │
│ Steps 9.2k · 6.4km · Wt71.3 │
│ 🏃 Easy run 8.5km 52:10  ›  │
│ Subjective: E▅ S▂ Mood🙂    │
│ Journal: "legs heavy am…"   │  inline
└─────────────────────────────┘
```

### Trends

```
┌──────────────────────────────────────────────┐
│ Metric:[Readiness ▾] Range:[7d|6w|season] ⊞tbl│
│ 100│      ╭╮     ╭─╮   ╭──╮   line + 7d mean   │
│  50│  ╭──╯ ╰─╮ ╭╯  ╰──╯       zone bands       │
│   0└───────────────────────────────────────   │
│ + Compare: HRV · ACWR · Load   ● illness ▲ race│  journal-tag annotations
└──────────────────────────────────────────────┘
```

Default range **6w**. Mobile = one chart full-width, swipe between metrics.

### Activities & Journal

- **Activities:** grouped list (sport icon, distance, time, key stat, chevron) → detail
  (pace/HR over distance, splits, weather, "see full day" link).
- **Journal:** entries (tag chip, date, snippet) + tag filter + a "new entry" composer; each links
  to its Day Detail; illness/race tags annotate Trends.

## Component inventory

`MetricCard` · `Sparkline` · `Sparkbar` (sleep stages / BB curve) · `RingGauge` (readiness) ·
`BandedGauge`/`ACWRGauge` (sweet-spot 0.8–1.3) · `FactorBar` (signed contribution) · `HeatmapGrid`

- `HeatmapCell` · `MonthStrip` (mobile) · `Chart` (line/area/bar; range, rolling-mean,
  baseline-band, annotations, **table fallback + aria summary**) · `MetricPicker`/`RangePicker` ·
  `DayDetailSheet` · `ActivityRow` · `JournalEntry` · `QuickAddBar` + `WaterStepper` ·
  `MoodEnergyPicker` · `UndoToast` · `TabBar`/`Sidebar` · `EmptyState`.

**Build the `DayDetailSheet` and the `Chart` wrapper interfaces first** — they're the highest-
leverage shared pieces.

## Quick-action interaction spec

Read-mostly app; writes are tiny, optimistic, reversible, **today-scoped** by default (past days
require opening that Day Detail explicitly).

- **Water `+100 / +250 / +500 ml`** (primary): 44px buttons + running total + goal ring. Tap →
  optimistic increment + haptic; async write to `hydration_log`; `UndoToast` "Added 250 ml · Undo"
  (5s) deletes that row. Rapid taps **debounce-batch**. Network failure → roll back + "Retry".
  Long-press → numeric entry (escape hatch, not default).
- **Mood / Energy / Soreness** (one per day): single-select; **upsert** today's `wellness_state`
  field (last-write-wins, no undo needed); visibly updates the readiness factors.
- **Journal note:** "Add note" opens a focused composer (tag + today); explicit Save; UndoToast can
  revert the just-created entry.
- **Read-only / no write:** weight, sleep, HRV, anything Garmin-sourced — provenance-tagged
  "from Garmin"; editing them would corrupt the reconstructed readiness model.

## Chart type per metric

| Metric                        | Chart                                                 |
| ----------------------------- | ----------------------------------------------------- |
| Readiness over time           | line + 7d rolling mean, zone bands                    |
| Readiness factors (one day)   | signed horizontal bars                                |
| Any daily metric, 1900 days   | calendar heatmap (single-hue sequential ramp)         |
| HRV vs baseline               | line + shaded baseline band + status dots             |
| ACWR                          | banded gauge (now) / line+band (history)              |
| Acute vs chronic load         | dual line + form area                                 |
| Sleep stages                  | stacked bar (per night) / stacked columns (over time) |
| Resting HR, respiration, SpO₂ | sparkline (card) / line (trends)                      |
| VO₂max                        | stepped line                                          |
| Steps / distance / floors     | bar (daily) → heatmap (yearly)                        |
| Intensity minutes             | stacked bar (mod vs vig) vs goal line                 |
| Weight                        | line + rolling mean, fixed sensible y-range           |
| Stress                        | banded area (rest/low/med/high)                       |
| Hydration                     | progress bar (today) + bar vs goal (history)          |

## Mobile / dark / accessibility

- **Mobile:** bottom tab bar in the thumb arc; tap targets ≥44px; heatmap uses the MonthStrip
  (not the dense grid); lazy-load visible months/charts only; horizontal swipe between days/metrics.
- **Dark (default):** elevated surfaces (`#0f1115` bg, `#1a1d23` card, `#e6e8eb` text), not pure
  black/white; heatmap/zone colours keep ≥3:1 and stay distinguishable; offer a lightness-stepped
  single-hue ramp so it survives grayscale/colour-blindness; status never by colour alone (pair
  with arrow/word).
- **A11y:** body text ≥4.5:1; charts get an `aria`/`figcaption` summary + a **"view as table"**
  toggle; heatmap cells are focusable with `aria-label="May 3, readiness 72, moderate"` + roving
  tabindex + a list/table alternative; full keyboard operability + focus return on sheet close;
  respect `prefers-reduced-motion`; emoji/chips carry text labels; a live region announces
  optimistic writes ("Added 250 ml, total 1.2 litres").

## Suggested build order

`MetricCard`+`Sparkline` → Today → `DayDetailSheet` → `HeatmapGrid`/`MonthStrip` (Calendar) →
`Chart` w/ table fallback (Trends) → Activities → Journal → quick-action writes last (they touch
the DB).
