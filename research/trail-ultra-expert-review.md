# Trail / Ultra References — Expert Review

> Independent review of the Sprint 4 trail/ultra additions (branch `trail-ultra`) before merge.
> Four domain experts each scanned the trail content in `skill/reference/*.md` + `skill/SKILL.md` against the design rationale in `research/trail-ultra-epic-plan.md`, and pulled recent (2019–2025) peer-reviewed research to validate or challenge specific claims.
>
> **Panel:**
> 1. **Endurance physiology & periodization coach** — load modeling, periodization, intensity distribution, physiological validity.
> 2. **Trail / ultra & mountain specialist** — vert progression, workout selection, descending, power-hiking, pacing & race execution.
> 3. **Sports nutritionist / fueling expert** — carb periodization, in-race intake, sodium/electrolytes, caffeine, gut training.
> 4. **Sports physiotherapist** — durability, eccentric/strength prescription, load-progression safety, injury risk.
>
> Files reviewed live in the worktree at `/Users/marijnvandevoorde/Sites/marijnvandevoorde/claude-coach-trail/`.

---

## 1. Headline verdict

**The trail layer is conceptually sound and safe to ship after a focused round of corrections — nothing in it is dangerous, but it claims more physiological authority in a few places than the evidence supports, contradicts itself in two spots, and has real gaps of omission (strength, race safety, fueling ceiling, injury red-flags).** All four reviewers independently called the *priorities* right: treating vert as its own load axis, dedicated downhill/eccentric work, trusting legs-soreness over HRV for descent damage, and grade-aware pacing are exactly the things road-style plans miss.

The fixes below are **text edits, not a redesign.**

---

## 2. Prioritized action list (cross-cutting synthesis)

### P0 — Fix before merge (factual errors / safety)

| # | Issue | Where | Raised by |
| - | ----- | ----- | --------- |
| 1 | **The EFD `k` adjustment table is physiologically inverted.** It says steep/technical vert costs *more* per metre (k 1.3–1.5) and gentle vert *less* (k 0.7–0.9). The metabolic-cost-of-grade literature says the opposite for the *climbing* term: cost per vertical metre is **highest on shallow grades and lowest on steep grades** (Minetti 2002; VK economy study 2023). The table conflates "hard/technical to run" (a skill/neuromuscular surcharge) with "metabolic cost per vertical metre" (which moves the other way). | `load-management.md` k-table, `trail.md` heuristics, epic plan §1 | Physiology coach (High) |
| 2 | **In-race carb ceiling contradicts the doc's own kept table.** Trail fueling says 60–90 g/hr for >2.5 h, but the pre-existing carb table (which the doc says it keeps) already lists 80–120 g/hr for 4+ h, and trail-marathon evidence supports up to ~120 g/hr with a trained gut for the longest efforts. | `race-day.md` fueling, `trail.md` | Nutritionist (High) |
| 3 | **Exercise-associated hyponatremia (EAH) is never mentioned.** The dominant fluid/electrolyte safety risk in ultras is dilutional EAH from *over-drinking* — sodium does **not** prevent it. Primary prevention is drink-to-thirst. | `race-day.md` hydration/fueling | Nutritionist (High) |
| 4 | **A single 1–5 soreness number is the only musculoskeletal gate, with no pain-vs-soreness rule and no red-flags.** "2/5 general ache" and "2/5 sharp localized shin pain" are clinically opposite; the gate can't tell DOMS from a developing bone stress injury. No when-to-stop / see-a-clinician / RED-S language anywhere. | `load-management.md` big-vert gate, `assessment.md` durability gate, all trail docs | Physio (High) |
| 5 | **Run/power-hike grade thresholds are internally inconsistent across docs** — `trail.md`/`workouts.md` say run <10–12% / hike >15–20%; `race-day.md` says run <12% / hike >18%. Pick one band everywhere. | `trail.md`, `workouts.md`, `race-day.md` | Trail specialist (Med) |

### P1 — Strongly recommended

