# Training Load Management

Professional coaches quantify training stress to manage fatigue, prevent overtraining, and peak for races.

## Garmin Training Load (Preferred When Connected)

If Garmin Connect is available (`mcp__garmin__*` tools — see `garmin.md`), **use Garmin's own load model directly instead of estimating TSS from Strava suffer scores.** Garmin runs the same fitness/fatigue/form concepts via FirstBeat, already calibrated to the athlete:

| Concept in this doc    | Garmin source                                          | Notes                                                                                            |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **CTL** (Fitness)      | `get_training_load_trend(start, end)` → chronic load   | Use the trend's chronic/long-term load value as fitness.                                         |
| **ATL** (Fatigue)      | `get_training_load_trend(start, end)` → acute load     | 7-day acute load.                                                                                |
| **TSB** (Form)         | `get_training_load_trend(start, end)` → CTL − ATL      | Compute form from the two, or read the chart's balance directly.                                 |
| Overall state          | `get_training_status(today)`                           | Label: Productive / Maintaining / Peaking / Overreaching / Unproductive / Detraining / Recovery. |
| Acute load vs. optimal | `get_training_status(today)` → load focus / load ratio | Tells you if recent load is below, in, or above the optimal range.                               |

**How to use it:**

- Read CTL/ATL/TSB from `get_training_load_trend` over the last 42+ days and apply the **same TSB tables below** (race-day targets, ramp guidance) — they're framework-agnostic.
- Cross-check direction with `get_training_status`: e.g. a positive TSB plus "Peaking" confirms a good taper; "Overreaching" or "Unproductive" means back off regardless of what the raw numbers suggest.
- Garmin's absolute load numbers are scaled differently from classic TSS — **trust the trend and the status label, not a specific TSS threshold** ported from another platform. The ramp-rate _principle_ (gradual, monitored increases) still applies; watch week-over-week change in chronic load rather than a fixed "+5–7 TSS/day".

The manual TSS math below remains the model for **Strava-only / manual** athletes and for understanding what the Garmin numbers represent.

> **Caveat on load ratios.** CTL/ATL/TSB and acute:chronic-style workload ratios are *monitoring aids*, not validated injury predictors — recent work disputes the acute:chronic workload ratio as a causal or predictive tool. Use them to watch direction and flag spikes, but weight subjective signals and the legs gate (see the trail-load section) at least as heavily; never let a green ratio override sore or painful legs.

## Training Stress Score (TSS)

TSS measures the physiological cost of a workout. For cycling with power:

```
TSS = (Duration in seconds × NP × IF) / (FTP × 3600) × 100

Where:
- NP = Normalized Power (accounts for variability)
- IF = Intensity Factor (NP / FTP)
```

### TSS Guidelines by Workout Type

| Workout               | Typical TSS | Recovery Needed |
| --------------------- | ----------- | --------------- |
| Easy 1hr ride         | 40-50       | Same day OK     |
| 2hr endurance ride    | 80-100      | 24 hours        |
| Hard interval session | 70-90       | 24-48 hours     |
| 4hr long ride         | 150-200     | 48-72 hours     |
| Century (100mi)       | 250-350     | 3-5 days        |
| Ironman bike          | 300-400     | 1-2 weeks       |

### Running TSS (rTSS)

Estimated from pace and HR. Use Strava's suffer_score as a proxy:

- suffer_score ≈ rTSS for most athletes
- Compare suffer_score per hour across sessions to gauge relative intensity

> If Garmin is connected, prefer its per-activity load: `get_training_effect(activity_id)` (aerobic/anaerobic training effect) and the activity's load value, which feed Garmin's overall load trend above — no suffer_score proxy needed.

### Swim TSS (sTSS)

Use duration × intensity factor:

- Easy swim: 25-30 TSS/hour
- Moderate swim: 40-50 TSS/hour
- Hard intervals: 60-70 TSS/hour

---

## Chronic Training Load (CTL) - "Fitness"

CTL is the rolling 42-day weighted average of daily TSS. It represents accumulated fitness.

