// ============================================================================
// Periodizer — emits a dated, ramp-safe trail-training SKELETON.
//
// "Code owns the numbers; the LLM owns the content; a validator is the airlock."
// This module owns the numbers: phases, 3:1 deloads, per-week EFD/D+ envelopes,
// the long-run anchored to 70–80% race EFD, and a terrain-preserving taper —
// all built backward from race day and forward from the athlete's measured
// fitness, on their available days. The LLM then fills each day's workout to hit
// the week's envelope; planAudit (T8) checks it didn't blow the ramp.
//
// Cited methodology (skill/reference/periodization.md + trail.md):
//  - Four trail phases: Aerobic Base → Build-Vert → Mountain/Specificity →
//    Terrain-Preserving Taper. Vert (D+) is progressed as its own axis.
//  - 3:1 loading (3 build weeks, 1 recovery deload ~35–40% on both axes).
//  - Each axis ramps ≤10–15%/wk (less for beginners/returning) — see loadModel.
//  - Peak long run = 70–80% of race EFD (time-on-feet for ultras > ~50 km).
//  - Taper ~2 wk: cut volume 40–60% progressively, KEEP intensity + a little vert.
// ============================================================================
import { efd, maxWeeklyStep, isRampSafe, type Foundation } from "./loadModel.js";
import type { FitnessSnapshot } from "./fitness.js";

// Day tokens in week order, owned here so the periodizer stays DB-free (the
// db/availability module's DayToken is the same literal union, so values from
// getAvailability() pass straight in).
export const DAY_TOKENS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayToken = (typeof DAY_TOKENS)[number];

/** Structural availability the periodizer consumes (matches db/availability's view). */
export interface Availability {
  days: DayToken[];
  weeklyHours: number | null;
  longDay: DayToken | null;
}

export interface PeriodizerGoal {
  id?: string;
  name?: string;
  eventDate: string; // 'YYYY-MM-DD'
  distanceKm: number;
  dPlusM: number;
  eventType?: string;
}

export interface PeriodizerInput {
  goal: PeriodizerGoal;
  fitness: FitnessSnapshot;
  availability: Availability;
  asOf?: string; // default = fitness.asOf
  foundation?: Foundation; // default = fitness.foundation
}

export type SlotRole = "long" | "quality" | "easy" | "rest" | "b2b";

export interface DaySlot {
  day: DayToken;
  role: SlotRole;
  note?: string;
}

export interface SkeletonWeek {
  weekNumber: number;
  startDate: string;
  endDate: string;
  phase: string;
  focus: string;
  isRecoveryWeek: boolean;
  targetEFD: number;
  targetDPlus: number;
  longRunEFD: number;
  efdLow: number;
  efdHigh: number;
  dPlusLow: number;
  dPlusHigh: number;
  easyPct: number;
  qualityPct: number;
  targetHours: number;
  slots: DaySlot[];
  keySessions: string[];
}

export interface SkeletonPhase {
  name: string;
  startWeek: number;
  endWeek: number;
  focus: string;
}

export interface PlanSkeleton {
  meta: {
    goalId?: string;
    event: string;
    eventDate: string;
    planStartDate: string;
    planEndDate: string;
    totalWeeks: number;
    raceEFD: number;
    foundation: Foundation;
    asOf: string;
    generatedBy: string;
  };
  availability: { days: DayToken[]; weeklyHours: number | null; longDay: DayToken | null };
  fitnessSummary: {
    recentWeeklyEFD: number;
    recentWeeklyDPlus: number;
    longestRunEFD: number;
    weeksObserved: number;
    trend: string;
  };
  phases: SkeletonPhase[];
  weeks: SkeletonWeek[];
  notes: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weeksBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 86_400_000)
  );
}

const INTENSITY: Record<string, { easy: number; quality: number }> = {
  Base: { easy: 0.85, quality: 0.15 },
  "Build-Vert": { easy: 0.82, quality: 0.18 },
  "Mountain-Specific": { easy: 0.8, quality: 0.2 },
  Taper: { easy: 0.85, quality: 0.15 },
};