| # | Issue | Where | Raised by |
| - | ----- | ----- | --------- |
| 6 | **Strength section is eccentric-tempo-only and under-specified.** No sets/reps/load/progression; missing **heavy/maximal resistance** (best-evidenced lever for economy + durability), **hip/glute** work (pelvic control on descents), and **plyometric/tendon-stiffness** work. Calf is framed for descents but is loaded most on climbs/push-off. | `workouts.md` Trail Strength | Physio (High), Trail specialist (Med→High) |
| 7 | **12-week block violates its own ≤10%/week rule.** Recomputed D+ steps: Wk1→2 +16.7%, Wk2→3 +14.3%, Wk5→6 +15.8%, Wk6→7 +13.6%. Either soften the stated rule or re-number so D+ actually steps ≤10%. | `periodization.md` / epic plan §3 | Physiology coach (Med) |
| 8 | **No race-execution & safety subsection.** Missing cutoff/time-budget math, mandatory kit, weather/cold-wet/hypothermia, night running, crew/drop-bags, foot care/blisters — partly safety-critical for mountain ultras. | `race-day.md` | Trail specialist (High) |
| 9 | **No population modifiers on the ramp caps.** Flat ≤10%/wk is too aggressive for beginners / return-from-injury / masters; bone & tendon adapt slower than muscle/CV. The doc already grades CTL ramp by athlete level — the trail caps should too (≈5–8%/wk on D+ for these groups; hold the new axis flat first). | `load-management.md` | Physio (Med) |
| 10 | **Power-hike thresholds are framed as the economy crossover, but the true walk-beats-run crossover is ~25–30%, not 15–20%.** At 15–20% most trained runners are still more economical running; people hike there for pacing/fatigue reasons. Don't claim hiking is "cheaper" at 15%. | `trail.md`, `workouts.md`, `race-day.md` | Trail specialist (Med) |
| 11 | **Downhill-repeat progression is reps-only with no spacing or early primer.** RBE evidence uses ~2 bouts/wk ≥72 h apart; add minimum spacing, cap sessions/wk, and insert an easy low-stakes downhill primer in Base so the first (highest-DOMS) bout isn't mid-build. | `workouts.md`, `periodization.md` block | Physio (Med), Trail specialist (Med) |

### P2 — Honesty caveats & framing fixes

| # | Issue | Where | Raised by |
| - | ----- | ----- | --------- |
| 12 | **The ≤10%/week rule is presented as harder evidence than it is** (RCT/cohort work found no injury benefit of a 10% cap; better-supported rule is avoiding single-session spikes). Add one caveat line — it actually reinforces the long-run anchor logic. | `load-management.md`, `periodization.md` | Physiology coach (Med) |
| 13 | **"Two independent axes" overstates independence** — EFD already contains D+, so a vert spike inflates both. Reframe: D+ = primary musculoskeletal axis, EFD = aerobic axis; they overlap by construction. | `load-management.md` | Physiology coach (Med) |
| 14 | **The >800 m → 1.5× recovery multiplier is an uncited heuristic and keys off D+ (ascent) when eccentric damage tracks descent (D−).** Label it as a rule-of-thumb and tie the trigger to descent volume. | `load-management.md` | Physiology coach (Med), Physio |
| 15 | **Glucose:fructose 1:0.8 is presented as the single right answer.** Frame as preferred at high intakes (what modern products use); 2:1 still valid, and a controlled trial found no performance advantage of 120 g/h @1:0.8 over 90 g/h @2:1. | `race-day.md`, `trail.md` | Nutritionist (Med) |
| 16 | **Sodium table is temperature-only and hides ~10× inter-athlete variability.** Keep as a starting point but add individualization (salty-sweater cues, sweat test). | `race-day.md` | Nutritionist (Med) |
| 17 | **ACWR/CTL framing is inherited but increasingly contested.** Note these are monitoring aids, not validated injury predictors; weight the legs gate accordingly. | `load-management.md` | Physiology coach (Low), Physio |
| 18 | **EFD / D+ have no descent term; net-downhill (D−-heavy) races are invisible to the model.** At minimum acknowledge the limitation. | `load-management.md`, `trail.md` | Physiology coach, Trail specialist |
| 19 | **"Fat reduced on day" stated bare** — clarify it's a macro-mix shift, not a total-energy cut (RED-S risk in heavy weeks). | `race-day.md` carb table | Nutritionist (Low) |

### P3 — Gaps worth considering (enhancements)

- **Flatlander / no-mountains pathway** — both the trail specialist and physiology coach flagged the time-and-means-limited amateur as the *weakest-covered* persona. Add a concrete block: treadmill incline for climbs (+ hands-on-rail to simulate steeper walls), eccentric strength + any repeatable descent (parking garages, stadium ramps, levees, dunes, stairwells) for the descent durability a treadmill can't give, single-hill repeat protocol, and a strict weekly prioritization order.
- **Heat acclimatization** — absent; well-evidenced and relevant to summer 50K+ races (1–2 weeks of heat exposure).
- **Night running** — beyond a kit mention, no guidance on training in the dark / headlamp / alertness.
- **GAP (grade-adjusted pace)** — never mentioned, yet it's the grade-sensitive *pace* cousin of EFD that athletes already have in Strava/Garmin; relate the two so they aren't conflated.
- **Technical-descent *skill* session** — distinct from eccentric-conditioning reps (foot speed, line choice, gaze, cadence on rough ground).
- **GI-distress in-race rescue protocol** — back off intensity, switch to liquid carb/cola, reduce concentration, ginger.
- **Pre-race carb-loading for ultras** + point-to-point overnight/aid-bag logistics.
- **Protein during 12+ h efforts**; **cramp** management beyond sodium (neuromuscular-fatigue origin, pacing as primary prevention).
- **"Time is made on descents, not climbs"** — the empirically strongest pacing finding (faster finishers run downhills relatively faster, climbs slower, more even effort) — is missing from the pacing section.
- **For long ultras (>6–8 h)** the sustainable HR ceiling drifts *down* over time (decoupling); early HR should sit below the listed 75–80% LTHR.

---

## 3. Endurance physiology & periodization coach

