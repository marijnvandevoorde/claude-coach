// ============================================================================
// From-scratch Training Readiness
//
// Garmin's Training Readiness isn't exposed on every device (the API returns an
// empty list). When it's missing we reconstruct it from the SAME primary sensor
// signals Garmin documents — sleep score + recovery/load (ACWR) as the two
// "primary drivers", then HRV-vs-baseline, subjective wellness, sleep history
// and stress as secondary influences — weighted accordingly.
//
// We use the *primary* signals directly and do NOT feed in Body Battery or
// Training Status: those are composites of HRV/sleep/stress, so including them
// would double-count. They're surfaced as context elsewhere, not as inputs.
//
// Calibrated against an endurance-coaching evidence review (2024–2026):
//  - Subjective wellness (energy/soreness/mood) IS an input — self-report tracks
//    training response at least as well as objective measures (Saw et al. 2016,
//    BJSM), and a clearly-bad subjective day caps an optimistic objective score.
//  - ACWR is de-weighted and scored on Garmin's documented 0.8–1.3 "sweet spot"
//    (≥1.5 danger); the ratio is statistically contested (Impellizzeri 2020,
//    Lolli 2017), so it informs rather than dominates.
//  - HRV is scored, when a personal history exists, on the sports-science
//    standard: ln(RMSSD) against a rolling baseline with a smallest-worthwhile-
//    change band of ±0.5·SD (Plews/Buchheit). A reading inside the band is "no
//    meaningful change"; below it is penalised in proportion to how many SWC down.
//    Falls back to Garmin's own 7-day-avg-vs-balanced-band, then the status label.
//  - Sleep regularity (consistency of sleep timing night to night) is a secondary
//    input: irregular sleep blunts recovery independently of duration/score.
//  - Stress is down-weighted because Garmin stress is itself HRV-derived.
//  - Resting-HR penalty triggers at +5 bpm over baseline (sustained-overreaching
//    threshold), not +3 (within day-to-day noise).
//
// Garmin publishes no numeric band cut-offs (only Poor/Low/Moderate/High/Prime)
// and no factor weights, so the weights and bands below are our calibration of
// Garmin's stated primary/secondary structure plus the evidence review.
// ============================================================================

export type RecoveryLevel = "prime" | "high" | "moderate" | "low" | "poor" | "unknown";

/** Map a 0–100 readiness score to one of Garmin's five labels. */
export function recoveryLevelFromScore(score: number): Exclude<RecoveryLevel, "unknown"> {
  return score >= 75
    ? "prime"
    : score >= 55
      ? "high"
      : score >= 40
        ? "moderate"
        : score >= 25
          ? "low"
          : "poor";
}

export interface ReadinessSignals {
  sleepScore?: number | null; // 0–100, last night (PRIMARY)
  acwr?: number | null; // acute:chronic workload ratio — recovery/load proxy (PRIMARY)
  // HRV — preferred path: ln(RMSSD) vs a personal rolling baseline + SWC band.
  hrvLnRmssd?: number | null; // ln of last night's RMSSD (ms)
  hrvLnRmssdMean?: number | null; // rolling mean of ln(RMSSD) over the baseline window
  hrvLnRmssdSd?: number | null; // SD of ln(RMSSD) over that window (SWC = 0.5·SD)
  // HRV — fallback path: Garmin's own 7-day avg vs the balanced band, then status.
  hrvWeeklyAvg?: number | null; // 7-day overnight HRV avg (SECONDARY)
  hrvBaselineLow?: number | null; // personal "balanced" band lower bound
  hrvBaselineUpper?: number | null; // personal "balanced" band upper bound
  hrvStatus?: string | null; // fallback when the numeric baseline is absent
  avgStress?: number | null; // 0–100 all-day stress, rest ≤25 (SECONDARY)
  sleepHistoryScore?: number | null; // rolling avg of recent sleep scores (SECONDARY)
  sleepRegularityMinutes?: number | null; // SD of recent midsleep time-of-day, in minutes (SECONDARY)
  energy?: number | null; // subjective 1–5 (SECONDARY — self-report)
  soreness?: number | null; // subjective 1–5 (1 = none, 5 = severe)
  mood?: number | null; // subjective 1–5
  restingHr?: number | null;
  restingHrBaseline?: number | null; // rolling mean of recent resting HR
}

