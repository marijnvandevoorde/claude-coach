# Trail / Ultra Running Support — Epic Plan

> Coach's design + task breakdown for the **"Trail/ultra running support"** epic on the `claude-coach` Notion board.
> Source IP: `research/pickswiss-trail-run-analysis.md`. Grounded against the existing skill docs (`load-management.md`, `periodization.md`, `workouts.md`, `race-day.md`, `assessment.md`, `garmin.md`). Planning only — no skill/source files were edited.

## TL;DR

We are upstreaming the genuinely reusable ~20% of a personalized trail fork and **fixing its two real gaps ourselves**. The design rests on one new metric and one new load model:

- **EFD (Equivalent Flat Distance)** = `distance_km + (D+_m / 100) × k`, default **k = 1.0 km per 100 m of vert** (a tunable heuristic, not physics). EFD becomes the volume currency for any athlete with meaningful vert.
- **Two-axis trail load**: track **weekly EFD km _and_ weekly D+ (m)** independently, each ramped ≤10%/week, with a **1.5× recovery multiplier after any >800 m-D+ session** (eccentric descent damage outlasts the cardio cost).

On top of that: vert-separate periodization (long-run peak = **70–80% of race EFD**, back-to-back weekends), a trail workout library that **adds the fork's missing dedicated downhill/quad repeats and power-hike-by-grade**, grade-aware pacing (HR lags on climbs), periodized daily carbs + 60–90 g/hr at **glucose:fructose ~1:0.8** with corrected caffeine timing **while keeping our existing sodium/hr table** (the fork dropped it), trail-specific assessment (vert history, durability, Garmin hill/endurance/VO₂max), and skill wiring via a new `skill/reference/trail.md` hub + a SKILL.md **trail-mode trigger**. Packaging needs no change — `build:skill` already zips the whole `skill/` dir recursively.

**9 child tasks created** under the epic (links at the bottom).

---

## 1. The two-axis trail load model (the math)

### EFD — Equivalent Flat Distance

```
EFD_km = distance_km + (D+_m / 100) × k        # k in km per 100 m of vert
default k = 1.0   (100 m climb ≈ 1 flat km — the classic "×10 per meter" heuristic)
```

`k` is **tunable, not physics**:

| Terrain                      | Suggested k | Rationale                          |
| ---------------------------- | ----------- | ---------------------------------- |
| Steep / technical vert       | 1.3 – 1.5   | Costs more per meter climbed       |
| Default mixed mountain trail | 1.0         | The standard heuristic             |
| Very runnable, gradual vert  | 0.7 – 0.9   | Cheaper than the heuristic implies |

**Worked example:** a 10 km run with 1000 m D+ → `10 + (1000/100)×1.0 = 20 km EFD`. The same 10 km on the flat is 10 km EFD. Treating them as equal volume (raw km) is the mistake EFD fixes.

**When to switch from km to EFD:** any athlete logging **> ~400 m D+/week**. Below that, raw km is fine.

### Two axes, ramped independently

Two athletes at equal EFD can carry very different musculoskeletal load depending on vert, so **cap each axis separately at ≤10%/week**: you can blow an athlete up on vert while flat distance is flat.

| D+ tier  | Weekly D+ (m) | Use                                |
| -------- | ------------- | ---------------------------------- |
| Flat     | < 300         | Road/flat trail                    |
| Moderate | 300 – 800     | Rolling trail                      |
| Hilly    | 800 – 1500    | Hilly trail racer                  |
| Mountain | 1500 – 3000   | Mountain/ultra build               |
| Alpine   | > 3000        | Big alpine / vert-heavy ultra peak |

**Big-vert recovery multiplier:** any session with **> 800 m D+** gets a **1.5× recovery weighting** — treat it as a hard/long day for scheduling even if HR was easy, because eccentric descent damage shows up in the legs (and in next-day session quality) more than in HRV. This ties directly to the **legs-soreness gate** (legs ≤ 2/5 → no big-vert, no technical descents).