### Overall assessment
A thoughtfully built, mostly safe set of additions that will help an intermediate trail athlete more than it hurts — the periodization logic, the two-axis instinct, the downhill-repeat/eccentric content, and the "trust the legs over HRV" gate are all sound and well-aligned with current evidence. The headline weakness is that the EFD model is presented with more physiological authority than it earns, and its k-adjustment table is **inverted relative to the actual metabolic-cost-of-grade literature**. The 12-week block also contains at least two weeks that violate the document's own ≤10% rule. None of this is dangerous, but the k-table and ramp arithmetic should be fixed before release.

### What's well-grounded
- The core idea that **vert must be its own currency** — counting 10 km/1000 m D+ as "10 km" genuinely under-loads the climber (Minetti 2002: 3.4 J/kg/m level → 18.9 J/kg/m at +45%).
- **k ≈ 1.0 is defensible as a lower bound at steep, efficient grades** (~36 J/kg per vertical m ÷ ~3.4 J/kg/m flat ≈ 10.5 flat m per vertical m → 100 m ≈ 1.05 flat km).
- The **two-axis instinct** (separating aerobic/EFD from musculoskeletal/D+ load) is correct.
- The **big-vert → eccentric-damage-outlasts-HRV gate** — descent damage lags autonomic markers; trusting legs over HRV is exactly right.
- **Downhill repeats + repeated-bout effect** — a single eccentric bout protects ~2–10 weeks; periodic downhill work is evidence-based.
- **Polarized 80/20 retained, zones unchanged** — consistent with Seiler-lineage TID evidence.
- **Long-run-as-%-of-race-EFD and back-to-back weekends** — mainstream, sensible ultra practice.

### Concerns & corrections

| Location | Issue | Severity | Recommended change | Evidence/citation |
| --- | --- | --- | --- | --- |
| `load-management.md` k-table; `trail.md`; epic plan §1 | k-adjustment table is **physiologically inverted** — per vertical metre, gentle grades are the *expensive* ones (~68–100 J/kg/m at 5–10°) and steep grades the *cheap* ones (~36–51 J/kg/m at 20–40°). Conflates technical/skill cost with metabolic cost per vertical metre. | **High** | Drop the directional claim and present k as a single tunable fudge (~0.8–1.2) with an honest note that per-vertical-metre cost *falls* as grade steepens, and the higher k for technical terrain is a musculoskeletal/skill surcharge, not metabolic. | Minetti et al. 2002, *J Appl Physiol* 93:1039–46; VK running-economy study, PMC10708873 |
| `load-management.md` two-axis | **Partial double-counting** — EFD already contains D+; "two independent axes" overstates it. | Med | Reframe: D+ = primary musculoskeletal axis, EFD = aerobic; they overlap by construction. Consider a descent-volume axis as the true eccentric metric. | Formula construction; eccentric-damage literature |
| `periodization.md` 12-wk table, Wk1→2 & Wk5→6 D+ | **Violates the doc's own ≤10% rule** (D+ steps +16.7%, +14.3%, +15.8%, +13.6%). | Med | Soften to ~10–15% (more honest) and note post-recovery rebuilds, or re-number so D+ steps ≤10%. Stop claiming a strict 10% cap the block doesn't meet. | Self-consistency; Nielsen et al. 2014 |
| `load-management.md`; `periodization.md` 10% rule | **10%/week presented as harder evidence than it is** (no injury benefit found; spikes in single long sessions matter more). | Med | Add: "10%/week is a prudent ceiling, not a validated threshold; the better-supported rule is to avoid spiking any single long session beyond recent longest." | Buist 2008; Nielsen 2014 *JOSPT*; Damsted SR, PMC6253751 |
| `load-management.md` >800 m → 1.5× | **Threshold & multiplier are uncited heuristics**, and descent (not D+) drives damage. | Med | Keep as explicit heuristic; tie trigger to descent volume. | Eccentric-damage literature |
| `load-management.md` ACWR/CTL (inherited) | ACWR family increasingly contested. | Low | Note these are monitoring aids, not validated predictors. | Impellizzeri; PMC8138569; PMID 33332011 |
| `periodization.md` race-EFD example | "38 EFD → 27–30 long run" fine for 26 km; for true ultras anchor by **time on feet**. | Low | Add pointer: races >~50 km cap by duration, not EFD%. | Standard ultra practice |

### Gaps / what's missing
- **No descent/eccentric volume axis** — D+ counts ascent; damage is from descent. Net-downhill point-to-points are invisible.
- **GAP never mentioned** — the grade-sensitive pace cousin of EFD; relate the two.
- **EFD has no downhill term** — understates steep descents.
- **No method to measure individual `k`** — "tunable" but no guidance, so everyone uses 1.0 and the table is decorative.
- Power-hike thresholds reasonable but individual; Minetti's walk/run crossover is ~20–25% for trained runners — "hike >15–20%" is a touch aggressive for the fit, fine for amateurs.

