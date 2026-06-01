# Trail & Ultra Mode

Activate **trail mode** when the goal event is a trail or ultra race — i.e. the goal's `event_type` is trail/ultra, **or** its `event_name`/`notes` mention vert, D+, elevation gain, "mountain", "skyrace", "vertical", or "technical". In trail mode, the volume currency changes from raw km to **EFD**, and vert is managed as its own training axis.

This file is the index. Each topic lives in the reference doc it belongs to — read that doc for the full treatment. The core heuristics are restated here so you can apply them without re-reading everything.

## Core heuristics (quick reference)

- **EFD (Equivalent Flat Distance)** = `distance_km + (D+_m / 100) × k`, default **k = 1.0** km per 100 m of vert (steep/technical 1.3–1.5; very runnable 0.7–0.9). Use EFD as the volume currency for any athlete logging **> ~400 m D+/week**. → `load-management.md`
- **Two axes, ramped independently:** cap **weekly EFD** and **weekly D+** each at ≤10%/week; recovery weeks deload both. D+ tiers: Flat <300 / Moderate 300–800 / Hilly 800–1500 / Mountain 1500–3000 / Alpine >3000 m/wk. → `load-management.md`
- **Big-vert recovery:** any session **> 800 m D+** gets a **1.5× recovery weighting** (schedule like a hard day even at easy HR). **Legs ≤ 2/5 → no big-vert, no technical descents** — the legs gate descent damage, not HRV. → `load-management.md`, `assessment.md`, `adaptive.md`
- **Long-run anchor:** peak long run = **70–80% of race EFD** (race EFD = `race_km + race_D+/100 × k`). → `periodization.md`
- **Vert-separate periodization:** Base → Build-Vert → Mountain/Specificity → Terrain-Preserving Taper; **back-to-back weekends** (second day 50–70% of the first on tired legs). → `periodization.md`
- **Power-hike by grade:** run < ~10–12%, power-hike > ~15–20%, gray zone by HR economy — train the transition. → `workouts.md`, `race-day.md`
- **Downhill repeats** to build eccentric/quad tolerance, progressed gradually; **eccentric-tempo strength** (3–4 s lowering) for durability. → `workouts.md`
- **Fueling:** periodized daily carbs (3–4 / 5–6 / 7–9 g/kg by day type); in-race **60–90 g/hr** at **glucose:fructose ~1:0.8**, start by 45 min; caffeine **~45–60 min before the hard finish**, not at the line. **Keep the per-hour sodium table** in `race-day.md`. → `race-day.md`

## Where each topic lives

| Topic                                    | Doc                  |
| ---------------------------------------- | -------------------- |
| EFD metric + two-axis (EFD + D+) load    | `load-management.md` |
| Trail periodization + sample 12-wk block | `periodization.md`   |
| Trail sessions + downhill/power-hike + durability strength | `workouts.md` |
| Grade-aware pacing + race execution      | `race-day.md`        |
| Trail/ultra fueling                      | `race-day.md`        |
| Vert history, durability, race-EFD gap   | `assessment.md`      |
| Readiness → ease/swap (legs-soreness gate) | `adaptive.md`       |
| Garmin hill / endurance / VO₂max signals | `garmin.md`          |

## What trail mode does NOT change

Zones, the polarized intensity distribution, recovery monitoring, and the Garmin readiness workflow are all unchanged — trail mode adds the vert dimension on top of the existing model, it doesn't replace it. Stay de-personalized: there is no built-in athlete, race, or fixed HR set here; everything is derived from the athlete's own data and goal.