export interface ReadinessFactor {
  name: string;
  score: number; // 0–100 contribution (or a negative penalty for RHR)
  weight: number;
  detail: string;
}

export interface DerivedReadiness {
  score: number; // 0–100
  level: Exclude<RecoveryLevel, "unknown">;
  factors: ReadinessFactor[];
  cappedBySubjective?: boolean; // true if a bad subjective day capped an optimistic score
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

const HRV_STATUS_SCORE: Record<string, number> = {
  balanced: 80,
  unbalanced: 50,
  low: 38,
  poor: 25,
};

/**
 * ACWR → recovery/load readiness component, anchored on Garmin's documented
 * Load Ratio "sweet spot" of 0.8–1.3 (≥1.5 danger zone). Inside the sweet spot
 * scores high; genuine spikes above it are penalised; a very low ratio is
 * well-recovered but undertrained, so it scores good-not-prime (not "100").
 */
export function recoveryFromAcwr(acwr: number): number {
  if (acwr < 0.8) return clamp(70 + (acwr - 0.5) * 67); // 0.5→70 … 0.8→90 (recovered but undertrained)
  if (acwr <= 1.3) return 90; // sweet spot
  return clamp(90 - (acwr - 1.3) * 55); // 1.5→79, 1.8→62, 2.0→52 (load spike)
}

/**
 * HRV component. Preferred: ln(RMSSD) against a personal rolling baseline, judged
 * by a smallest-worthwhile-change band of ±0.5·SD (the half-SD heuristic from
 * Plews/Buchheit). Inside the band → no meaningful change (~80); below it →
 * penalised ~18 points per SWC; above → a mild bonus (capped). Falls back to the
 * Garmin 7-day-avg-vs-balanced-band, then to the raw status label.
 */
function hrvComponent(s: ReadinessSignals): { score: number; detail: string } | null {
  if (
    s.hrvLnRmssd != null &&
    s.hrvLnRmssdMean != null &&
    s.hrvLnRmssdSd != null &&
    s.hrvLnRmssdSd > 0
  ) {
    const swc = 0.5 * s.hrvLnRmssdSd;
    const dev = (s.hrvLnRmssd - s.hrvLnRmssdMean) / swc; // deviation in SWC units
    const score =
      dev >= 0
        ? clamp(80 + Math.min(dev, 2) * 6) // +1 SWC → 86, ≥+2 → 92 (cap)
        : clamp(80 + dev * 18); // −1 → 62, −2 → 44, −3 → 26
    const tag = dev <= -1 ? "suppressed" : dev >= 1 ? "elevated" : "normal";
    return {
      score,
      detail: `HRV lnRMSSD ${s.hrvLnRmssd.toFixed(2)} vs ${s.hrvLnRmssdMean.toFixed(2)}±${swc.toFixed(2)} SWC (${tag})`,
    };
  }
  if (s.hrvWeeklyAvg != null && s.hrvBaselineLow != null && s.hrvBaselineUpper != null) {
    const span = Math.max(1, s.hrvBaselineUpper - s.hrvBaselineLow);
    // Flat-ish inside the personal "balanced" band (Garmin's SWC-style range);
    // penalise below the floor, reward above the ceiling.
    const score =
      s.hrvWeeklyAvg >= s.hrvBaselineLow
        ? clamp(75 + ((s.hrvWeeklyAvg - s.hrvBaselineLow) / span) * 13)
        : clamp(75 - ((s.hrvBaselineLow - s.hrvWeeklyAvg) / span) * 50);
    return {
      score,
      detail: `HRV 7d ${Math.round(s.hrvWeeklyAvg)} vs ${s.hrvBaselineLow}–${s.hrvBaselineUpper}`,
    };
  }
  const hrv = s.hrvStatus?.toLowerCase();
  if (hrv) return { score: HRV_STATUS_SCORE[hrv] ?? 55, detail: `HRV ${hrv}` };
  return null;
}

/**
 * Sleep-regularity component (0–100) from the night-to-night consistency of sleep
 * timing — the SD of recent midsleep time-of-day, in minutes. Tight timing
 * (≤30 min SD) scores ~100; it falls off to ~30 by a very irregular ±120 min SD.
 */
function sleepRegularityComponent(s: ReadinessSignals): { score: number; detail: string } | null {
  if (s.sleepRegularityMinutes == null) return null;
  const sd = Math.max(0, s.sleepRegularityMinutes);
  const score = clamp(100 - (Math.max(0, sd - 30) / 90) * 70);
  return { score, detail: `sleep timing ±${Math.round(sd)} min` };
}

/** Subjective wellness component (0–100) from any logged energy/soreness/mood. */
function subjectiveComponent(s: ReadinessSignals): { score: number; detail: string } | null {
  const parts: number[] = [];
  const labels: string[] = [];
  if (s.energy != null) {
    parts.push((s.energy / 5) * 100);
    labels.push(`energy ${s.energy}`);
  }
  if (s.soreness != null) {
    parts.push(((6 - s.soreness) / 5) * 100); // 1 (none) → 100, 5 (severe) → 20
    labels.push(`soreness ${s.soreness}`);
  }
  if (s.mood != null) {
    parts.push((s.mood / 5) * 100);
    labels.push(`mood ${s.mood}`);
  }
  if (parts.length === 0) return null;
  return {
    score: clamp(parts.reduce((a, b) => a + b, 0) / parts.length),
    detail: labels.join(", "),
  };
}

/**
 * Reconstruct a 0–100 Training Readiness from available signals. Returns null
 * when no usable signal is present (so the caller falls back to "unknown").
 */
export function computeReadiness(s: ReadinessSignals): DerivedReadiness | null {
  const factors: ReadinessFactor[] = [];

  if (s.sleepScore != null)
    factors.push({
      name: "sleep",
      score: clamp(s.sleepScore),
      weight: 2.0,
      detail: `sleep score ${Math.round(s.sleepScore)}`,
    });
  if (s.acwr != null)
    factors.push({
      name: "recovery",
      score: recoveryFromAcwr(s.acwr),
      weight: 1.2,
      detail: `ACWR ${s.acwr.toFixed(2)}`,
    });
  const subj = subjectiveComponent(s);
  if (subj)
    factors.push({ name: "subjective", score: subj.score, weight: 1.5, detail: subj.detail });
  const hrv = hrvComponent(s);
  if (hrv) factors.push({ name: "hrv", score: hrv.score, weight: 1.2, detail: hrv.detail });
  if (s.sleepHistoryScore != null)
    factors.push({
      name: "sleep history",
      score: clamp(s.sleepHistoryScore),
      weight: 1.3,
      detail: `recent sleep ~${Math.round(s.sleepHistoryScore)}`,
    });
  const reg = sleepRegularityComponent(s);
  if (reg)
    factors.push({ name: "sleep regularity", score: reg.score, weight: 0.8, detail: reg.detail });
  if (s.avgStress != null)
    factors.push({
      name: "stress",
      score: clamp(100 - s.avgStress),
      weight: 0.5,
      detail: `stress ${Math.round(s.avgStress)}`,
    });

  if (factors.length === 0) return null;

  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  let score = factors.reduce((a, f) => a + f.weight * f.score, 0) / totalWeight;

  // Elevated resting HR vs personal baseline — an independent strain signal.
  // Triggers at +5 bpm (the sustained-overreaching threshold), not noise.
  if (s.restingHr != null && s.restingHrBaseline != null) {
    const delta = s.restingHr - s.restingHrBaseline;
    if (delta >= 5) {
      const penalty = Math.min(20, (delta - 4) * 3);
      score = Math.max(0, score - penalty);
      factors.push({
        name: "resting HR",
        score: -penalty,
        weight: 0,
        detail: `resting HR ${Math.round(s.restingHr)} vs ~${Math.round(s.restingHrBaseline)} (−${Math.round(penalty)})`,
      });
    }
  }

  // A clearly-bad subjective day overrides an optimistic objective score:
  // self-report often catches fatigue the sensors miss (Saw et al. 2016).
  let cappedBySubjective = false;
  if (
    ((s.energy != null && s.energy <= 2) || (s.soreness != null && s.soreness >= 4)) &&
    score > 54
  ) {
    score = 54; // cap at the top of "moderate"
    cappedBySubjective = true;
  }

  score = Math.round(score);
  return { score, level: recoveryLevelFromScore(score), factors, cappedBySubjective };
}

// ============================================================================
// Signed factor contributions + coverage (for the web app's readiness UI)
//
// `computeReadiness` returns the raw 0–100 component scores and their weights,
// which is what the CLI prints. The web UI instead wants, per input, how much
// it pushed the day above or below a *typical* day — a signed deviation. We
// model "typical" as a component score of 70 (a normal, unremarkable day) and
// express each contribution as the weighted deviation from that anchor, scaled
// so a strong single factor lands in roughly the ±17 range. These do NOT sum
// to the score — they're a relative "what's driving today" breakdown.
//
// We collapse Garmin's three sleep-flavoured factors (sleep / sleep history /
// sleep regularity) into one "Sleep" contribution and map the remaining factor
// names to the five athlete-facing inputs: Sleep, HRV, Training load, Stress,
// Subjective.
// ============================================================================

export type ReadinessInput = "sleep" | "hrv" | "load" | "stress" | "subjective";

export interface ReadinessContribution {
  key: ReadinessInput;
  label: string;
  points: number; // signed deviation-vs-typical-day (~ ±17 range)
}

export interface ReadinessContributions {
  contributions: ReadinessContribution[];
  coverage: Record<ReadinessInput, boolean>;
}

const INPUT_LABEL: Record<ReadinessInput, string> = {
  sleep: "Sleep",
  hrv: "HRV",
  load: "Training load",
  stress: "Stress",
  subjective: "Subjective",
};

// Map each computeReadiness factor name to one of the five athlete-facing inputs.
const FACTOR_TO_INPUT: Record<string, ReadinessInput> = {
  sleep: "sleep",
  "sleep history": "sleep",
  "sleep regularity": "sleep",
  hrv: "hrv",
  recovery: "load",
  stress: "stress",
  subjective: "subjective",
};

const TYPICAL_COMPONENT = 70; // a normal, unremarkable day's component score
const CONTRIBUTION_SCALE = 0.6; // tunes weighted deviation into the ~±17 range

/**
 * Signed factor contributions (deviation vs a typical day) and per-input
 * coverage, derived from the same signals `computeReadiness` consumes.
 *
 * `points` is the weighted distance of each input's component score from a
 * typical day (anchored at 70), so positive = boosting today's readiness,
 * negative = dragging it down. The five sleep-flavoured factors collapse into
 * one "Sleep" contribution (weighted-average deviation). The RHR penalty is
 * folded into HRV/load context and does not get its own contribution.
 *
 * Coverage reports whether each of the five inputs had any non-null signal for
 * the day (independent of whether it produced a scored factor).
 */
export function readinessContributions(s: ReadinessSignals): ReadinessContributions {
  const coverage: Record<ReadinessInput, boolean> = {
    sleep: s.sleepScore != null || s.sleepHistoryScore != null || s.sleepRegularityMinutes != null,
    hrv:
      s.hrvLnRmssd != null || s.hrvWeeklyAvg != null || (s.hrvStatus != null && s.hrvStatus !== ""),
    load: s.acwr != null,
    stress: s.avgStress != null,
    subjective: s.energy != null || s.soreness != null || s.mood != null,
  };

  const derived = computeReadiness(s);
  if (!derived) {
    return { contributions: [], coverage };
  }

  // Accumulate weighted deviation-from-typical per input (weighted by factor weight).
  const acc: Record<ReadinessInput, { weighted: number; weight: number }> = {
    sleep: { weighted: 0, weight: 0 },
    hrv: { weighted: 0, weight: 0 },
    load: { weighted: 0, weight: 0 },
    stress: { weighted: 0, weight: 0 },
    subjective: { weighted: 0, weight: 0 },
  };

  for (const f of derived.factors) {
    const input = FACTOR_TO_INPUT[f.name];
    if (!input) continue; // skip the RHR penalty (weight 0, no input)
    if (f.weight <= 0) continue;
    acc[input].weighted += f.weight * (f.score - TYPICAL_COMPONENT);
    acc[input].weight += f.weight;
  }

  const contributions: ReadinessContribution[] = [];
  for (const key of Object.keys(acc) as ReadinessInput[]) {
    const a = acc[key];
    if (a.weight === 0) continue;
    const points = Math.round((a.weighted / a.weight) * CONTRIBUTION_SCALE);
    contributions.push({ key, label: INPUT_LABEL[key], points });
  }

  // Largest absolute impact first — the UI leads with what's driving today.
  contributions.sort((x, y) => Math.abs(y.points) - Math.abs(x.points));
  return { contributions, coverage };
}