### CTL Ramp Rate Guidelines

| Athlete Level | Max CTL Increase/Week | Notes                            |
| ------------- | --------------------- | -------------------------------- |
| Beginner      | 3-5 TSS/day           | Conservative to prevent injury   |
| Intermediate  | 5-7 TSS/day           | Standard progression             |
| Advanced      | 7-10 TSS/day          | Aggressive; requires monitoring  |
| Pro           | 8-12 TSS/day          | With careful recovery management |

_A CTL ramp of 7/week means adding ~50 TSS/week to your average weekly load._

---

## Acute Training Load (ATL) - "Fatigue"

ATL is the rolling 7-day weighted average of daily TSS. It represents recent fatigue.

---

## Training Stress Balance (TSB) - "Form"

```
TSB = CTL - ATL
```

| TSB Range  | State        | Implication                                |
| ---------- | ------------ | ------------------------------------------ |
| +15 to +25 | Fresh/peaked | Race ready, may lose fitness if maintained |
| +5 to +15  | Rested       | Good for quality sessions, minor events    |
| -10 to +5  | Neutral      | Normal training state                      |
| -10 to -30 | Fatigued     | Building load, need recovery soon          |
| < -30      | Overreaching | High injury/burnout risk, reduce load      |

### Race Day TSB Targets

| Event       | Target TSB | Taper Length |
| ----------- | ---------- | ------------ |
| Sprint Tri  | 0 to +10   | 5-7 days     |
| Olympic Tri | +5 to +15  | 10-14 days   |
| 70.3        | +10 to +20 | 14-18 days   |
| Ironman     | +15 to +25 | 21-28 days   |
| Marathon    | +10 to +20 | 14-21 days   |

---

## Weekly TSS Targets by Phase

| Phase         | % of Peak TSS | Focus                                  |
| ------------- | ------------- | -------------------------------------- |
| Base (early)  | 60-70%        | Building volume                        |
| Base (late)   | 75-85%        | Volume + introducing intensity         |
| Build         | 90-100%       | Peak volume, race-specific work        |
| Peak          | 85-95%        | Maintaining fitness, sharpening        |
| Taper         | 40-60%        | Reducing volume, maintaining intensity |
| Recovery week | 50-60%        | Every 3-4 weeks                        |

---

## Trail & Ultra Load: Equivalent Flat Distance (EFD)

On the road, weekly kilometres are a fair proxy for volume. On vert-heavy trail they are not: a 10 km run with 1000 m of climbing costs far more than 10 flat km, and counting both as "10 km" silently under-loads the climber. **Equivalent Flat Distance (EFD)** restores km as an honest volume currency by adding the cost of vertical gain.

```
EFD_km = distance_km + (D+_m / 100) × k        # k in km per 100 m of vert
default k = 1.0   (100 m of climb ≈ 1 flat km — the classic heuristic)
```

`k` is a **tunable coaching heuristic, not physics.** Use **k = 1.0 by default and leave it there** unless you have a specific reason not to — for most athletes one consistent number is all EFD needs to do its job (stop under-counting vert).

> **Reality check on grade cost.** Per *vertical* metre, climbing is actually *cheapest* on steep grades and *most expensive* on gentle ones — a shallow grade makes you cover far more horizontal ground per metre of gain (Minetti 2002; vertical-kilometre running-economy work). So a higher `k` is **not** justified by "steep vert costs more per metre" — it doesn't. Only raise `k` as a **musculoskeletal / technical surcharge**: rough, technical, or descent-heavy terrain beats up the legs and slows you for reasons that aren't aerobic cost.

| Tune k…                           | Suggested k | Why                                                         |
| --------------------------------- | ----------- | ----------------------------------------------------------- |
| Technical / rough / descent-heavy | 1.1 – 1.2   | Skill + musculoskeletal surcharge, not extra metabolic cost |
| Default — most trail              | 1.0         | The standard heuristic; start, and usually stay, here       |
| Smooth, very runnable, gradual    | 0.8 – 0.9   | Buttery terrain runs closer to its flat distance            |