const KEY_SESSIONS: Record<string, string[]> = {
  Base: [
    "Hilly Z2 long run",
    "Strides 6–8×20s",
    "Trail strength ×2",
    "Easy downhill primer (wk 2–3)",
  ],
  "Build-Vert": ["Uphill intervals (e.g. 5–6×3–4′)", "Downhill repeats 4–5×2′", "B2B weekend long"],
  "Mountain-Specific": [
    "Race-terrain long w/ technical descents",
    "Stacked-climb long; power-hike drills",
    "Peak B2B (Sat long / Sun 50–70%)",
    "Full race-fuel rehearsal",
  ],
  Taper: ["Keep short vert + a few downhill strides", "Sharpen at race pace", "Openers race week"],
};

/** Pick the long-run day: the athlete's stated long day if it's available,
 *  else the latest weekend day they train, else their last available day. */
function pickLongDay(days: DayToken[], longDay: DayToken | null): DayToken | null {
  if (!days.length) return null;
  if (longDay && days.includes(longDay)) return longDay;
  if (days.includes("sun")) return "sun";
  if (days.includes("sat")) return "sat";
  return days[days.length - 1];
}

const dayIndex = (d: DayToken): number => DAY_TOKENS.indexOf(d);

/**
 * Assign each available day a role for a given phase. Long run on the long day;
 * a B2B second-long the day after (Build/Mountain, if available); `qualityCount`
 * quality days spread away from the long run; the rest easy; off-days rest.
 */
function buildSlots(
  days: DayToken[],
  longDay: DayToken | null,
  phase: string,
  isRecovery: boolean,
  qualityCount: number
): DaySlot[] {
  const slots: DaySlot[] = [];
  const available = new Set(days);
  const ld = longDay;
  const b2bDay =
    ld && (phase === "Build-Vert" || phase === "Mountain-Specific") && !isRecovery
      ? (DAY_TOKENS[(dayIndex(ld) + 1) % 7] as DayToken)
      : null;

  // Candidate quality days: available, not the long day, not the B2B day, not adjacent to the long run.
  const adjacent = ld
    ? new Set([DAY_TOKENS[(dayIndex(ld) + 6) % 7], DAY_TOKENS[(dayIndex(ld) + 1) % 7]])
    : new Set();
  const qualityDays = days
    .filter((d) => d !== ld && d !== b2bDay && !adjacent.has(d))
    .slice(0, isRecovery ? 0 : qualityCount);
  const qualitySet = new Set(qualityDays);

  for (const d of DAY_TOKENS) {
    if (!available.has(d)) {
      slots.push({ day: d, role: "rest" });
      continue;
    }
    if (d === ld)
      slots.push({
        day: d,
        role: "long",
        note: isRecovery ? "Reduced long run" : "Weekly long run",
      });
    else if (d === b2bDay)
      slots.push({
        day: d,
        role: "b2b",
        note: "B2B 2nd long — 50–70% of the long run on tired legs",
      });
    else if (qualitySet.has(d))
      slots.push({
        day: d,
        role: "quality",
        note: isRecovery ? "Light quality" : "Quality session (uphill/threshold/downhill)",
      });
    else slots.push({ day: d, role: "easy", note: "Easy Z2 (+ strength 1–2×/wk)" });
  }
  return slots;
}

/**
 * Build the skeleton. Throws only when the race is already past (no weeks to plan).
 */
