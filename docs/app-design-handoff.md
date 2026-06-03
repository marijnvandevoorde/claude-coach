# Coach Web App — Design Handoff Brief

A self-contained brief to design the **coach.small-victories.co/app** browse app in a dedicated
design tool (e.g. Claude design). It's **framework- and visual-style-agnostic on purpose** — define
the look here. The full requirements live in [`app-product-spec.md`](app-product-spec.md) (what to
show) and [`app-design.md`](app-design.md) (UX/IA); a working **reference prototype** to react to or
diverge from is [`app-mockup.html`](app-mockup.html) (open it in a browser — it's "option B").

## 1. What it is

A personal, single-user web app to **browse one athlete's own endurance-training & health data**
(2021→today, ~1900 days), pulled from their watch (Garmin) and training log. **Read-mostly** with a
few one-tap quick-action writes. Not a social app, not a coach-marketplace — a private dashboard.

## 2. Who it's for

One person, who is both an **amateur age-grouper on some days and a semi-pro mindset on others**.
Mostly on a **phone**, glancing in the morning or after a workout; occasionally on desktop to
explore history. Design **mobile-first**, then scale up. **Dark mode is the default.**

## 3. The one job

Answer, fast: **"train as planned / modify / back off — today?"** The dashboard serves that
decision; calendar, trends, activities, and journal serve exploration.

## 4. Screens to design (states matter as much as the happy path)

1. **Today / Dashboard** — readiness (0–100) as the hero with a plain-language verdict; the factors
   that moved it; last night's sleep; key recovery tiles (HRV vs band, resting HR, body battery,
   load/ACWR); today's plan; a quick-add block.
2. **Calendar** — a multi-year, GitHub-style heatmap (color = a chosen metric, default readiness),
   with a per-day drill-in. Mobile reflows to a scrollable month view.
3. **Day Detail** — a shared overlay (bottom sheet on mobile / side drawer on desktop) showing
   _everything_ for one day: readiness + factors, sleep, activities, subjective ratings, hydration,
   and the day's journal inline. Step ‹/› between days.
4. **Trends** — charts with a time-window selector (7d / 6 weeks / season; default 6 weeks) and a
   metric/compare picker. Key charts: readiness over time, HRV vs baseline band, acute-vs-chronic
   load, weekly volume.
5. **Activities** — a workout list → activity detail (pace/HR over the session, splits).
6. **Journal** — entries with tags + a compose box; entries also surface as annotations elsewhere.

Design these **states** for each: loading, empty/no-data (common — the 1900-day span has gaps),
error, and the populated happy path.

## 5. Visual & interaction direction (open to your interpretation)

- **Honest, calm, glanceable.** Big readiness number with a green/amber/red band and a sentence;
  detail on demand (progressive disclosure — plain language first, raw numbers one tap deeper).
- **Readiness is reconstructed, not a Garmin number** — it must _visibly_ read as a derived/estimated
  score (label + an info affordance + a factor breakdown + a "data coverage" indicator when inputs
  are missing). Don't make it look like an authoritative device readout.
- **Every metric carries context** — never a bare "HRV 64"; show it against its baseline band. Avoid
  single-night values with up/down arrows for HRV / resting HR / weight (use rolling trends).
- **Journal is woven in**, not a silo — markers on calendar days and annotations on trend charts.
- **Quick actions are tiny, optimistic, undoable** (see §7).
- Reference the existing plan-viewer's aesthetic for family resemblance, but you are **not** bound to
  it — propose your own system (type scale, color ramp, spacing, chart style).

## 6. Components to define in the design system

Readiness ring/gauge · signed factor bar · metric card + sparkline · calendar heatmap cell + grid /
mobile month strip · day-detail sheet · line/area chart with baseline-band + annotations · ACWR
"sweet-spot" gauge · activity row · journal entry + tag chip · quick-add bar (water stepper,
mood/energy picker) · undo toast · bottom tab bar / sidebar · empty & loading states.

## 7. Quick-action spec (the only writes)

- **Water** `+100 / +250 / +500 ml` — running daily total + goal ring; tap is optimistic with a 5s
  **undo**; rapid taps batch. The flagship action.
- **Subjective check-in** — energy / soreness / mood (1–5), one tap each (today only).
- **Journal note** — short text + a tag.
- Everything else (sleep, HRV, weight, workouts) is **read-only**, provenance-tagged "from Garmin".

## 8. Data model (so you can mock realistic content)

- **Per day** (`wellness_state`): `readiness 0–100` (+ factor contributions: sleep, prior-load/ACWR,
  HRV, stress, subjective), `sleep_hours`, `sleep_score`, `hrv` (+ baseline band low/high),
  `resting_hr`, `body_battery`, `acwr` + acute/chronic load, `vo2max`, `stress`, `steps`, `weight`,
  subjective `energy/soreness/mood (1–5)`, and sleep stages.
- **Activities**: sport (run/ride/swim/hike), name, date, distance, duration, elevation, avg/max HR,
  suffer score.
- **Journal**: text, tag (note/race/niggle/travel/illness), date. **Hydration**: ml per day vs goal.

## 9. Constraints

- Mobile-first; **dark default** (offer light if easy). Accessible: WCAG-AA contrast, ≥44px tap
  targets, keyboard support, screen-reader summaries for charts (don't encode meaning by color
  alone), `prefers-reduced-motion`.
- It will be a **static SPA behind Cloudflare Access** talking to a read-only JSON API — so design for
  client-rendered data with loading states; no server-rendered page transitions assumed.

## 10. Deliverables we'd like back

1. High-fidelity screens for the 6 surfaces above (mobile + desktop) incl. the four states.
2. A lightweight design system / token set (color ramp incl. the readiness bands, type scale,
   spacing, chart styling).
3. The interactive/quick-action behaviors shown (water stepper, undo, factor expand, day-detail).
4. Ideally an exportable/clickable prototype so it can be compared directly against
   [`app-mockup.html`](app-mockup.html).

## 11. Acceptance criteria

- A first-time viewer understands "how recovered am I today and what should I do" in &lt;5 seconds.
- Readiness never reads as a hard device metric; its reconstructed nature + factors are evident.
- The calendar makes a training block's _shape_ (build/recover/race) legible at a glance.
- Quick actions feel instant and reversible.
- Works one-handed on a phone in the dark.
