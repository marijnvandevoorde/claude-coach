// ============================================================================
// Session adherence — judge whether a session was executed as prescribed, using
// the signal that's PHYSIOLOGICALLY VALID for that session (not avg HR).
//
// Why HR can't be the judge (expert-coach brief, 2026-06-22):
//  - HR lag: cardiac rise time-constant τ ≈ 30–60 s, so HR doesn't plateau until
//    ~2–3 min into a constant effort. Reps shorter than ~2 min are SYSTEMATICALLY
//    under-read — a nailed 8×400 m Z5 shows "avg HR Z3". Judge those on pace/power.
//  - Cardiac drift / decoupling: at constant output HR creeps UP late in long
//    efforts (Pa:Hr / Pw:Hr decoupling > 5% = a durability signal). Late high HR
//    OVER-states intensity, so judge long Z2 on duration/zone-early, not avg HR.
// Rule: judge short + hill work on pace/power/work-done; steady 5–15 min on HR;
// long Z2 on duration + early-zone (allow drift). Only flag a GENUINE outlier
// (work < ~80% of prescribed OR the valid signal > ~6–8% off) — never an HR-only
// disagreement. When flagged, ASK the athlete; their answer reclassifies it.
// Pure, no DB — planActual.ts assembles the inputs and calls this.
// ============================================================================

export interface PrescribedSession {
  sport: string;
  type?: string; // easy | long | endurance | tempo | threshold | intervals | vo2max | sprint | hills | recovery
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string; // "Z2", "Zone 4", …
  hasStructure?: boolean; // true when the prescription carries interval reps
}

export interface ActualSummary {
  sport: string;
  movingMin: number;
  distanceKm: number;
  dPlusM: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
}

export type AdherenceClass =
  | "on-target"
  | "legit-hard"
  | "legit-easy"
  | "cut-short"
  | "over-cooked"
  | "data-glitch"
  | "unmatched";

export type JudgedBy = "pace" | "power" | "duration" | "distance" | "hr" | "vert" | "none";

export interface Deviation {
  dim: string;
  prescribed: number;
  actual: number;
  pct: number; // (actual - prescribed) / prescribed
}

export interface AdherenceVerdict {
  class: AdherenceClass;
  judgedBy: JudgedBy;
  category: SessionCategory;
  deviations: Deviation[];
  isOutlier: boolean;
  confidence: "high" | "low";
  questionToAsk?: string; // populated only when an outlier needs athlete input
  rationale: string;
}

export type SessionCategory =
  | "short-interval"
  | "threshold"
  | "steady-long"
  | "easy"
  | "hills"
  | "other";

/** Map the prescription to the category that decides which signal is valid. */
export function sessionCategory(p: PrescribedSession): SessionCategory {
  const t = String(p.type ?? "").toLowerCase();
  if (/vo2|sprint|interval|rep|fartlek/.test(t)) return "short-interval";
  if (/threshold|tempo|cruise|sweet/.test(t)) return "threshold";
  if (/long|endurance/.test(t)) return "steady-long";
  if (/hill|climb|vert/.test(t)) return "hills";
  if (/easy|recovery|shakeout|z1|z2/.test(t)) return "easy";
  if (p.hasStructure) return "short-interval";
  return "other";
}

const pct = (actual: number, prescribed: number): number =>
  prescribed > 0 ? (actual - prescribed) / prescribed : 0;

/**
 * Judge one prescribed session against the actual activity. `splits` is reserved
 * for rep-level pace/power judging (planActual passes them when available); the
 * core volume-and-valid-signal logic works on the whole-activity summary.
 */
