// ============================================================================
// From-scratch Training Readiness
//
// Garmin's Training Readiness isn't exposed on every device (the API returns an
// empty list). When it's missing we reconstruct it from the SAME primary sensor
// signals Garmin documents — sleep score + recovery/load (ACWR) as the two
// "primary drivers", then HRV-vs-baseline, stress, and sleep history as
// "secondary influences" — weighted accordingly.
//
// Crucially we use the *primary* signals directly and do NOT feed in Body
// Battery or Training Status: those are themselves composites of HRV/sleep/
// stress, so including them would double-count. They're surfaced as context
// elsewhere, not as inputs here.
//
// Garmin publishes no numeric band cut-offs (only the labels Poor/Low/Moderate/
// High/Prime) and no factor weights, so the weights and bands below are our own
// calibration of Garmin's stated primary/secondary structure.
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
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

const HRV_STATUS_SCORE: Record<string, number> = {
  balanced: 80,
  unbalanced: 50,
  low: 38,
  poor: 25,
};

/**
 * ACWR → recovery/load readiness component. Higher recent load relative to
 * chronic (high ACWR) means more residual recovery demand, so a lower score;
 * a well-rested low ratio scores high. Mirrors how Garmin's Recovery Time —
 * the metric we can't fetch — is itself adjusted by the 7d/28d load ratio.
 */
export function recoveryFromAcwr(acwr: number): number {
  return clamp(115 - acwr * 38);
}

/** HRV component from the 7-day average relative to the personal balanced band. */
function hrvComponent(s: ReadinessSignals): { score: number; detail: string } | null {
  if (s.hrvWeeklyAvg != null && s.hrvBaselineLow != null && s.hrvBaselineUpper != null) {
    const mid = (s.hrvBaselineLow + s.hrvBaselineUpper) / 2;
    const score = clamp(80 + (s.hrvWeeklyAvg / mid - 1) * 180);
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
      weight: 2.0,
      detail: `ACWR ${s.acwr.toFixed(2)}`,
    });
  const hrv = hrvComponent(s);
  if (hrv) factors.push({ name: "hrv", score: hrv.score, weight: 1.2, detail: hrv.detail });
  if (s.avgStress != null)
    factors.push({
      name: "stress",
      score: clamp(100 - s.avgStress),
      weight: 1.0,
      detail: `stress ${Math.round(s.avgStress)}`,
    });
  if (s.sleepHistoryScore != null)
    factors.push({
      name: "sleep history",
      score: clamp(s.sleepHistoryScore),
      weight: 1.0,
      detail: `recent sleep ~${Math.round(s.sleepHistoryScore)}`,
    });

  if (factors.length === 0) return null;

  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  let score = factors.reduce((a, f) => a + f.weight * f.score, 0) / totalWeight;

  // Elevated resting HR vs personal baseline — an independent physiological
  // strain signal applied as a small penalty (only when a baseline exists).
  if (s.restingHr != null && s.restingHrBaseline != null) {
    const delta = s.restingHr - s.restingHrBaseline;
    if (delta >= 3) {
      const penalty = Math.min(20, (delta - 2) * 3);
      score = Math.max(0, score - penalty);
      factors.push({
        name: "resting HR",
        score: -penalty,
        weight: 0,
        detail: `resting HR ${Math.round(s.restingHr)} vs ~${Math.round(s.restingHrBaseline)} (−${Math.round(penalty)})`,
      });
    }
  }

  score = Math.round(score);
  return { score, level: recoveryLevelFromScore(score), factors };
}
