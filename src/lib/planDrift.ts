// ============================================================================
// Plan drift — the "eyes" of the adaptive loop. Decides whether the athlete is
// drifting TOO TIRED (overreaching) or TOO EASY (under-stimulated) from the
// reconcile pattern + the readiness trend + actual-vs-planned load. planActual
// reconciles and sessionAdherence judges; THIS decides whether to act, and
// planActual/T12 carries out a re-periodize.
//
// Discipline (expert-coach + adaptive.md): require a PATTERN, never one reading.
// Asymmetric autonomy — eager to PROTECT (too-tired fires on softer evidence),
// conservative to PUSH (too-easy needs clear, sustained over-performance). One
// reading dials TODAY (adaptive.md); drift restructures the PLAN. Always
// propose-then-confirm; this module only produces the verdict + suggestion.
// Pure, cited (two-day rule, ACWR 0.8–1.3 sweet spot / ≥1.5 danger). No DB.
// ============================================================================

export interface DriftSignals {
  // Adherence pattern over the window (from reconcile + any athlete reclassifications).
  cutShort?: number; // sessions materially short
  legitEasy?: number; // quality done easy / labeled fatigue
  overCooked?: number; // sessions done harder/longer than prescribed
  onTarget?: number;
  missed?: number;
  // Readiness / recovery trend.
  readinessLowDays?: number; // days readiness < 50 in the last ~7
  readinessAvg?: number | null; // mean readiness over the window
  rhrElevatedDays?: number; // days resting HR ≥ +5 bpm over baseline
  hrvSuppressedDays?: number; // days HRV suppressed vs baseline
  acwr?: number | null; // acute:chronic workload ratio
  // Load vs the plan's envelope.
  actualVsEnvelope?: number | null; // recent actual EFD ÷ planned EFD (1 = on plan)
}

export type DriftStatus = "on-track" | "too-tired" | "too-easy" | "mixed";
export type DriftSuggestion = "hold" | "insert-recovery" | "flatten" | "ramp-up";

export interface DriftVerdict {
  status: DriftStatus;
  suggestion: DriftSuggestion;
  confidence: "high" | "low";
  tiredScore: number;
  easyScore: number;
  evidence: string[];
}

const n = (x: number | null | undefined): number =>
  typeof x === "number" && Number.isFinite(x) ? x : 0;

/**
 * Detect drift from the window's signals. Returns the verdict + a propose-only
 * suggestion; the caller asks the athlete before any structural change.
 */
export function detectDrift(s: DriftSignals): DriftVerdict {
  const tired: string[] = [];
  const easy: string[] = [];
  let tiredScore = 0;
  let easyScore = 0;

  // ---- Too-tired evidence (protective — fires on softer, corroborated signals) ----
  if (n(s.readinessLowDays) >= 2) {
    tiredScore += 2;
    tired.push(`readiness <50 on ${n(s.readinessLowDays)} days (two-day rule)`);
  }
  if (n(s.rhrElevatedDays) >= 2) {
    tiredScore += 1;
    tired.push(`resting HR +5 bpm on ${n(s.rhrElevatedDays)} days`);
  }
  if (n(s.hrvSuppressedDays) >= 2) {
    tiredScore += 1;
    tired.push(`HRV suppressed on ${n(s.hrvSuppressedDays)} days`);
  }
  if (s.acwr != null && s.acwr >= 1.5) {
    tiredScore += 2;
    tired.push(`ACWR ${s.acwr.toFixed(2)} in the danger zone (≥1.5)`);
  }
  if (n(s.cutShort) + n(s.legitEasy) >= 2) {
    tiredScore += 1;
    tired.push(`${n(s.cutShort) + n(s.legitEasy)} sessions cut short or done easy on fatigue`);
  }

  // ---- Too-easy evidence (opportunity — needs clear, sustained over-performance) ----
  if (n(s.overCooked) >= 2) {
    easyScore += 1;
    easy.push(`${n(s.overCooked)} sessions beat the prescription`);
  }
  if (s.readinessAvg != null && s.readinessAvg >= 70) {
    easyScore += 1;
    easy.push(`readiness averaging ${Math.round(s.readinessAvg)} (prime)`);
  }
  if (s.acwr != null && s.acwr < 0.85) {
    easyScore += 1;
    easy.push(`ACWR ${s.acwr.toFixed(2)} below the sweet spot (under-loaded)`);
  }
  if (s.actualVsEnvelope != null && s.actualVsEnvelope >= 1.1) {
    easyScore += 1;
    easy.push(
      `doing ~${Math.round((s.actualVsEnvelope - 1) * 100)}% more than planned with margin`
    );
  }
  // A consistently-easy block with NO fatigue signals at all is itself a mild cue.
  if (
    tiredScore === 0 &&
    n(s.onTarget) >= 3 &&
    (s.actualVsEnvelope == null || s.actualVsEnvelope >= 0.95)
  ) {
    easyScore += 0; // not enough alone — kept as context, no score
  }

  // ---- Verdict ----------------------------------------------------------------
  let status: DriftStatus;
  let suggestion: DriftSuggestion;
  const evidence: string[] = [];

  if (tiredScore >= 2 && easyScore >= 2) {
    status = "mixed";
    suggestion = "hold";
    evidence.push(
      "Conflicting signals — hold the plan and look closer before changing anything.",
      ...tired,
      ...easy
    );
  } else if (tiredScore >= 2) {
    status = "too-tired";
    suggestion = s.acwr != null && s.acwr >= 1.5 ? "flatten" : "insert-recovery";
    evidence.push(...tired);
  } else if (easyScore >= 3) {
    // conservative threshold to PUSH — needs a clear pattern, not one good week
    status = "too-easy";
    suggestion = "ramp-up";
    evidence.push(...easy);
  } else {
    status = "on-track";
    suggestion = "hold";
    evidence.push(
      tiredScore > 0
        ? "Mild fatigue cues but below the action threshold — monitor."
        : "Adherence, readiness and load all within range."
    );
  }

  // Confidence: high when several independent signals agree.
  const drivers = status === "too-tired" ? tired.length : status === "too-easy" ? easy.length : 0;
  const confidence: "high" | "low" = drivers >= 2 ? "high" : "low";

  return { status, suggestion, confidence, tiredScore, easyScore, evidence };
}
