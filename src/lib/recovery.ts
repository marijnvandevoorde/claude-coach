// ============================================================================
// Derived recovery score
//
// Garmin's Training Readiness isn't available on every device. For athletes
// whose watch doesn't surface it (the API returns an empty list), we derive a
// readiness-style 0–100 recovery score from the signals we *do* have — body
// battery, sleep score, HRV status, sleep duration, subjective energy — plus a
// resting-HR-vs-baseline penalty when a baseline exists. Same 0–100 scale and
// thresholds as Garmin readiness, so the check-in treats both identically.
// ============================================================================

export type RecoveryLevel = "prime" | "moderate" | "low" | "poor" | "unknown";

/** Map a 0–100 readiness/recovery score to a level (matches the readiness bands). */
export function recoveryLevelFromScore(score: number): Exclude<RecoveryLevel, "unknown"> {
  return score >= 75 ? "prime" : score >= 50 ? "moderate" : score >= 25 ? "low" : "poor";
}

export interface RecoverySignals {
  bodyBattery?: number | null; // Garmin Body Battery, 0–100
  sleepScore?: number | null; // Garmin sleep score, 0–100
  sleepHours?: number | null;
  hrvStatus?: string | null; // balanced | unbalanced | low | poor
  trainingStatus?: string | null; // Garmin label, e.g. "Strained 5", "Productive 8"
  energy?: number | null; // subjective energy, 1–5
  restingHr?: number | null;
  restingHrBaseline?: number | null; // rolling mean of recent resting HR
}

export interface DerivedRecovery {
  score: number; // 0–100 proxy
  level: Exclude<RecoveryLevel, "unknown">;
  components: string[]; // human-readable signals that fed the score
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

const HRV_SCORE: Record<string, number> = {
  balanced: 85,
  unbalanced: 55,
  low: 35,
  poor: 25,
};

// Garmin Training Status — a multi-day load/fatigue verdict. "Strained" and
// "Unproductive" are direct fatigue/overreaching signals; the rest are neutral
// to good. "No Status" / unknown labels yield null and are skipped.
const TRAINING_STATUS_SCORE: Record<string, number> = {
  peaking: 90,
  productive: 80,
  maintaining: 75,
  recovery: 70,
  detraining: 65,
  unproductive: 40,
  strained: 30,
};

/** Score the leading word of a Garmin training-status label ("Strained 5" -> 30). */
export function trainingStatusScore(status: string): number | null {
  const key = status.toLowerCase().match(/[a-z]+/)?.[0];
  return key ? (TRAINING_STATUS_SCORE[key] ?? null) : null;
}

/**
 * Derive a recovery score from whatever signals are present. Each signal is a
 * weighted 0–100 component; the score is their weighted mean, then nudged down
 * if resting HR is elevated above the athlete's baseline. Returns null when no
 * usable signal is available (so the caller can fall back to "unknown").
 */
export function deriveRecovery(s: RecoverySignals): DerivedRecovery | null {
  const parts: Array<{ weight: number; value: number; label: string }> = [];

  if (s.bodyBattery != null)
    parts.push({
      weight: 1.0,
      value: clamp(s.bodyBattery),
      label: `body battery ${Math.round(s.bodyBattery)}`,
    });
  if (s.sleepScore != null)
    parts.push({
      weight: 0.8,
      value: clamp(s.sleepScore),
      label: `sleep score ${Math.round(s.sleepScore)}`,
    });
  const hrv = s.hrvStatus?.toLowerCase();
  if (hrv) parts.push({ weight: 0.8, value: HRV_SCORE[hrv] ?? 55, label: `HRV ${hrv}` });
  if (s.trainingStatus) {
    const ts = trainingStatusScore(s.trainingStatus);
    if (ts != null)
      parts.push({ weight: 0.9, value: ts, label: `training status ${s.trainingStatus}` });
  }
  if (s.sleepHours != null)
    parts.push({
      weight: 0.4,
      value: clamp((s.sleepHours / 8) * 100),
      label: `${s.sleepHours} h sleep`,
    });
  if (s.energy != null)
    parts.push({ weight: 0.5, value: clamp((s.energy / 5) * 100), label: `energy ${s.energy}/5` });

  if (parts.length === 0) return null;

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  let score = parts.reduce((a, p) => a + p.weight * p.value, 0) / totalWeight;
  const components = parts.map((p) => p.label);

  if (s.restingHr != null && s.restingHrBaseline != null) {
    const delta = s.restingHr - s.restingHrBaseline;
    if (delta >= 3) {
      score = Math.max(0, score - Math.min(25, (delta - 2) * 4));
      components.push(
        `resting HR ${Math.round(s.restingHr)} vs ~${Math.round(s.restingHrBaseline)} baseline`
      );
    }
  }

  score = Math.round(score);
  return { score, level: recoveryLevelFromScore(score), components };
}