### For the time-and-means-limited amateur
- **Just use k = 1.0 and stop** — the k-table will mislead more than help, and an amateur can't measure their own k.
- **The D+ ramp matters more than the EFD ramp** for you — ramp vert conservatively even when EFD looks easy; do the downhill repeats (highest-value session in the package for 3–5×/wk athletes).
- **Don't chase the 12-week block's D+ numbers literally** — several weeks jump >15%. Treat the *shape* as the lesson.
- **Heed the legs-soreness gate over the watch** — the single most useful rule here.
- **If flat terrain only**, stacked-climb/repeated-hill long runs and eccentric strength (slow step-downs) are the right substitutes.

### Key references
- Foster, Casado, Seiler et al. 2022 — *Polarized Training Is Optimal for Endurance Athletes* — https://www.researchgate.net/publication/358505326
- Polarized vs other TID SR/MA 2024 — https://pmc.ncbi.nlm.nih.gov/articles/PMC11329428/
- Vertical-Kilometre running economy 2023 — https://pmc.ncbi.nlm.nih.gov/articles/PMC10708873/
- *Acute:Chronic Workload Ratio — Is There Scientific Evidence?* 2021 — https://pmc.ncbi.nlm.nih.gov/articles/PMC8138569/
- *Time to Dismiss ACWR* 2020, PMID 33332011 — https://pubmed.ncbi.nlm.nih.gov/33332011/
- Damsted et al. — training-load change & RRI SR — https://pmc.ncbi.nlm.nih.gov/articles/PMC6253751/
- Nielsen et al. 2014 — *Excessive Progression in Weekly Running Distance & RRI*, *JOSPT* — https://www.jospt.org/doi/10.2519/jospt.2014.5164
- *A single bout of downhill running attenuates subsequent level-running fatigue* 2020, *Sci Rep* — https://www.nature.com/articles/s41598-020-76008-2
- Minetti et al. 2002 — *Energy cost of walking and running at extreme uphill and downhill slopes* — https://journals.physiology.org/doi/full/10.1152/japplphysiol.01177.2001

---

## 4. Trail / ultra & mountain specialist

### Overall assessment
A strong, coherent, unusually well-grounded trail layer — EFD + two-axis, vert-separate periodization, dedicated downhill/eccentric work, and grade-aware pacing are exactly the right priorities, and the design correctly identifies eccentric descent damage as the dimension road-style plans miss. Grade thresholds and downhill dosing are defensible and broadly literature-aligned. The notable holes: inconsistent threshold numbers between docs, and the absence of heavy strength, technical-terrain skills, race safety/execution, and a real flatlander pathway. Nothing dangerous; gaps are of omission. Biggest single critique: the strength section leans entirely on slow eccentric tempo and misses the better-evidenced lever (heavy resistance) for economy and durability.

### What's well-grounded
- **Power-hike-by-grade as a trained skill** — walking becomes more economical on steep grades (≥~15.8°/~28%, ~8%+ saving); elites hike steep/long climbs deliberately.
- **Downhill repeats / eccentric conditioning as the #1 quad-blowup defense** — repeated-bout effect; 2 bouts/wk ≥72 h apart reduce damage markers.
- **Eccentric/descent load as real load + recovery multiplier + legs gate over HRV** — even experienced runners get a damage spike from a short, CV-easy downhill bout; cardio metrics understate the cost. The doc's best insight.
- **Descend conservatively early; pace by effort/grade; HR lags on climbs** — consistent with mountain-ultra data and durability/decoupling (~60–70% of race distance).
- **Poles "decide and train before taper"** — barely change economy but lower RPE/muscular cost, ~2.5% faster on sustained ~19° climbs; rehearse, don't spring on race day.
- **B2B weekends, stacked-climb long runs, long run = 70–80% race EFD** — sensible, conservative.

### Concerns & corrections

