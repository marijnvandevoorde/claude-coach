# Readiness-Driven Daily Adjustment

A static plan is a starting point, not a contract. When Garmin data is available (see `garmin.md`), **adjust today's prescribed session to how the athlete actually recovered** — ease, swap, or green-light. This is the difference between a plan and a coach.

Apply this whenever you're about to confirm, prescribe, or discuss **today's** (or tomorrow's) session — at session start, in the morning check-in, or any time the athlete asks "should I do X today?".

## Step 1: Read the readiness signals

Pull today's values (see `garmin.md` for the tools). The cached snapshot is also in `coach.db` (`wellness_state`) and surfaced by `coach checkin`.

| Signal                     | Source                      | "Go"                   | "Caution"            | "Hold back"              |
| -------------------------- | --------------------------- | ---------------------- | -------------------- | ------------------------ |
| **Training readiness**     | `get_training_readiness`    | 75–100 (prime)         | 50–75 (moderate)     | <50 (low/poor)           |
| **Sleep**                  | `get_sleep_summary`         | ≥7 h, score ≥70        | 6–7 h or score 50–70 | <6 h or score <50        |
| **HRV**                    | `get_hrv_data`              | balanced               | —                    | unbalanced / low         |
| **Body battery (morning)** | `get_body_battery`          | ≥60                    | 30–60                | <30                      |
| **Resting HR**             | `get_rhr_day`               | ≈ baseline             | +3–5 bpm             | ≳ +7 bpm                 |
| **Subjective** (logged)    | `coach log energy/soreness` | energy ≥4, soreness ≤2 | mid                  | energy ≤2 or soreness ≥4 |

Weight **training readiness** highest (it already fuses sleep, HRV, recovery time, stress). The others confirm or override: e.g. a decent readiness number but **HRV unbalanced + RHR elevated together** is a real red flag — trust the body signals.

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

- **Two-day rule:** readiness <50 for **2+ consecutive days**, or HRV unbalanced + elevated RHR together, → insert real recovery, don't just trim.
- **Illness signal:** RHR spiking well above baseline + low HRV + poor sleep → recommend rest and monitoring, not training through it.
- **Don't overreact to one reading:** a single low night with otherwise good trends → a small trim, not a teardown. Prefer trends (multi-day) for structural changes, single readings for _today's_ dial.
- **No Garmin data?** Fall back to subjective check-in (`coach log energy/soreness/sleep`) and RHR from Strava/manual; be a bit more conservative since you're flying with fewer instruments.

> `coach checkin` already computes a recovery level + flags from the cached signals and can push a morning nudge. Use it as the trigger; use this doc to decide the actual change to the session.