export function periodize(input: PeriodizerInput): PlanSkeleton {
  const { goal, fitness, availability } = input;
  const asOf = input.asOf ?? fitness.asOf;
  const foundation = input.foundation ?? fitness.foundation;
  const notes: string[] = [];

  const planStart = weekStartOf(asOf);
  const raceWeek = weekStartOf(goal.eventDate);
  const totalWeeks = weeksBetween(planStart, raceWeek) + 1;
  if (totalWeeks < 1) {
    throw new Error(`race date ${goal.eventDate} is in the past relative to ${asOf}`);
  }

  const raceEFD = efd(goal.distanceKm, goal.dPlusM);
  const isUltra = goal.distanceKm > 55;
  // Peak long run = 70–80% race EFD; ultras anchor lower (time-on-feet, not %).
  const peakLongRun = round1(raceEFD * (isUltra ? 0.6 : 0.78));
  if (isUltra)
    notes.push(
      "Ultra distance: peak long run capped below 70% race EFD — anchor the longest sessions by TIME ON FEET, not EFD %."
    );

  // Starting points from measured fitness, with sane floors so a thin history
  // still yields a buildable (conservative) plan.
  const startLong = Math.max(round1(fitness.longestRunEFD || 0), 8);
  const startEFD = Math.max(round1(fitness.recentWeeklyEFD || 0), round1(startLong / 0.45), 15);
  const startDPlus = Math.max(Math.round(fitness.recentWeeklyDPlus || 0), 200);
  const peakWeeklyEFD = round1(peakLongRun / 0.5); // long run ≈ half the peak week
  const peakDPlus = Math.max(Math.round(goal.dPlusM * 0.9), Math.round(startDPlus * 1.5));
  if ((fitness.weeksObserved ?? 0) < 4)
    notes.push(
      "Thin training history (<4 complete weeks) — started conservative; revise after 2–3 logged weeks."
    );

  // ---- Phase layout ----------------------------------------------------------
  const taperWeeks = totalWeeks >= 8 ? 2 : totalWeeks >= 4 ? 1 : Math.min(totalWeeks, 1);
  const buildWeeks = Math.max(0, totalWeeks - taperWeeks);
  // Split the build block Base ~45% / Build-Vert ~33% / Mountain-Specific ~22%.
  const baseW = Math.round(buildWeeks * 0.45);
  const buildVertW = Math.round(buildWeeks * 0.33);
  const mountainW = Math.max(0, buildWeeks - baseW - buildVertW);

  function buildPhaseFor(buildIdx: number): string {
    if (buildIdx < baseW) return "Base";
    if (buildIdx < baseW + buildVertW) return "Build-Vert";
    return "Mountain-Specific";
  }

  // Recovery (deload) weeks: every 3rd build week (3:1), but never the final build
  // week before the taper (a hard pre-taper week amplifies the taper response).
  const recoveryBuildIdx = new Set<number>();
  for (let i = 3; i < buildWeeks; i += 4) {
    if (i === buildWeeks - 1) continue;
    recoveryBuildIdx.add(i);
  }

  const weeks: SkeletonWeek[] = [];
  const longDay = pickLongDay(availability.days, availability.longDay);
  const weeklyHours = availability.weeklyHours ?? null;

  // Ramp baselines: last NON-deload values (post-deload rebuild isn't a "ramp").
  let prevPeakEFD = startEFD;
  let prevPeakDPlus = startDPlus;
  let prevLong = startLong;

  // ---- Build block -----------------------------------------------------------
  for (let i = 0; i < buildWeeks; i++) {
    const phase = buildPhaseFor(i);
    const isRecovery = recoveryBuildIdx.has(i);
    let targetEFD: number, targetDPlus: number, longRunEFD: number;

    if (i === 0) {
      targetEFD = startEFD;
      targetDPlus = startDPlus;
      longRunEFD = Math.min(startLong, peakLongRun);
    } else if (isRecovery) {
      targetEFD = round1(prevPeakEFD * 0.62);
      targetDPlus = Math.round(prevPeakDPlus * 0.6);
      longRunEFD = round1(prevLong * 0.6);
    } else {
      const step = maxWeeklyStep({ efd: prevPeakEFD, dPlus: prevPeakDPlus }, foundation);
      targetEFD = Math.min(round1(prevPeakEFD + step.efd), peakWeeklyEFD);
      targetDPlus = Math.min(prevPeakDPlus + step.dPlus, peakDPlus);
      longRunEFD = Math.min(round1(prevLong * 1.12), peakLongRun, round1(targetEFD * 0.55));
    }
    if (!isRecovery && i > 0) {
      prevPeakEFD = targetEFD;
      prevPeakDPlus = targetDPlus;
      prevLong = longRunEFD;
    }

    weeks.push(
      makeWeek({
        weekNumber: i + 1,
        startDate: addDays(planStart, i * 7),
        phase,
        isRecovery,
        targetEFD,
        targetDPlus,
        longRunEFD,
        weeklyHours,
        peakWeeklyEFD,
        days: availability.days,
        longDay,
      })
    );
  }

  // ---- Taper -----------------------------------------------------------------
  // Progressive volume cut off the final build peak; keep intensity + some vert.
  const taperFractions = taperWeeks >= 2 ? [0.6, 0.4] : [0.5];
  for (let t = 0; t < taperWeeks; t++) {
    const weekNumber = buildWeeks + t + 1;
    const isRaceWeek = weekNumber === totalWeeks;
    const frac = taperFractions[Math.min(t, taperFractions.length - 1)];
    const targetEFD = isRaceWeek ? raceEFD : round1(prevPeakEFD * frac);
    const targetDPlus = isRaceWeek ? goal.dPlusM : Math.round(prevPeakDPlus * (frac * 0.7 + 0.15));
    const longRunEFD = isRaceWeek ? raceEFD : round1(Math.min(prevLong * 0.55, targetEFD * 0.6));
    weeks.push(
      makeWeek({
        weekNumber,
        startDate: addDays(planStart, (weekNumber - 1) * 7),
        phase: "Taper",
        isRecovery: false,
        isRaceWeek,
        targetEFD,
        targetDPlus,
        longRunEFD,
        weeklyHours,
        peakWeeklyEFD,
        days: availability.days,
        longDay,
      })
    );
  }

  // ---- Target hours: scale each week off the plan's ACHIEVED peak build EFD,
  // so the biggest week sits near the athlete's weekly-hours budget (the
  // theoretical peak may be unreachable in the available weeks/fitness). --------
  if (weeklyHours != null) {
    const refEFD =
      Math.max(
        0,
        ...weeks.filter((w) => !w.isRecoveryWeek && w.phase !== "Taper").map((w) => w.targetEFD)
      ) || Math.max(0, ...weeks.map((w) => w.targetEFD));
    for (const w of weeks) {
      const isRaceWeek = w.weekNumber === totalWeeks;
      const ratio = refEFD > 0 ? w.targetEFD / refEFD : 1;
      w.targetHours = isRaceWeek
        ? round1(weeklyHours * 0.3)
        : round1(Math.max(weeklyHours * 0.4, Math.min(weeklyHours * 1.05, weeklyHours * ratio)));
    }
  }

  // ---- Self-check: flag any ramp the construction shouldn't have produced -----
  const achievedPeakLong = Math.max(
    0,
    ...weeks.filter((w) => w.phase !== "Taper").map((w) => w.longRunEFD)
  );
  if (achievedPeakLong < raceEFD * 0.6 && !isUltra) {
    notes.push(
      `Peak long run reaches only ${achievedPeakLong} km EFD (~${Math.round((achievedPeakLong / raceEFD) * 100)}% of the ${raceEFD} km race) — below the 70–80% target. The athlete needs more base or more weeks; build current fitness up before relying on this peak.`
    );
  }
  for (let i = 1; i < weeks.length; i++) {
    const a = weeks[i - 1];
    const b = weeks[i];
    if (b.isRecoveryWeek || a.isRecoveryWeek || b.phase === "Taper") continue;
    if (
      !isRampSafe(
        { efd: a.targetEFD, dPlus: a.targetDPlus },
        { efd: b.targetEFD, dPlus: b.targetDPlus },
        foundation
      )
    ) {
      notes.push(`Week ${b.weekNumber} EFD/D+ steps beyond the ${foundation} ramp cap — review.`);
    }
  }
  if (peakLongRun < raceEFD * 0.7 && !isUltra)
    notes.push(
      "Peak long run is below 70% race EFD for the available weeks — consider a longer build."
    );

  const phases = summarizePhases(weeks);

  return {
    meta: {
      goalId: goal.id,
      event: goal.name ?? "Goal race",
      eventDate: goal.eventDate,
      planStartDate: planStart,
      planEndDate: addDays(planStart, totalWeeks * 7 - 1),
      totalWeeks,
      raceEFD,
      foundation,
      asOf,
      generatedBy: "Claude Coach periodizer",
    },
    availability: { days: availability.days, weeklyHours, longDay },
    fitnessSummary: {
      recentWeeklyEFD: fitness.recentWeeklyEFD,
      recentWeeklyDPlus: fitness.recentWeeklyDPlus,
      longestRunEFD: fitness.longestRunEFD,
      weeksObserved: fitness.weeksObserved,
      trend: fitness.efdTrend,
    },
    phases,
    weeks,
    notes,
  };
}