| Location | Issue | Severity | Recommended change | Evidence/citation |
|---|---|---|---|---|
| `trail.md` vs `workouts.md` vs `race-day.md` | Run/hike thresholds **internally inconsistent** (run <10–12%/hike >15–20% vs run <12%/hike >18%). | Med | Pick one band everywhere: "run <~10–15%, power-hike >~15–20%, gray zone by economy." | Outside 2022 uphill-running review |
| All three docs — threshold framing | Thresholds framed as **economy crossover**, but walking beats running only at ~25–30%+. At 15–20% trained runners are still more economical running; hiking there is for pacing/fatigue. | Med | Distinguish: 15–20% = practical/sustainability hike point; pure-economy crossover ~25–30%. Don't claim hiking is "cheaper" at 15%. | Minetti 2002; EOTS, PMC4575035 |
| `workouts.md` Trail strength | **Entirely slow-eccentric + stability; omits heavy resistance (≥80–90% 1RM)**, the strongest lever for economy + durability. | Med→High | Add a heavy/maximal-strength block (squat/split squat/deadlift 3–5×3–6 heavy), then transition to eccentric/power for specificity. | Llanos-Lagos 2023 meta; heavy-vs-plyo meta PMC9653533 |
| `workouts.md` downhill progression | First dedicated downhill exposure lands wk 5 with no protective primer; first bout is highest-DOMS. ≤2/wk, ≥72 h spacing not stated. | Med | Add an easy "primer" downhill bout in Base (wk 2–3); ≤2 downhill sessions/wk ≥72 h apart; maintenance dose through taper. | RBE literature; PMC7606541 |
| `race-day.md` pacing | Omits the strongest finding: **faster finishers run downhills relatively faster and climbs slower.** | Med | Add: "Time is made on descents, not climbs — bank conservative early descents so you can still *run* the late ones." | UTMB even-pacing PMC7578994; WS100 2025 |
| `race-day.md` execution | **Missing cutoffs/time-budget, mandatory kit, weather/hypothermia, crew/drop-bags, night running, foot care** — partly safety-critical. | High | Add a "Mountain race execution & safety" subsection. | Standard UTMB/WS/skyrace practice |
| `workouts.md` session menu | **No technical-descent skill session** — quad failure and falls happen on technical descents; reps are "non-technical" only. | Med | Add a technical-descent skills session (progressive terrain; quick cadence, eyes ahead). | MDPI Sports 14/1/12 |
| `periodization.md` 12-wk block | Assumes mountain access throughout; Wk1 start at 600 m/wk presumes an already-Hilly athlete — a flatlander can't begin here. | Med | Note entry D+ must ramp from the athlete's *actual* recent weekly D+, not the template's 600 m; give treadmill/repeat-hill substitutions. | Two-axis ≤10% rule |
| `trail.md`/`workouts.md` k tuning | EFD uses k for ascent only; net-downhill (D−-heavy) races carry quad load neither EFD nor climb-based D+ captures. | Low | Note D−-heavy races need eccentric prep keyed to total descent. | MDPI 14/1/12 |
| `race-day.md` HR ceiling | For >6–8 h efforts, sustainable HR drifts *down*; early ceiling not maintainable late. | Low | Add: expect the sustainable ceiling to fall over time; early HR should sit below the listed ceiling. | Smyth 2022 PMC9388405 |

### Gaps / what's missing
- Heavy/maximal strength; technical-descent skill session; race-execution & safety; **heat acclimatization**; night running; plyometrics/reactive strength; a descent-specific time-budget method; cramp/late-race dysfunction beyond sodium.

### For the time-and-means-limited amateur (weakest-covered persona)
- **Treadmill incline** as the primary flatland climb substitute (+ hands-on-rail to simulate steeper walls); trains climb + aerobic cost but **not** eccentric/descent load.
- **The eccentric gap is the real flatlander problem** — get descent durability from strength (slow step-downs) + any repeatable descent (parking garages, stadium ramps, overpasses, levees, dunes, stairwells). Highest-value flatland advice; currently missing.
- **Repeat-hill / lap protocol** — one short hill repeated to bank D+ and downhill reps.
- **Time-crunched priority order:** (1) long run with vert/EFD, (2) downhill/eccentric stimulus, (3) one quality climb session, (4) heavy strength 1×.
- **Adjust EFD `k` and D+ entry tier to actual terrain access** — don't start a flatlander at 600 m/wk.

### Key references
- Hunter et al. 2025 — *Durability of Parameters Associated With Endurance Running in Marathoners* — https://pmc.ncbi.nlm.nih.gov/articles/PMC12547624/
- *Pacing in ultra-marathon running: Western States 100, 2006–2023* 2025 — https://www.nature.com/articles/s41598-025-92141-2
- *Downhill Running-Induced Muscle Damage in Trail Runners* 2024 — https://www.mdpi.com/2075-4663/14/1/12
- Llanos-Lagos et al. 2023 — *Strength Training & Runners' Economy at Different Speeds: SR/MA* — https://link.springer.com/article/10.1007/s40279-023-01978-y
- Smyth & Maunder 2022 — *Decoupling of Internal & External Workload During a Marathon* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9388405/
- Heavy resistance vs plyometric for RE SR/MA — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9653533/
- Outside 2022 — *The Ultimate Guide to Uphill Trail Running* — https://www.outsideonline.com/health/training-performance/uphill-trail-running-research-2022/
- Koop — *The Science Behind Trekking Poles in Trail & Ultrarunning* — https://trainright.com/science-trekking-poles-trail-running-ultrarunning/
- Mooses/Frontiers 2021 — *Level/Uphill/Downhill Running Economy Correlated Except on Steep Slopes* — https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2021.697315/full
- Eston et al. (RBE) — https://pmc.ncbi.nlm.nih.gov/articles/PMC7606541/
- Knechtle et al. 2020 — *Even Pacing & Faster Finishing — UTMB 2008–2019* — https://pmc.ncbi.nlm.nih.gov/articles/PMC7578994/
- Mooney/EOTS 2015 — https://pmc.ncbi.nlm.nih.gov/articles/PMC4575035/
- Minetti et al. 2002 — https://journals.physiology.org/doi/full/10.1152/japplphysiol.01177.2001

---

## 5. Sports nutritionist / fueling expert