---

## 2. Trail / ultra periodization model

Four phases, with **vert progressed separately from distance**:

1. **Aerobic Base** — build EFD volume, mostly Z2, easy vert, introduce hills as terrain (not intervals yet).
2. **Build-Vert** — ramp **weekly D+ separately** from distance (e.g. ~600 → ~1400 m/wk across the build), each axis ≤10%/wk. Add uphill intervals + the first dedicated downhill repeats.
3. **Mountain / Terrain Specificity** — race-like climbs, **technical descents**, **back-to-back weekend long runs** (Sat long + Sun shorter-on-tired-legs) and **stacked-climbing long runs** for fatigue resistance.
4. **Terrain-Preserving Taper** — cut volume 40–50% but **keep a little vert/descent intensity** into taper week so the legs stay primed for descending.

**Long-run anchor:** the peak long run is scaled to **70–80% of race EFD**, not an arbitrary km figure. For a race of 26 km + 1200 m D+ → race EFD = `26 + 12×1.0 = 38 km EFD` → peak long run ≈ **27–30 km EFD**.

**Back-to-back weekend method:** long day, then a second long day at **50–70%** of the first on pre-fatigued legs — the single most effective fatigue-resistance tool for long-trail/ultra.

---

## 3. Sample 12-week trail block

Target archetype: a hilly/mountain race ~26 km / ~1200 m D+ (**race EFD ≈ 38 km**). EFD = volume currency; D+ tracked as its own axis. ~10%/wk caps on each axis; 3:1 loading.

| Wk  | Phase             | EFD (km)  | D+ (m/wk) | Long run (EFD) | Key sessions                                                      |
| --- | ----------------- | --------- | --------- | -------------- | ----------------------------------------------------------------- |
| 1   | Base              | 38        | 600       | 14             | Hilly Z2 long; strides; trail-strength 2×                         |
| 2   | Base              | 42        | 700       | 16             | Uphill intervals 5×3'; easy vert; strength                        |
| 3   | Base              | 46        | 800       | 18             | Stacked-climb long (repeat one climb); strength                   |
| 4   | **Recovery**      | 28        | 450       | 12             | Deload both axes ~−40%; mobility                                  |
| 5   | Build-Vert        | 46        | 950       | 20             | Uphill intervals 6×4'; **downhill repeats 4×2'** (intro)          |
| 6   | Build-Vert        | 50        | 1100      | 22             | Trail fartlek (effort by terrain); downhill repeats 5×2'          |
| 7   | Build-Vert        | 54        | 1250      | 25             | **B2B weekend**: Sat 25 EFD / Sun 14 EFD; power-hike drills       |
| 8   | **Recovery**      | 34        | 700       | 16             | Deload; keep one short downhill set for tendon stiffness          |
| 9   | Mountain-Specific | 54        | 1400      | 27 (≈72% race) | Race-terrain long; technical descents; downhill repeats 6×2-3'    |
| 10  | Mountain-Specific | 56        | 1450      | 30 (≈79% race) | **Peak B2B**: Sat 30 EFD / Sun 18 EFD; full race-fuel rehearsal   |
| 11  | Taper             | 38        | 900       | 18             | Keep short vert + a few downhill reps; sharpen; race-pace efforts |
| 12  | Taper / Race      | 22 → race | 500       | race           | Openers (short, with 2–3 descent strides); race day               |

Each axis stays under ~10%/wk; recovery weeks deload **both** EFD and D+. Gut/fuel protocol rehearsed on ≥3 long runs (wks 6, 9, 10).

---

## 4. Key workout types

**Uphill / vertical intervals** — 4–6 × 3–5 min hard climb (Z4–5), jog/walk-down recovery. Climbing power + lactate tolerance.

**Trail fartlek** — effort **by terrain**: surge the climbs, float the flats, control the descents. Teaches grade-aware pacing.

