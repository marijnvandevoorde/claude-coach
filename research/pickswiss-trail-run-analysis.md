# pickswiss/claude-coach — Trail Running Fork Analysis

Source diff: `felixrieseberg/claude-coach@main ... pickswiss/claude-coach@main`
(`gh api repos/felixrieseberg/claude-coach/compare/main...pickswiss:main`)
Analyzed: 2026-06-01. Wearing two hats: (A) trail/ultra running coach, (B) sports nutrition coach.

---

## TL;DR

**Verdict:** This is a heavily _personalized_ fork (single athlete "Julien", target race "Wild 25" / Wildstrubel 26 km / 1200 m D+, 13 Sep 2026), not a general trail-running upgrade. Most of the diff is bespoke: a hardcoded race profile, a French-language workflow rewrite of SKILL.md, personal recipes, and a Garmin-import/snapshot pipeline. **But buried inside are 3–4 genuinely good, generalizable trail-coaching ideas worth upstreaming**, plus one solid trail workout library.

**Top recommendations to upstream (in priority order):**

1. **EFD (Equivalent Flat Distance) as a trail volume metric** — `EFD = distance + elevation_gain × ~10`. Single best idea in the fork. Generalize it (the multiplier is debatable) and add it to `load-management.md` + a new trail section.
2. **Two-axis trail load model** (EFD km/week _and_ D+ m/week, with a D+ tier table and a recovery multiplier for big-vert days). Strong, sound concept for `load-management.md`.
3. **A trail workout library** (vertical intervals, trail fartlek, stacked-climbing long run, back-to-back weekends) + **trail-specific strength** (eccentric quad/calf work for downhills). Add to `workouts.md`.
4. **Trail phase progression** (base → build-vert → mountain-specificity → taper) with vert progressed separately from distance, and a long-run peak at 70–80% of race EFD. Add to `periodization.md`.

**What's NOT worth copying:** the hardcoded Wild 25 race profile, French-only rewrite, personal recipes, the athlete's fixed HR zones, and the "max 3 runs/week, family-first" personal constraints. Those are correct _for Julien_ but wrong as defaults.

**Honest caveat on the diff:** The trail/nutrition _thinking_ is concentrated in 3 new reference files (`trail.md` 343 lines, `nutrition.md` 286 lines, `workouts.md` +68 lines). The remaining ~2000 changed lines are infra (Garmin import, snapshot CLI, schema, Svelte settings) and a wholesale SKILL.md rewrite that is mostly re-architecture, not trail science.

---

## What the fork changes

