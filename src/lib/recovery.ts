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
//  - HRV is scored against the personal "balanced" baseline band (the SWC-style
//    range Garmin computes), flat inside the band, penalised below it.
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
  hrvWeeklyAvg?: number | null; // 7-day overnight HRV avg (SECONDARY)
  hrvBaselineLow?: number | null; // personal "balanced" band lower bound
  hrvBaselineUpper?: number | null; // personal "balanced" band upper bound
  hrvStatus?: string | null; // fallback when the numeric baseline is absent
  avgStress?: number | null; // 0–100 all-day stress, rest ≤25 (SECONDARY)
  sleepHistoryScore?: number | null; // rolling avg of recent sleep scores (SECONDARY)
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

/** HRV component from the 7-day average relative to the personal balanced band. */
function hrvComponent(s: ReadinessSignals): { score: number; detail: string } | null {
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
