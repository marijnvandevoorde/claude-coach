# Trail & Ultra Mode

Activate **trail mode** when the goal event is a trail or ultra race — i.e. the goal's `event_type` is trail/ultra, **or** its `event_name`/`notes` mention vert, D+, elevation gain, "mountain", "skyrace", "vertical", or "technical". In trail mode, the volume currency changes from raw km to **EFD**, and vert is managed as its own training axis.

This file is the index. Each topic lives in the reference doc it belongs to — read that doc for the full treatment. The core heuristics are restated here so you can apply them without re-reading everything.

## Core heuristics (quick reference)

- **EFD (Equivalent Flat Distance)** = `distance_km + (D+_m / 100) × k`, **default k = 1.0** and usually leave it there. Only raise k (≈1.1–1.2) as a *technical/musculoskeletal* surcharge — **not** because steep vert costs more per metre (per vertical metre it's actually *cheaper* on steep grades). EFD counts ascent only; manage **descent** damage separately. Use EFD for athletes logging **> ~400 m D+/week**. → `load-management.md`
- **Two axes (overlapping):** D+ is the **musculoskeletal** axis (inside EFD, the **aerobic** axis); ramp each ~**≤10–15%/week** (≤5–8% on D+ for beginners/returning/masters); recovery weeks deload both. D+ tiers: Flat <300 / Moderate 300–800 / Hilly 800–1500 / Mountain 1500–3000 / Alpine >3000 m/wk. → `load-management.md`
- **Big-descent recovery:** a big *descent* session (≈> 800 m D−, or > 800 m D+ out-and-back) gets a **~1.5× recovery weighting** (heuristic; schedule like a hard day even at easy HR). **Diffuse soreness ≤ 2/5 → no big-vert, no technical descents** — the legs gate descent damage, not HRV. But **sharp/localized/worsening pain = stop & assess, not a gate** (red flags in `load-management.md`). → `load-management.md`, `assessment.md`, `adaptive.md`
- **Long-run anchor:** peak long run = **70–80% of race EFD** (`race_km + race_D+/100 × k`); for ultras > ~50 km anchor by **time on feet** instead. → `periodization.md`
- **Vert-separate periodization:** Base → Build-Vert → Mountain/Specificity → Terrain-Preserving Taper; **back-to-back weekends** (second day 50–70% of the first on tired legs). Start D+ from the athlete's *actual* baseline, not the template. → `periodization.md`
- **Power-hike by grade:** run < ~12%, power-hike > ~15–20% — a *pacing* choice to spare the legs, not an economy crossover (that's ~25–30%+). Train the transition. → `workouts.md`, `race-day.md`
- **Strength (3 layers):** heavy/maximal (economy + durability), eccentric/durability-specific (3–4 s lowering, hip/glute, calf, ankle), then plyometric after a base. **Downhill repeats** to build quad tolerance — progress reps→grade→speed, ≥48–72 h apart, easy primer in Base first. → `workouts.md`
- **Fueling:** periodized daily carbs (3–4 / 5–6 / 7–9 g/kg by day type — shift the *mix*, don't cut total energy); **pre-race carb-load 8–12 g/kg/day × 36–48 h** (low-residue); in-race **60–90 g/hr** (up to **~90–120** for long gut-trained efforts) using **multiple-transportable carbs** above ~60–70 g/hr (~1:0.8 glu:fru preferred, 2:1 fine); start by 45 min; caffeine **~45–60 min before the hard finish**. **Sodium is individual; drink to thirst — over-drinking causes hyponatremia (EAH), and extra salt doesn't prevent it.** → `race-day.md`
- **Race prep extras:** if the race runs **hot**, acclimatize 5–10 days (active, or passive sauna/hot-bath) ending in taper — decays in ~2–4 wk. **No mountains / time-limited?** Treadmill incline + hands-on-rail for climbs, eccentric strength + repeatable descents (stairs/garages/ramps) for the descent gap a treadmill can't train, single-hill repeats. → `race-day.md`, `workouts.md`

## Where each topic lives

| Topic                                    | Doc                  |
| ---------------------------------------- | -------------------- |
| EFD metric + two-axis (EFD + D+) load    | `load-management.md` |
| Trail periodization + sample 12-wk block | `periodization.md`   |
| Trail sessions + downhill/power-hike + durability strength | `workouts.md` |
| Grade-aware pacing + race execution + safety + heat | `race-day.md`     |
| Trail/ultra fueling + pre-race carb-load | `race-day.md`        |
| Flat-terrain / time-limited substitutions | `workouts.md`       |
| Vert history, durability, race-EFD gap   | `assessment.md`      |
| Readiness → ease/swap (legs-soreness gate) | `adaptive.md`       |
| Garmin hill / endurance / VO₂max signals | `garmin.md`          |

## What trail mode does NOT change

Zones, the polarized intensity distribution, recovery monitoring, and the Garmin readiness workflow are all unchanged — trail mode adds the vert dimension on top of the existing model, it doesn't replace it. Stay de-personalized: there is no built-in athlete, race, or fixed HR set here; everything is derived from the athlete's own data and goal.