| File                           | Change                                                                                 | Trail-relevant?                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill/reference/trail.md`     | **NEW, 343 lines**                                                                     | Core. EFD, trail load model, Wild 25 profile, phases, trail workout JSON templates, check-in integration                                                  |
| `skill/reference/nutrition.md` | **NEW, 286 lines**                                                                     | Core. Periodized carbs, pre/during/post fueling, race-day plan, personal recipes                                                                          |
| `skill/reference/workouts.md`  | +68 lines                                                                              | Adds trail workout-type table, trail strength circuit, FIT-export notes                                                                                   |
| `skill/SKILL.md`               | Rewritten (337+/416−)                                                                  | Re-architected into 4 French workflows (plan / weekly / session-debrief / weekly-debrief) + Garmin snapshot loading. Mostly structural, not trail science |
| `skill/reference/snapshot.md`  | NEW, 148 lines                                                                         | Garmin/precomputed snapshot format (infra)                                                                                                                |
| `skill/reference/queries.md`   | +83 lines                                                                              | SQL incl. EFD/D+ rollups                                                                                                                                  |
| `CLAUDE.md`                    | NEW, 358 lines                                                                         | Athlete profile (Julien), Overstims gel sequence, periodized-carb JSON                                                                                    |
| `src/*`, `schema.sql`, Svelte  | Garmin archive import, `equivalent_distance_m` column, snapshot generator, settings UI | Infra only                                                                                                                                                |

Key mechanic: the DB stores a precomputed `equivalent_distance_m` per activity, and a `snapshot.json` is generated for fast context loading (rolling 4-week EFD/D+, ACWR, sleep/HRV trends, readiness flags, morning check-in). The skill then reads the snapshot instead of re-querying every time. Sensible engineering, largely orthogonal to trail science.

---

## (A) Trail / ultra running coach analysis

### What's good and sound

- **EFD concept is the standout.** Normalizing vert into distance-equivalent so a flat 10 km and a 10 km + 1000 m climb aren't treated as equal volume is exactly right. It mirrors established trail heuristics (e.g. "100 m vert ≈ 1 extra flat km", or Naismith/Strava GAP-style adjustments). Tracking volume in EFD is far better than raw km for a mountain athlete.
- **Two-axis load model (EFD + weekly D+).** Correctly recognizes that two athletes at the same EFD can have totally different musculoskeletal stress depending on vert. The D+ tier table (Flat / Moderate / Hilly / Mountain / Alpine) is a reasonable mental model.
- **Recovery multiplier for big-vert sessions** (1.5× after >800 m D+). Directionally correct — descending vert causes eccentric muscle damage needing more recovery than the cardio cost implies. Good instinct.
- **Vert progressed separately from distance** in the phase plan (D+ ramps 600 → 1400 m/wk across Build), with "max +10%/week" applied. This is the right way to periodize trail — you can blow up an athlete with vert even while flat-distance is flat.
- **Long-run peak anchored to race EFD** (27–30 km = 70–80% of the 38 km race EFD). Good principle: scale the longest session to _race demand_, not arbitrary distance.
- **Back-to-back weekends + stacked-climbing long runs** for fatigue resistance. Standard, well-proven ultra/long-trail methodology.
- **Power-hiking explicitly endorsed** ("marche en montée raide = tactique normale, pas une faiblesse"). Important and often missed by road-converts — walking steep grades is a skill and a pacing tool, not failure.
- **Downhill/quad durability addressed** via eccentric calf raises and the recovery multiplier; the strength circuit (single-leg RDL, eccentric calf, lunges) targets the right muscles for descending.
- **Legs-score gating** in the morning check-in ("legs ≤ 2 → no demanding D+ session, no technical descents"). Smart trail-specific readiness rule — eccentric damage shows up in legs before it shows up in HRV.
- **Altitude acknowledged** (1500–2900 m → elevated perceived effort, reduced appetite).

### What's missing or thin (as general trail coaching)

- **Downhill running is under-trained as a _skill_.** The plan loads vert for the climbs and uses descents as "recovery," but there are **no dedicated downhill-repeat / quad-conditioning sessions**. For a 600 m-descent race, structured downhill reps (controlled fast descending to build eccentric tolerance) are the single best insurance against quads blowing up. This is a real gap.
- **Poles barely addressed.** Mentioned once ("bâtons?" in taper equipment check) but no guidance on whether/when to use them, or training with them. For 1200 m D+ many runners use poles; if allowed, pole technique should be trained, not decided in taper week.
- **Grade-aware / terrain-aware pacing is weak.** Pacing is HR-zone-based (Z2 for long runs), which is fine, but there's no explicit guidance on _power-hike-vs-run threshold by grade_, or how HR drifts/decouples on sustained climbs vs. how to pace descents. Real trail pacing is grade- and effort-based, not just HR-zone-based (HR lags on punchy climbs).
- **Technical-terrain skill work is vague.** "Introduce technical descents" is listed but there's no progression for footwork/ankle agility beyond a generic strength circuit.
- **Heat handling is named but not trained.** "Gestion thermique variable" is flagged for race day, but there's no heat-acclimation protocol in the build despite a valley/altitude temperature swing.
- **Taper is reasonable but generic.** −40 to −50% volume while "maintaining terrain proportion" is sound; could be sharper on maintaining a little vert-intensity into taper to keep legs primed for descending.

### Questionable / opinionated

- **The EFD multiplier (×10, i.e. 100 m vert = 1 km) is a fixed constant.** It's a fine first approximation but it's athlete- and grade-dependent (steep vert costs more; very runnable vert costs less). Fine as a default, but should be presented as a tunable heuristic, not physics.
- **"Max 3 runs/week" + "family first"** are personal lifestyle constraints, correct for this athlete, not general trail principles. A competitive trail plan often needs 4–6 run touches.
- **Everything is hardcoded to Wild 25 / Julien / fixed HR zones (LTHR 170, FCmax 186).** Great for him, useless as a template without parameterization.

**Overall (hat A):** The training adaptations are _sound and well-reasoned_ for a mid-distance mountain race. The framework (EFD, two-axis load, vert periodization, fatigue-resistance work, legs-gating) is genuinely good. The main blind spot is **dedicated downhill/quad-conditioning sessions and grade-based pacing** — surprising for a race with 600 m of technical descent.

---

## (B) Sports nutrition / fueling coach analysis

### What's good and sound

- **Periodized carbohydrate by day type** (3.5 / 6.0 / 7.5 g/kg for rest / moderate / long-intense). This is textbook "fuel for the work required" and is excellent — most amateur plans ignore daily carb periodization entirely. Protein held constant at 1.7 g/kg, fat reduced on hard days. All defensible, modern guidance.
- **In-session target of 60–80 g carbs/hr from 45 min** is appropriate for a 3–4.5 h effort. Sits within current sports-nutrition consensus (60–90 g/hr for >2.5 h, requiring multiple-transportable-carb sources).
- **"Start before you're hungry" (begin fueling at 45 min)** — correct, prevents the late-race bonk.
- **Gut training is explicitly required** ("test on ≥3 long runs", "test this protocol on ≥2 long runs before the race"). This is the single most-skipped and most-important fueling principle. Strong.
- **Real-food alternatives for >2 h** (dates, figs, banana, pain d'épices) alongside gels — realistic for trail aid stations where pure-gel intake gets nauseating. Good.
- **Hydration 500–700 ml/hr, adjusted for heat** — reasonable baseline.
- **Recovery window** (20–30 g protein within 30 min, full meal within 90 min) — solid, well-aligned with eccentric-damage repair needs after a mountain run.
- **Race-day timeline is well-built** (J-2 / J-1 / race morning / during), low-fiber + nothing-new the day before, 3 h-pre carb meal, 1 h-pre top-up. Classic and correct.
- **Altitude appetite suppression flagged** ("train to eat without hunger") — a real and often-missed ultra issue.

### What's missing or thin

- **Electrolytes / sodium are essentially absent during the race.** This is the biggest gap. The fork gives fluid volume (500–700 ml/hr) but **no sodium-per-hour target** and no mention of electrolyte tabs/salt for a 3–4.5 h alpine effort with a hot valley section. Cramping and hyponatremia risk both hinge on sodium strategy. (Ironically, _upstream_ `race-day.md` already has a sodium-per-hour table — the fork is a regression here.)
- **Carb composition / glucose:fructose ratio not specified.** To actually absorb 60–80 g/hr you need multiple-transportable carbohydrates (≈1:0.8 glucose:fructose). Hitting 80 g/hr on single-source gels invites GI distress. The Overstims gel sequence is chosen by _flavor/function_ (antioxidant, caffeine) rather than by carb-transport profile.
- **Caffeine strategy is crude.** "Red Tonic (caffeine) on the last km" delivers caffeine too late to matter (onset ~30–45 min). Caffeine should be timed ~45–60 min before the hard finish, or dosed across the back half — not at the finish line.
- **No aid-station execution plan.** For Wild 25 there's "banana at aid stations" but no plan for what to carry vs. refill, bottle/flask strategy, or how to eat on technical terrain. Race-day fueling logistics are thin.
- **Carb target is a flat 60–80 g/hr** regardless of intensity/terrain — no nod to the fact that hard climbs reduce gut tolerance (eat on descents/flats, not mid-climb).

### Questionable / opinionated

- **Gels selected by brand line (Overstims) and by non-carb attributes.** Fine for a sponsored/loyal athlete, but "antioxidant gel mid-race" has negligible performance evidence; the choice should be driven by carbs/hr and transportability.
- **The recipes are excellent but entirely personal** (specific brands, French cuisine, single portions). Zero value as general skill content.

**Overall (hat B):** The _fueling framework_ (periodized carbs, 60–80 g/hr, early start, gut training, recovery window, race-day timeline) is genuinely strong and modern. The two real holes are **(1) no sodium/electrolyte strategy** and **(2) no multiple-transportable-carb / composition guidance** — both of which our upstream `race-day.md` already partly covers. So nutrition-wise the fork adds great _structure and periodization_ but is _weaker on race-day electrolytes_ than what we already have.

---

## Prioritized adaptations worth upstreaming

We already have `skill/reference/{workouts,load-management,race-day,zones,periodization,assessment}.md` + new `garmin.md`, and are adding Garmin readiness + wellness reminders. Recommendations are framed to _generalize_ the fork's ideas, not copy the personalization.

### Tier 1 — High value, clearly worth it

1. **Add EFD (Equivalent Flat Distance) to `load-management.md`** (and reference it from a new trail section).
   - Formula `EFD = distance + D+ × k` with `k ≈ 10` (100 m vert ≈ 1 km) as a **tunable default**, noting it's a heuristic, not physics.
   - Use EFD as the volume currency for any athlete logging significant vert.
   - If we precompute load metrics in the DB/snapshot, store an `equivalent_distance_m`-style column (the fork's `schema.sql` change is a clean reference).

2. **Add the two-axis trail load model + D+ tier table + big-vert recovery multiplier** to `load-management.md`.
   - Track EFD km/week _and_ D+ m/week independently.
   - D+ tier table (Flat/Moderate/Hilly/Mountain/Alpine) as a load-context guide.
   - Apply extra recovery weighting after sessions with large descent/vert (the fork's 1.5× after >800 m D+ is a reasonable default).

3. **Add a trail-running phase template to `periodization.md`.**
   - Progress **vert separately from distance** (cap vert ramp at ~10%/week independently).
   - Long-run peak scaled to **70–80% of race EFD**.
   - Phase arc: aerobic base → build-vert → mountain/terrain specificity (incl. back-to-back weekends) → terrain-preserving taper.

### Tier 2 — Good, worth adding with our own improvements

4. **Add a trail workout library to `workouts.md`** (generalize the fork's): vertical/uphill intervals, trail fartlek (effort by terrain), stacked-climbing long run, back-to-back weekend. **Plus the gap-fillers the fork lacks:** dedicated **downhill repeats / quad-conditioning** and a note on **power-hiking thresholds by grade**.

5. **Add trail-specific strength to `workouts.md`:** eccentric calf raises, single-leg RDL, lunges, lateral-core — explicitly framed as **downhill/quad durability + ankle stability**. The fork's circuit is a fine starting point.

6. **Add trail/grade-aware pacing to `race-day.md`:** power-hike-vs-run by grade, expect HR to lag on punchy climbs (pace by effort not just HR), conservative descending early to protect quads. We already have an Ultra HR-ceiling row — extend it with grade/terrain nuance.

### Tier 3 — Nutrition: adopt the structure, keep our electrolytes

7. **Add periodized daily carbohydrate guidance** (g/kg by day type: rest / moderate / long-intense, protein constant, fat down on hard days) — likely a new short `nutrition.md` or a section in `race-day.md`. This is the fork's best nutrition idea and we don't have it.

8. **Add trail/ultra fueling specifics to `race-day.md`:** 60–80 g/hr from 45 min, gut-training requirement (test on ≥3 long runs), real-food-at-aid-stations alongside gels, altitude appetite suppression. **But keep/strengthen our existing sodium-per-hour table** (the fork dropped it) and **add multiple-transportable-carb (glucose:fructose ~1:0.8) and caffeine-timing** guidance — both of which the fork is missing.

### Do NOT upstream

- Hardcoded Wild 25 race profile, athlete "Julien", fixed HR zones (LTHR 170 / FCmax 186).
- French-only SKILL.md rewrite and the personal workflow re-architecture (some workflow ideas — snapshot loading, weekly debrief — may be worth it _separately_ but are not trail science).
- Personal recipes and brand-specific gel sequence (Overstims Energix/Antioxydant/Coup de fouet/Red Tonic).
- "Max 3 runs/week / family-first" personal constraints as defaults.

---

## Bottom line

The fork is ~80% personalization and infra, ~20% genuinely reusable trail-coaching IP. That 20% is good: **EFD, two-axis vert load, vert-separated periodization, fatigue-resistance work, legs-gated readiness, and periodized carbs** are all worth lifting into our skill — generalized and de-personalized. The two things to _improve on_ rather than copy: the fork **under-trains dedicated downhill/quad conditioning** and **drops race-day electrolyte/sodium strategy** (which our upstream `race-day.md` already does better). Net: cherry-pick the framework, keep our nutrition rigor, fill the downhill gap ourselves.