**Worked example:** a 10 km run with 1000 m D+ → `10 + (1000/100)×1.0 = 20 km EFD`. The same 10 km on the flat stays 10 km EFD. Treating the two as equal raw km is the mistake EFD fixes.

**When to use it:** switch the volume currency from raw km to EFD for any athlete logging **> ~400 m D+/week**. Below that, raw km is fine and EFD only adds noise. D+ (total elevation gain) comes from the activity — Strava's `total_elevation_gain`, or Garmin activity detail.

**Limitation — EFD counts only the climb.** It says nothing about the **eccentric cost of descending**, which is where trail legs actually blow up. A net-downhill or descent-heavy race can be far harder on the quads than its EFD or D+ suggests. EFD is a *volume* currency; manage descent damage separately through the D+ axis, the big-descent recovery weighting, and downhill-specific training (below). (For a grade-sensitive *pace* currency, Strava/Garmin's GAP is the complement — don't conflate the two.)

### Two axes: aerobic load (EFD) and musculoskeletal load (D+)

EFD collapses distance and climb into one number, which is right for *volume* but hides *musculoskeletal* load: two athletes at equal EFD can carry very different leg damage depending on how much of it was vert. So watch **two axes**:

1. **Weekly EFD (km)** — the **aerobic** / volume currency defined above.
2. **Weekly D+ (m)** — the **musculoskeletal** (climbing/descending) load on its own.

These aren't independent — D+ is *inside* EFD, so a vert spike inflates both at once. That's the point: D+ is the **primary musculoskeletal axis** and EFD the **aerobic axis**, and watching D+ separately catches a vert blow-up that flat-km would miss. Cap each (guidance below), and deload **both** on recovery weeks.

| D+ tier  | Weekly D+ (m) | Use                                |
| -------- | ------------- | ---------------------------------- |
| Flat     | < 300         | Road / flat trail                  |
| Moderate | 300 – 800     | Rolling trail                      |
| Hilly    | 800 – 1500    | Hilly trail racer                  |
| Mountain | 1500 – 3000   | Mountain / ultra build             |
| Alpine   | > 3000        | Big alpine / vert-heavy ultra peak |