function makeWeek(p: {
  weekNumber: number;
  startDate: string;
  phase: string;
  isRecovery: boolean;
  isRaceWeek?: boolean;
  targetEFD: number;
  targetDPlus: number;
  longRunEFD: number;
  weeklyHours: number | null;
  peakWeeklyEFD: number;
  days: DayToken[];
  longDay: DayToken | null;
}): SkeletonWeek {
  const intensity = INTENSITY[p.phase] ?? INTENSITY.Base;
  const qualityCount = p.phase === "Base" ? 1 : p.phase === "Taper" ? 1 : 2;
  const slots = buildSlots(p.days, p.longDay, p.phase, p.isRecovery, qualityCount);

  // Target hours scale with the week's EFD relative to the peak, around the
  // athlete's weekly-hours budget; recovery/taper pull down.
  let targetHours = 0;
  if (p.weeklyHours != null) {
    const ratio = p.peakWeeklyEFD > 0 ? p.targetEFD / p.peakWeeklyEFD : 1;
    targetHours = round1(
      Math.max(p.weeklyHours * 0.35, Math.min(p.weeklyHours * 1.1, p.weeklyHours * ratio))
    );
    if (p.isRaceWeek) targetHours = round1(p.weeklyHours * 0.3);
  }

  const focus = p.isRaceWeek
    ? "Race week — openers, fuel, rest"
    : p.isRecovery
      ? "Recovery / deload — both axes down ~40%"
      : phaseFocus(p.phase);

  return {
    weekNumber: p.weekNumber,
    startDate: p.startDate,
    endDate: addDays(p.startDate, 6),
    phase: p.phase,
    focus,
    isRecoveryWeek: p.isRecovery,
    targetEFD: p.targetEFD,
    targetDPlus: p.targetDPlus,
    longRunEFD: p.longRunEFD,
    efdLow: round1(p.targetEFD * 0.92),
    efdHigh: round1(p.targetEFD * 1.08),
    dPlusLow: Math.round(p.targetDPlus * 0.85),
    dPlusHigh: Math.round(p.targetDPlus * 1.15),
    easyPct: intensity.easy,
    qualityPct: intensity.quality,
    targetHours,
    slots,
    keySessions: p.isRaceWeek
      ? ["Race day — execute pacing + fuel plan"]
      : (KEY_SESSIONS[p.phase] ?? []),
  };
}

function phaseFocus(phase: string): string {
  switch (phase) {
    case "Base":
      return "Aerobic base — build EFD volume, hills as easy terrain";
    case "Build-Vert":
      return "Ramp vert separately; uphill intervals + first downhill repeats";
    case "Mountain-Specific":
      return "Race-specific climbs, technical descents, B2B long runs";
    case "Taper":
      return "Cut volume, keep intensity + a little vert (terrain-preserving)";
    default:
      return phase;
  }
}

function summarizePhases(weeks: SkeletonWeek[]): SkeletonPhase[] {
  const out: SkeletonPhase[] = [];
  for (const w of weeks) {
    const last = out[out.length - 1];
    if (last && last.name === w.phase) last.endWeek = w.weekNumber;
    else
      out.push({
        name: w.phase,
        startWeek: w.weekNumber,
        endWeek: w.weekNumber,
        focus: phaseFocus(w.phase),
      });
  }
  return out;
}