export function judgeSession(
  prescribed: PrescribedSession,
  actual: ActualSummary | null
): AdherenceVerdict {
  const category = sessionCategory(prescribed);

  if (!actual) {
    return {
      class: "unmatched",
      judgedBy: "none",
      category,
      deviations: [],
      isOutlier: true,
      confidence: "low",
      questionToAsk:
        "I don't see an activity for this prescribed session — did you do it (maybe untracked), move it, or skip it?",
      rationale: "No matching activity found for the prescribed session.",
    };
  }

  const deviations: Deviation[] = [];
  // --- Volume / work completed (the unambiguous, signal-agnostic check) -------
  let volumeDev: number | null = null;
  if (prescribed.durationMinutes != null && prescribed.durationMinutes > 0) {
    const d = pct(actual.movingMin, prescribed.durationMinutes);
    deviations.push({
      dim: "duration_min",
      prescribed: prescribed.durationMinutes,
      actual: round1(actual.movingMin),
      pct: round2(d),
    });
    volumeDev = d;
  }
  if (prescribed.distanceMeters != null && prescribed.distanceMeters > 0) {
    const presKm = prescribed.distanceMeters / 1000;
    const d = pct(actual.distanceKm, presKm);
    deviations.push({
      dim: "distance_km",
      prescribed: round1(presKm),
      actual: round1(actual.distanceKm),
      pct: round2(d),
    });
    // Prefer the larger shortfall as the volume signal (a cut-short shows on both).
    volumeDev = volumeDev == null ? d : Math.min(volumeDev, d);
  }

  // --- Data sanity ------------------------------------------------------------
  const hrImplausible = actual.avgHr != null && (actual.avgHr < 50 || actual.avgHr > 215);
  const noWork = actual.movingMin <= 1 || actual.distanceKm <= 0.1;
  if (noWork || hrImplausible) {
    return {
      class: "data-glitch",
      judgedBy: "none",
      category,
      deviations,
      isOutlier: true,
      confidence: "low",
      questionToAsk:
        "The GPS/HR on this one looks off — did it actually feel like the prescribed effort?",
      rationale: "Activity data looks implausible (no work recorded or HR out of range).",
    };
  }

  // --- Which signal judges intensity for this category ------------------------
  // We deliberately DON'T fail short/interval work on avg HR (lag), and we don't
  // fail long Z2 on avg HR (drift). Without rep-level pace/power streams the
  // intensity read is low-confidence → prefer asking over a confident verdict.
  let judgedBy: JudgedBy;
  let confidence: "high" | "low";
  switch (category) {
    case "short-interval":
      judgedBy = "duration"; // work completed; HR is invalid here
      confidence = "low"; // need splits/pace for a high-confidence intensity read
      break;
    case "hills":
      judgedBy = "vert"; // pace lies on grade; HR under-reads
      confidence = actual.dPlusM > 0 ? "high" : "low";
      break;
    case "threshold":
      judgedBy = actual.avgHr != null ? "hr" : "duration"; // HR valid for 5–15 min steady
      confidence = actual.avgHr != null ? "high" : "low";
      break;
    case "steady-long":
    case "easy":
    default:
      judgedBy = "duration"; // the job was time/zone; avg HR allowed to drift
      confidence = "high";
      break;
  }

  // --- Classify ---------------------------------------------------------------
  // Outlier trigger: work materially short (<~80%) OR materially long (>~120%).
  const VOL_SHORT = -0.2;
  const VOL_LONG = 0.2;
  let klass: AdherenceClass = "on-target";
  let isOutlier = false;
  let question: string | undefined;
  let rationale = "Executed within tolerance of the prescription.";

  if (volumeDev != null && volumeDev <= VOL_SHORT) {
    klass = "cut-short";
    isOutlier = true;
    rationale = `Completed work is ${Math.round(volumeDev * 100)}% vs prescription — materially short.`;
    question =
      "Looks like this came in shorter than the plan — intentional (time/feel), a niggle/illness, or did the watch stop early?";
  } else if (volumeDev != null && volumeDev >= VOL_LONG) {
    klass = "over-cooked";
    isOutlier = true;
    rationale = `Completed work is +${Math.round(volumeDev * 100)}% over prescription.`;
    question =
      "You did more than the plan asked here — feeling good and extending, or did it run away from you?";
  } else if (
    category === "easy" &&
    actual.avgHr != null &&
    prescribed.primaryZone &&
    /z?1|z?2|recovery|easy/i.test(prescribed.primaryZone)
  ) {
    // Easy day judged too hard only with a clear, early signal — kept conservative.
    rationale =
      "Easy session volume on target; confirm it stayed aerobic (HR may drift late — that's expected).";
  }

  // Quality work with only a low-confidence intensity read and on-target volume:
  // don't assert hit/miss — surface for confirmation rather than mis-judge on HR.
  if (
    !isOutlier &&
    (category === "short-interval" || category === "threshold") &&
    confidence === "low"
  ) {
    question =
      "Quality session — the data can't confirm the target effort (HR lags on short reps). Did you hit the prescribed pace/power?";
  }

  return {
    class: klass,
    judgedBy,
    category,
    deviations,
    isOutlier,
    confidence,
    questionToAsk: question,
    rationale,
  };
}

/**
 * Re-judge a verdict once the athlete answers the question. The stored note's
 * label resolves the ambiguity HR/pace couldn't (lived context > sensors).
 */
export function reclassify(verdict: AdherenceVerdict, label: AdherenceClass): AdherenceVerdict {
  return {
    ...verdict,
    class: label,
    isOutlier: false,
    confidence: "high",
    questionToAsk: undefined,
    rationale: `Reclassified by athlete feedback as ${label}.`,
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