### Overall assessment
Solidly grounded and unusually well-integrated with the pre-existing carb/hydration/caffeine tables — periodized daily carbs, the multiple-transportable-carb rationale, gut training, the caffeine-timing rewrite, and the altitude note are all defensible and on-message with current consensus. Two genuine weaknesses: (1) the in-race ceiling is internally inconsistent (hub/prose say 60–90 g/hr; the kept table already lists 80–120 for 4+ h, and the strongest recent ultra evidence supports >90 for the longest efforts with a trained gut); (2) sodium and **hyponatremia are under-served** — the dominant safety risk in ultras is dilutional EAH from over-drinking, which is never mentioned. Plus minor accuracy fixes on the glucose:fructose framing and the >60 g/hr transporter threshold.

### What's well-grounded
- **Periodized "fuel for the work required" daily carbs (3–4 / 5–6 / 7–9 g/kg)** + protein 1.6–1.8 g/kg — textbook (Stellingwerff/Morton/Burke 2018); 7–9 g/kg high band is appropriately conservative.
- **Multiple-transportable carbs** (SGLT1/GLUT5; ~50% oxidation gain over glucose-only at 90 g/h) — correctly represented.
- **Caffeine-timing rewrite** — onset ~30–45 min, dose ~45–60 min before the hard finish, 3 mg/kg pre + 1–2 during — consistent with ISSN 2021.
- **"Start fueling by 45 min"** — sound front-loading.
- **Gut training mandatory, ≥3 long runs** — well-supported; B2B/peak placement sensible.
- **Altitude appetite suppression → eat to schedule** — correct (hypoxia raises satiety signaling).
- **Eat on descents/flats not mid-hard-climb; real food past ~2 h** — practical (splanchnic perfusion falls at intensity).

### Concerns & corrections

| Location | Issue | Severity | Recommended change | Evidence/citation |
| --- | --- | --- | --- | --- |
| `race-day.md` fueling + `trail.md` | Ceiling stated 60–90 g/hr for >2.5 h, but kept table prescribes **80–120 g/hr for 4+ h** — contradiction; evidence supports >90 for longest efforts. | **High** | For >~3–4 h with a trained gut, raise to **up to ~90–120 g/hr**, cross-referencing the 4+ h row. Keep 60–90 as default/entry. | Viribay/San Millán 120 vs 90 vs 60 g/h trail-marathon studies 2020, PMC7284742, PMC7400827 |
| Fueling prose + hub ">60 g/hr → multiple-transportable" | 60 g/hr is the single-glucose ceiling; statement slightly overstated. | Low | Reword: "single-source glucose oxidation plateaus near ~60 g/hr; to fuel reliably at ~70 g/hr+, use multiple-transportable carbs." | Jeukendrup; ACSM/IOC |
| Glucose:fructose ~1:0.8 | Presented as the single right answer; evidence is nuanced (no performance advantage of 120 g/h @1:0.8 over 90 g/h @2:1). | Med | Frame 1:0.8 as preferred at high intakes; 2:1 still acceptable; performance evidence between ratios not decisive. | Hearris et al. 2022, PMC9560939 |
| Hydration/sodium ("keep table, add nothing new") | **No mention of EAH**, the dominant fluid safety risk; primary driver is over-drinking, not low sodium. | **High** | Add EAH safety note: drink to thirst, don't over-drink; sodium does not prevent EAH; flag confusion/headache/nausea + weight gain. | Hoffman & Stuempfle 2015, PMC4688305; ACEP 2022 |
| Sodium table (temperature-only) | Hides ~10× inter-athlete variability (sweat [Na⁺] ~200–2000 mg/L). | Med | Keep as starting point; add: per-hour sodium is individual; salty sweaters need the high end / a sweat test. | Baker 2017, PMC5371639 |
| Daily carb table "fat reduced on day" | Bare rule; blanket fat reduction on huge days risks energy deficit. | Low | Clarify it's a macro-mix shift, not an energy cut; protect total energy availability. | IOC RED-S consensus; FFTWR 2018 |
| Caffeine + 5+ h row | Late-event sleep disruption implied, not stated. | Low | Add: in late-finishing/multi-day events, weigh benefit vs post-race sleep disruption (~5 h half-life). | ISSN 2021 |

### Gaps / what's missing
- **EAH / over-drinking safety** (biggest omission); **sodium individualization**; **upper carb ceiling** for longest efforts; **pre-race carb-loading for ultras** + overnight/aid-bag logistics; **GI-distress in-race rescue**; **in-race protein** for 12+ h; **hydration ↔ carb-concentration interaction** in heat.

### For the time-and-means-limited amateur
- **DIY 1:0.8 drink mix beats gels on cost** — table sugar (sucrose) is ~1:1 glucose:fructose; ~60–80 g + a pinch of salt + squash per ~500–750 ml ≈ a multiple-transportable mix for pennies. Add bulk maltodextrin to nudge glucose-dominant.
- **Real-food carbs** (banana, dates, salted potatoes, pretzels, white rice, jam sandwiches, fig bars) = 20–40 g carb at a fraction of gel cost.
- **Sodium on a budget** — plain table salt (~390 mg Na/g); pair with the EAH caution (salt to taste/cramp comfort, drink to thirst).
- **Caffeine cheaply** — flat cola at aid stations / a caffeine tablet 45–60 min before the hard finish.
- **Gut-train on the cheap race mix itself**, not on gels you'll swap out.