**Stacked-climbing long run** — repeat one climb to accumulate race-level D+ at Z2. Vert specificity without needing a point-to-point route.

**Back-to-back weekend** — long day + 50–70% second long day on tired legs. Fatigue resistance.

### The fork's gaps — added here

**Downhill repeats / quad-conditioning** — 4–8 × 1–3 min **controlled-fast descent** on a moderate grade, walk/jog back up. **Progress eccentric tolerance gradually** (start 2–3 reps, add 1–2/wk). This is the single best insurance against quads blowing up on a long descent, and it was the fork's biggest blind spot for a race with significant descent.

**Power-hike by grade** — train the **run-vs-hike transition** as a skill, not a failure: run grades **< ~10–12%**, **power-hike (hands-on-quads)** **> ~15–20%**, gray zone in between decided by HR economy. Practiced, power-hiking is faster and cheaper than grinding a run up a steep wall.

**Trail strength (durability)** — eccentric (slow 3–4 s lowering) single-leg squats / step-downs, **eccentric calf raises**, single-leg RDL, walking + lateral lunges, single-leg balance/wobble work for ankle stability. The eccentric tempo is what protects quads/calves on descents; it complements the downhill-repeat runs. 1–2×/wk, taper to maintenance.

---

## 5. Grade-aware pacing & race execution

- **Pace by effort/grade, not just HR.** HR **lags** on punchy climbs (spikes after the top) and runs **low** on descents — HR alone misleads on rolling terrain.
- **Power-hike vs run by grade** (run < ~12%, hike > ~18%; gray zone by economy).
- **Descend conservatively early** to protect quads — early-descent quad debt is the ultra equivalent of going out too fast.
- **Budget time by climb/descent/flat splits**, not even pace.
- **Aid-station execution:** walk-and-eat on climbs/flats, never on technical descents.
- **Poles:** decide and **train** before taper, not during.
- Extends the existing **Ultra 75–80% LTHR ceiling** row with this grade/terrain nuance.

---

## 6. Fueling plan (keep our electrolyte rigor)

**Periodized daily carbs — fuel for the work required:**

| Day type        | Carbs (g/kg) | Protein      | Fat            |
| --------------- | ------------ | ------------ | -------------- |
| Rest / recovery | 3 – 4        | 1.6–1.8 g/kg | Normal         |
| Moderate        | 5 – 6        | 1.6–1.8 g/kg | Normal         |
| Long / intense  | 7 – 9        | 1.6–1.8 g/kg | Reduced on day |

