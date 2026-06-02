# Readiness-Driven Daily Adjustment

A static plan is a starting point, not a contract. When Garmin data is available (see `garmin.md`), **adjust today's prescribed session to how the athlete actually recovered** — ease, swap, or green-light. This is the difference between a plan and a coach.

Apply this whenever you're about to confirm, prescribe, or discuss **today's** (or tomorrow's) session — at session start, in the morning check-in, or any time the athlete asks "should I do X today?".

## Step 1: Read the readiness signals

Pull today's values (see `garmin.md` for the tools). The cached snapshot is also in `coach.db` (`wellness_state`) and surfaced by `coach checkin`.

| Signal                     | Source                                     | "Go"                   | "Caution"            | "Hold back"              |
| -------------------------- | ------------------------------------------ | ---------------------- | -------------------- | ------------------------ |
| **Training readiness**     | `get_training_readiness` / coach `checkin` | ≥75 prime · 55–74 high | 40–54 moderate       | <40 low/poor             |
| **Sleep**                  | `get_sleep_summary`                        | ≥7 h, score ≥70        | 6–7 h or score 50–70 | <6 h or score <50        |
| **HRV**                    | `get_hrv_data`                             | balanced               | —                    | unbalanced / low         |
| **Body battery (morning)** | `get_body_battery`                         | ≥60                    | 30–60                | <30                      |
| **Resting HR**             | `get_rhr_day`                              | ≈ baseline             | +3–5 bpm             | ≳ +7 bpm                 |
| **Subjective** (logged)    | `coach log energy/soreness`                | energy ≥4, soreness ≤2 | mid                  | energy ≤2 or soreness ≥4 |

Weight **training readiness** highest (it fuses sleep, HRV, recovery/load, stress). The others confirm or override: e.g. a decent readiness number but **HRV unbalanced + RHR elevated together** is a real red flag — trust the body signals. Map the five readiness labels onto the three columns below: **prime/high → Go**, **moderate → Caution**, **low/poor → Hold back**.

### Native vs. reconstructed readiness

Many watches expose Garmin's own **Training Readiness** number. Some don't (the API returns nothing) — for those, `coach checkin` **reconstructs** a readiness score from the same primary signals Garmin uses (sleep score + recovery/load via ACWR as primary drivers; HRV-vs-baseline, stress, and sleep history as secondary), on the same 0–100 / Poor→Prime scale, and reports the **factor breakdown** (e.g. _"derived ~63: sleep 54, ACWR 1.40, HRV 7d 64 vs 66–78, stress 12"_).

When the score is reconstructed, **read the limiting factor — it tells you _how_ to adjust**:

- **Sleep-limited** (low sleep score, short duration) → the fix is recovery/rest and sleep hygiene, not necessarily a training problem. A single bad night = trim today; a multi-night deficit = protect the week.
- **Load/ACWR-limited** (high acute:chronic ratio) → this is training fatigue you created — ease _intensity_ and let recent load settle; it resolves with a down day.
- **HRV-limited** (7-day avg below the balanced band) → autonomic fatigue; if paired with elevated RHR or poor sleep, treat as a possible overreaching/illness signal (see Guardrails), not just a tired day.
- Treat **morning Body Battery as optimistic** — it recharges overnight regardless of training debt, so use it as a tie-breaker, not a lead signal.

## Step 2: Decide the adjustment

Cross today's **planned session** against the **overall readiness** (the worst of the "go/caution/hold" buckets that two or more signals land in):

| Planned session ↓ / Readiness →                                      | **Go (prime)**                                                                               | **Caution (moderate)**                                                                                                     | **Hold back (low/poor)**                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Key quality** (intervals, threshold, race-pace, long w/ intensity) | Green-light. If consistently prime + peaking, consider nudging volume/intensity up slightly. | Keep the session but trim: fewer reps or lower the top end (e.g. threshold → tempo). Hit the _purpose_, not the _maximum_. | **Swap to easy aerobic** (Z2) at the same or reduced duration, or move the quality session to tomorrow and pull an easy day forward. |
| **Endurance / long aerobic**                                         | Proceed as planned.                                                                          | Proceed, but cap intensity (keep strictly Z2, walk hills) and be willing to cut it short.                                  | Reduce duration ~30–50%, keep it very easy, or convert to active recovery.                                                           |
| **Easy / recovery**                                                  | Proceed (this is already easy).                                                              | Proceed.                                                                                                                   | Proceed as recovery, or take **full rest** — recovery days exist to absorb training; don't junk them.                                |
| **Rest**                                                             | Rest. (If prime and itching, a short opener is fine, but rest is rarely wrong.)              | Rest.                                                                                                                      | Rest — fully.                                                                                                                        |

**Swap recipes** (keep the day's _slot_ and rough duration, change the stimulus):

- Threshold/VO₂ → **Z2 endurance** (same duration) when readiness is low.
- Long run with surges → **flat steady long run**, surges removed, when HRV is unbalanced.
- Hard bike → **easy spin** or mobility when body battery started <30.
- Any quality → **rest or 20–30 min walk** when two+ signals are "hold back" or readiness <25.

## Step 3: Communicate it (don't just override)

- **Explain the why from the data:** "Your readiness is 42 and HRV came back unbalanced after two short nights — I'd swap today's threshold run for an easy 40 min and move the quality session to Thursday. Sound good?"
- **Offer the choice.** The athlete knows context the watch doesn't (a bad night with a sick kid ≠ overtraining). Devices misread; lived experience wins ties.
- **Protect the key sessions.** When easing, preserve the week's _most important_ workout by moving it, not deleting it; shed the secondary stuff first.
- **Green-light explicitly when fresh.** Prime readiness on a quality day → say so and encourage it. Don't only ever apply the brakes.

## Guardrails

- **Trust subjective when it disagrees.** Logged energy/soreness/mood feed the readiness score, and a clearly-bad subjective day (energy ≤2 or soreness ≥4) **caps** an otherwise-rosy objective score at "moderate" — self-report tracks training response at least as well as the sensors (Saw et al. 2016, BJSM). If the athlete says they feel wrecked, believe them over a green number.
- **Above-the-neck rule for illness.** Symptoms **below** the neck — fever, body aches, chills, chest congestion, GI illness — mean **don't train**, regardless of what readiness says (physiology lags symptoms; training through systemic illness carries real cardiac risk). Symptoms only above the neck (mild congestion, sore throat) → easy training is usually OK; reassess.
- **Illness/overreaching signal:** resting HR **sustained ~+5 bpm or more** over baseline + low HRV + poor sleep → recommend rest and monitoring, not training through it. One elevated morning is noise; the multi-day pattern is the signal.
- **Two-day rule:** readiness <50 for **2+ consecutive days**, or HRV unbalanced + elevated RHR together, → insert real recovery, don't just trim.
- **RED-S / under-fuelling watch:** persistently low readiness **with** suppressed RHR/HRV **and** flat-or-declining performance despite heavy load can signal **low energy availability (RED-S)**, not just fatigue — the fix is fuelling and a medical/nutrition check, not more rest. Surface the pattern; don't try to diagnose it. (2023 IOC REDs consensus.)
- **Don't overreact to one reading:** a single low night with otherwise good trends → a small trim, not a teardown. Prefer trends (multi-day) for structural changes, single readings for _today's_ dial.
- **Sleep mostly raises perceived effort.** A short night reliably elevates RPE more than it drops raw power/pace, so the same session will _feel_ harder — ease the top end rather than cancelling outright, unless sleep debt is stacking across nights.
- **No Garmin data?** Fall back to subjective check-in (`coach log energy/soreness/sleep`) and RHR from Strava/manual; be a bit more conservative since you're flying with fewer instruments.

> `coach checkin` already computes a recovery level + flags from the cached signals and can push a morning nudge. Use it as the trigger; use this doc to decide the actual change to the session.