### Key references
- Guest et al. 2021 — *ISSN position stand: caffeine & exercise performance* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7777221/
- Hearris et al. 2022 — *Combined fructose-maltodextrin at 120 vs 90 g·h⁻¹ at different ratios* — https://pmc.ncbi.nlm.nih.gov/articles/PMC9560939/
- Viribay/San Millán et al. 2020 — *120 g/h CHO during a mountain marathon & muscle damage* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7284742/
- Urdampilleta/San Millán et al. 2020 — *120 vs 60/90 g/h CHO during a trail marathon & recovery* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7400827/
- Stellingwerff, Morton, Burke 2018 — *Fuel for the work required* — https://pmc.ncbi.nlm.nih.gov/articles/PMC5889771/
- Hoffman & Stuempfle 2015 — *Sodium intake during an ultramarathon does not prevent cramping, dehydration, hyponatremia, nausea* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4688305/
- Baker 2017 — *Sweating rate & sweat sodium concentration in athletes* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5371639/
- ACEP 2022 — *Exercise-associated hyponatremia* — https://www.acep.org/sportsmedicine/newsroom/newsroom-articles/october-2022/exercise-associated-hyponatremia2
- *EAH in endurance & ultra-endurance performance* 2019 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6780610/

---

## 6. Sports physiotherapist

### Overall assessment
Unusually durability-literate for a coaching skill: EFD as a two-axis load model, an explicit big-vert recovery multiplier, dedicated downhill/eccentric work, and a legs-soreness gate are the right *conceptual* moves and largely evidence-aligned. Biggest weaknesses: (1) under-specified strength dosing (no sets/reps/load, missing hip/glute and plyometric/tendon-stiffness work, calf is quad-framed rather than Achilles-framed); (2) a single 1–5 general soreness number as the primary musculoskeletal gate with no pain-vs-soreness or red-flag language; (3) no return-from-injury / beginner / masters modifiers on the ≤10%/week caps — the populations most likely to be hurt. All fixable with text.

### What's well-grounded
- **Two-axis load + the statement that equal EFD hides different musculoskeletal load** — bone/connective tissue track impact/eccentric cycles, not aerobic cost; rapid load increase is the consensus BSI driver (Warden 2021).
- **>800 m → 1.5× multiplier + descent damage outlasts cardio cost & is understated by HRV** — physiologically sound; eccentric damage/DOMS peak 24–72 h.
- **Downhill repeats as deliberate quad conditioning** — RBE protection ~5–35 days.
- **Eccentric tempo (3–4 s lowering) as the active ingredient** — consistent with HSR/tendon literature.
- **"Eccentric load is real load"** — correct and often missed.
- **Strength 1–2×/wk, taper to maintenance; descend conservatively early** — well-aligned.

### Concerns & corrections

| Location | Issue | Severity | Recommended change | Evidence/citation |
|---|---|---|---|---|
| `workouts.md` Trail Strength | **No sets/reps/load or progression** — an amateur can't dose "slow single-leg squats." | High | Add concrete dosing (e.g. eccentric calf 3×15 → Alfredson 3×15×2 daily for symptomatic Achilles; step-downs 3×6–10/leg at controlled RPE; progress load→reps→tempo). | Habets 2021 RCT; Maetz 2023 SR/MA |
| `workouts.md` table | **No hip/glute work** — central to injury prevention & controlling pelvic drop/knee valgus on descents. | High | Add a hip/glute row (hip thrust/single-leg bridge, banded lateral walk, side-lying abduction). | Šuc 2022; injury-risk umbrella reviews |
| `workouts.md` table | **No plyometric / tendon-stiffness / HSR component** — reduces injury risk & improves economy; most likely missing in older athletes. | Med | Add low-dose plyo/HSR in build (not for true beginners pre-strength-base). | Eihara 2022; Llanos-Lagos 2024 |
| `workouts.md` "eccentric calf … on long descents" | Calf framed for **descents** but loaded most on **climbs/push-off**; "eccentric calf raises" alone is dated Alfredson-only framing. | Med | Reframe calf as climbing/push-off + landing resilience; note combined concentric-eccentric (Silbernagel) & HSR equal pure eccentric with better adherence. | Habets 2021; Maetz 2023 |
| `load-management.md` & `assessment.md` gate | **Single general soreness 1–5 is the sole gate** — can't distinguish diffuse DOMS from sharp/localized/worsening pain or bone stress. | High | Add a pain-vs-soreness rule: bilateral/diffuse/improving = DOMS (gate big-vert only); sharp/localized/worsening/bony tenderness = stop & assess. | DOMS-vs-injury guidance 2023–24; Warden 2021 |
| Across trail docs | **No red-flag / when-to-stop / clinician guidance** — no BSI signs, no RED-S, no tendon-pain rules. | High | Add a short "Pain, red flags & when to stop" block (focal/worsening/night bone pain → suspect BSI; sharp tendon pain >24 h or warmth/swelling → load down; persistent fatigue + low EA → screen RED-S). | Warden 2021; Hoenig/Tenforde 2021 |
| `load-management.md` ≤10%/wk caps | **No population modifiers** — too aggressive for beginners/return-from-injury (bone/tendon lag muscle/CV). | Med | Beginners/RTI cap nearer ≤5–8%/wk on D+; hold the new axis flat 1–2 wk; ramp D+ *after* EFD. | BSI workload reviews 2021; the doc's own CTL ramp-by-level table |
| `workouts.md` downhill "+1–2 reps/wk" | Progression by reps only; no grade/speed cap, no minimum spacing. | Med | Add ≥48–72 h spacing, cap ~1–2/wk, progress grade/speed only after reps tolerated, hold an easy intro session for RBE protection. | RBE downhill reviews 2022–24 |
| 12-wk block wk5 | First eccentric exposure mid-build, no protective primer; unprotected first bout = highest DOMS. | Low | Insert an easy short downhill primer in Base (wk 2–3). | RBE literature |