**How fast to ramp — a prudent ceiling, not a validated threshold.** The ≤10%/week guide is sensible but *not* strongly evidenced (cohort/RCT work hasn't shown a 10% cap prevents injury). The better-supported rule is to **avoid spiking any single long session well beyond the recent longest** — which is exactly why the long-run anchor below is scaled to race EFD. Apply both, and scale the cap to the athlete:

| Athlete                                     | D+ / EFD ramp guidance                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Trained, consistent vert history            | ≤ ~10–15%/wk on each axis                                                                                            |
| Beginner / returning from injury / masters  | ≤ 5–8%/wk on **D+**; hold a newly-introduced axis flat 1–2 wk, and establish EFD before ramping D+                  |

Bone and tendon adapt *slower* than muscle and the cardiovascular system, so the **D+ (impact/eccentric) axis is the one to hold back** for these groups — readiness/HRV will look fine while connective tissue is still behind.

**Big-descent recovery weighting (rule of thumb, not a measured constant):** any session with a big *descent* load — **> ~800 m of descent (D−), or > ~800 m D+ on an out-and-back where you descend what you climb** — gets a **~1.5× recovery weighting**: schedule it like a hard/long day even if HR stayed easy. The damage is **eccentric (downhill)**, so it's *descent* metres that count — a big climb with a gentle descent is far easier on the legs than a big technical descent. The 800 m / 1.5× figures are coaching heuristics; raise the weighting for masters and heavier runners, who take more eccentric load and recover slower.

**The legs gate this, not the watch.** Eccentric descent damage shows up in the legs (and in next-day session quality) before it shows in HRV or training readiness, so the objective scores *understate* it. Gate on the legs — but first tell soreness from injury:

- **Diffuse, bilateral muscle soreness that's improving** = ordinary DOMS. Gate only the demanding work: **legs ≤ 2/5 → no big-vert session, no technical descents** (easy aerobic is fine). See `assessment.md` and `adaptive.md`.
- **Sharp, localized, or worsening pain** — a specific tender spot on bone or tendon, pain that worsens *through* a run, or pain at rest/at night — is **not** soreness. Don't gate-and-train-around it; stop and assess (red flags below).

> **With Garmin connected**, `get_hill_score` and `get_endurance_score` track climbing-specific and durability fitness over time — use them to confirm the D+ axis is building *fitness*, not just fatigue. But trust the legs over HRV/readiness for descent damage: the watch lags it.

### Pain, red flags & when to stop

DOMS is expected in a vert build; injury is not. Treat these as **stop-and-assess**, not train-through:

- **Bone:** focal, pinpoint pain on a bone (shin, foot, femoral neck/groin, pelvis), pain that *worsens* as a run goes on, or pain at rest/at night → suspect a **bone stress injury**; stop running and get it assessed. Rapid load increase is the consensus driver.
- **Tendon:** sharp localized tendon pain persisting > 24 h after loading, or warmth/swelling → reduce load, don't push through.
- **Energy availability:** persistent fatigue, stalled progress, frequent niggles, poor sleep/mood, or sustained under-fuelling → screen for **low energy availability / RED-S**, which itself drives bone stress injury. The 3–4 g/kg recovery-day carb floor (see `race-day.md`) is for *easy* days only — don't let heavy weeks run an energy deficit.

When in doubt, refer to a sports physician/physio. A subjective soreness score will not catch a developing stress fracture.

## Recovery Monitoring

> **With Garmin connected**, most of this is measured for you. `get_training_readiness` already fuses sleep, HRV, recovery time, acute load, and stress into one 0–100 score — use it as the daily go/hold-back signal (see `garmin.md`). The indicators below explain what feeds that score and are the manual fallback when Garmin isn't available. The `coach checkin` CLI surfaces these each day; `coach log` captures the subjective ones.

### Heart Rate-Based Indicators

**Resting Heart Rate (RHR):** — Garmin: `get_rhr_day(date)`

- Measure every morning before getting up
- RHR elevated 5-10+ bpm = accumulated fatigue
- Sustained elevation over 3+ days = consider recovery day/week
- Sudden drop below baseline = potential illness onset

**Heart Rate Variability (HRV):** — Garmin: `get_hrv_data(date)` / `get_hrv_trend(start, end)`

- Higher HRV = better recovered
- Lower HRV = stressed/fatigued
- HRV 10%+ below baseline (or Garmin status "unbalanced"/"low") = reduce intensity
- Track 7-day rolling average, not daily swings

### Subjective Indicators (1-5 scale)

Capture these with `npx claude-coach log energy|soreness|mood|sleep <value>`; they're stored in `coach.db` and surfaced by `coach checkin` alongside Garmin's objective signals.

| Metric          | Questions                        |
| --------------- | -------------------------------- |
| Sleep quality   | How restful? Wake during night?  |
| Energy          | How do you feel getting up?      |
| Muscle soreness | General or localized?            |
| Mood            | Motivated or dreading training?  |
| Appetite        | Normal, elevated, or suppressed? |

**Warning patterns:**

- 2+ low scores for 3+ days = back off
- Sleep + mood both low = high burnout risk
- Garmin readiness <50 for 2+ days, or HRV unbalanced + RHR elevated together = insert recovery

### Recovery Week Structure

Every 3-4 weeks:

| Day | Prescription                                    |
| --- | ----------------------------------------------- |
| 1   | Complete rest or 30min Zone 1                   |
| 2   | 45-60min Zone 2, single sport                   |
| 3   | 30-45min Zone 2, different sport                |
| 4   | Complete rest                                   |
| 5   | 45-60min Zone 2 with 3-4 short accelerations    |
| 6   | Light session, re-assess readiness              |
| 7   | If feeling good, ease back into normal training |

**Volume reduction:** 40-50% of normal week
**Intensity reduction:** No Zone 4+ work