**In-race:** 60–90 g carb/hr for efforts > 2.5 h, **start by 45 min** ("before you're hungry"). To absorb > 60 g/hr use **multiple-transportable carbs at glucose:fructose ~1:0.8** (single-source can't be cleared fast enough → GI distress). Eat on **descents/flats, not mid-hard-climb** (climbs cut gut tolerance). Real food at aid stations (dates, banana, pretzels) alongside gels for > 2 h. **Gut training required:** rehearse the exact protocol on ≥ 3 long runs.

**Caffeine timing (fork fix):** onset is ~30–45 min, so dose **~45–60 min before the hard finish** or across the back half — **not at the finish line**. ~3 mg/kg pre + 1–2 mg/kg during for multi-hour efforts.

**Sodium/electrolytes:** **keep and strengthen the existing per-hour sodium table** in `race-day.md` (300–1000 mg/hr by temperature). The fork dropped this; we don't.

**Altitude:** appetite suppression at altitude — train to eat without hunger.

---

## 7. Assessment & Garmin wiring

Trail **foundation + form** signals: weekly D+ history (m/wk over 8–12 wk), longest single-session D+, biggest descent handled without a quad blow-up, technical-terrain experience, and **EFD trend** (not raw km). Add a race-EFD **gap analysis** (race distance + race D+ → race EFD, compared to current weekly D+ and longest-session vert).

**Garmin** (`garmin.md` already maps these tools): `get_hill_score` + `get_endurance_score` verify climbing-specific and durability fitness are building; `get_vo2max_trend` / `get_training_status` VO₂max as the aerobic anchor. **Durability readiness gate:** legs ≤ 2/5 → no demanding D+ session, no technical descents (eccentric damage shows in legs before HRV).

---

## 8. Skill wiring & packaging

- **New `skill/reference/trail.md`** = the trail-mode hub: a short index cross-linking the trail sections added to the other docs, restating the core heuristics inline (EFD formula + default k, D+ tier table, >800 m → 1.5× recovery, long-run = 70–80% race EFD, grade hike/run thresholds, 60–90 g/hr @ 1:0.8). Fully de-personalized — no Wild25 / Julien / fixed HR zones.
- **SKILL.md trail-mode trigger:** if the event is trail/ultra (event_type, or notes mention vert/D+/elevation/mountain/technical) → **activate trail mode**: read `trail.md` first, use EFD as the volume currency, apply trail periodization/workouts/pacing/fueling. Add `trail.md` to the Reference Files table; extend the Event Requirements list with a trail/ultra-by-D+ row.
- **Packaging:** `build:skill` (`package.json`) does `cd skill && zip -r ../dist/coach-skill.zip .` — it zips the whole `skill/` dir recursively, so `reference/trail.md` is **auto-included, no zip-script change needed**. Acceptance just verifies the new file appears in `dist/coach-skill.zip`.

---

## What we deliberately do NOT upstream

Hardcoded Wild 25 race profile, athlete "Julien", fixed HR zones (LTHR 170 / FCmax 186); the French-only SKILL.md rewrite; personal recipes and brand-specific gel sequences; and "max 3 runs/week / family-first" personal constraints as defaults.

---

## Tasks created (under the epic)

Epic: [Trail/ultra running support](https://www.notion.so/372f8e16e40a816a8a06f7e321695cec)

| #   | Task                                                                                 | Priority | Pts | URL                                                    |
| --- | ------------------------------------------------------------------------------------ | -------- | --- | ------------------------------------------------------ |
| 1   | EFD metric — definition + `load-management.md` section                               | P0       | 3   | https://www.notion.so/372f8e16e40a8158a4bbcc5adcb47f6a |
| 2   | Two-axis trail load model — EFD + D+ tiers + big-vert recovery multiplier            | P0       | 5   | https://www.notion.so/372f8e16e40a81f9b9dccf6537f8dd71 |
| 3   | Trail/ultra periodization template — vert separate, long-run % of race EFD, B2B      | P1       | 5   | https://www.notion.so/372f8e16e40a8118aa94f7fcae748350 |
| 4   | Trail workout library — incl. downhill/quad repeats + power-hike-by-grade            | P1       | 5   | https://www.notion.so/372f8e16e40a8121a8dfd398932a69e4 |
| 5   | Trail-specific strength — eccentric quad/calf + ankle stability                      | P2       | 2   | https://www.notion.so/372f8e16e40a81db8196e406c7e4c288 |
| 6   | Grade-aware trail/ultra pacing + race-day execution (`race-day.md`)                  | P1       | 3   | https://www.notion.so/372f8e16e40a8111bfeffb01cd8340f9 |
| 7   | Trail/ultra fueling — periodized carbs, 1:0.8 glu:fru, caffeine timing (keep sodium) | P1       | 5   | https://www.notion.so/372f8e16e40a8147b392fc0bbdb3d492 |
| 8   | Trail-specific assessment — vert history/durability + Garmin hill/endurance/VO₂max   | P2       | 3   | https://www.notion.so/372f8e16e40a81c7aa85ee65f0853d29 |
| 9   | Skill wiring — `trail.md` hub + SKILL.md trail-mode trigger + packaging              | P0       | 3   | https://www.notion.so/372f8e16e40a81629cf2eb2e95219ca2 |

Total: **34 story points** across 9 tasks (all Sprint = Backlog, Status = Backlog, Parent = epic).