### Gaps / what's missing
- **Pain-vs-soreness rule + explicit red flags** (largest safety gap); **strength dosing + hip/glute + plyo/HSR**; **return-from-injury / beginner / masters modifiers** (masters get more eccentric damage & slower recovery — scale the 1.5× multiplier & spacing up with age); **energy availability / RED-S** (ultra training + a 3–4 g/kg recovery-day floor is a classic low-EA setup driving BSI); **ACWR nuance** (keep the simple cap, don't upgrade to ACWR as if validated; note monotony & cumulative load); **footwear/cushioning, body-mass, surface** as descent-damage modifiers; **calf/Achilles climbing load** under-emphasized.

### For the time-and-means-limited amateur
- **If only one strength thing fits:** eccentric step-downs/decline single-leg squats + a hip/glute exercise, 2×/wk, 6–10 reps controlled (~15 min). Covers the highest-yield descent + pelvic-control adaptations.
- **Older athletes: assume longer recovery from anything eccentric** — wider spacing (≥72 h), apply 1.5× multiplier more generously, don't stack hard downhill the day before a long run; cycling/elliptical when legs are flagged.
- **Returning-from-injury / true beginner:** hold the new axis flat first, then ramp D+ slower than EFD (~5–8%/wk), bank an easy downhill primer first.
- **Heavier amateurs take more eccentric load per stride** — start downhill reps shorter, on gentler grades; progress grade last.
- **Learn the pain-vs-soreness distinction explicitly** — a soreness number alone won't catch a developing stress fracture, and the older/undertrained returning body is exactly where that matters.

### Key references
- Llanos-Lagos et al. 2024 — *Strength Training & Middle-/Long-Distance Runners' Economy: SR/MA* — https://pmc.ncbi.nlm.nih.gov/articles/PMC11052887/
- *Age-Associated Differences in Recovery from Exercise-Induced Muscle Damage* 2024 — https://www.mdpi.com/2073-4409/13/3/255
- Maetz et al. 2023 — *Loading protocols for midportion Achilles tendinopathy SR/MA* — https://journals.sagepub.com/doi/10.1177/23259671231171178
- *Repeated Bout Effect of Downhill Running … Trained Female Distance Runners* 2024 — https://www.mdpi.com/2075-4663/12/6/169
- Eihara et al. 2022 — *Heavy Resistance vs Plyometric for Running Economy/Performance: SR/MA* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9653533/
- Šuc et al. 2022 — *Resistance Exercise for Running Economy, Biomechanics & Injury Risk* — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9319953/
- Habets et al. 2021 — *Alfredson eccentric vs Silbernagel combined loading: RCT* — https://pmc.ncbi.nlm.nih.gov/articles/PMC8554573/
- Warden et al. 2021 — *Optimal Load for Low-Risk Tibial/Metatarsal Bone Stress Injuries* (JOSPT) — https://www.jospt.org/doi/10.2519/jospt.2021.9982
- Hoenig/Tenforde et al. 2021 — *Preventing Bone Stress Injuries in Runners with Optimal Workload* — https://pmc.ncbi.nlm.nih.gov/articles/PMC8316280/
- *Training Load Capacity, Cumulative Risk & Bone Stress Injuries* Frontiers 2021 — https://pmc.ncbi.nlm.nih.gov/articles/PMC8192811/
- *A single bout of downhill running attenuates subsequent level running-induced fatigue* 2020 — https://www.nature.com/articles/s41598-020-76008-2

---

## 7. Suggested next step

Work the **P0 list** (5 items) plus the highest-consensus P1 items (strength section #6, the 12-week ramp #7, race-safety subsection #8) into the trail docs on this branch, then re-run a lighter verification pass before merging `trail-ultra` → `main`. P2/P3 can be a follow-up ticket. If desired, these can be filed as new sub-tasks under the Trail/ultra epic on the Notion board.