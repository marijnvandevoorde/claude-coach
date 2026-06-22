// ============================================================================
// Goal anchor — the lightweight "is this plan still pointed at the race?" read.
//
// Surfaced on every plan read so a plan never silently drifts off its goal. It
// answers: how many weeks to the race, which plan week we're in, does the plan
// still reach the goal — and the two failure modes the consult flagged:
//   - ORPHANED: the plan's goalId resolves to no goal (goal deleted).
//   - STALE:    the goal was edited AFTER the plan was built (date/profile moved),
//               so the plan's taper/ramp may no longer line up — re-periodize.
// Never throws on a missing/edited goal. Richer on/behind/ahead-vs-ACTUALS lives
// in planActual/planDrift; this is the cheap structural anchor. Pure, no DB.
// ============================================================================
import { efd } from "./loadModel.js";

export type AnchorStatus = "on-track" | "behind" | "ahead" | "orphaned" | "stale" | "no-plan";

/** Minimal plan shape the anchor needs (a stored TrainingPlan satisfies it). */
export interface AnchorPlan {
  meta?: { goalId?: string; updatedAt?: string; eventDate?: string; totalWeeks?: number };
  weeks?: Array<{
    weekNumber?: number;
    startDate?: string;
    endDate?: string;
    phase?: string;
    longRunEFD?: number;
    envelope?: { longRunEFD?: number };
  }>;
}

/** Minimal goal shape (a stored Goal satisfies it). */
export interface AnchorGoal {
  event_date?: string | null;
  distance_km?: number | null;
  elevation_gain_m?: number | null;
  updated_at?: string | null;
}

export interface GoalAnchor {
  status: AnchorStatus;
  weeksToGoal: number | null;
  currentWeek: number | null; // plan week index containing asOf
  totalWeeks: number | null;
  raceEFD: number | null;
  peakLongRunEFD: number | null;
  peakPctOfRace: number | null; // peak long run as a share of race EFD
  detail: string;
}

function todayISO(asOf?: string): string {
  if (asOf) return asOf;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffWeeks(from: string, to: string): number | null {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.ceil(ms / (7 * 86_400_000)) : null;
}

/**
 * Compute the goal anchor for a (possibly null) plan + (possibly null) goal.
 * `asOf` defaults to today.
 */
export function computeGoalAnchor(
  plan: AnchorPlan | null,
  goal: AnchorGoal | null,
  asOf?: string
): GoalAnchor {
  const today = todayISO(asOf);
  const base: GoalAnchor = {
    status: "no-plan",
    weeksToGoal: null,
    currentWeek: null,
    totalWeeks: null,
    raceEFD: null,
    peakLongRunEFD: null,
    peakPctOfRace: null,
    detail: "",
  };

  if (!plan) {
    return { ...base, status: "no-plan", detail: "No active plan." };
  }

  const weeksToGoal = goal?.event_date ? diffWeeks(today, goal.event_date) : null;
  const totalWeeks = plan.meta?.totalWeeks ?? plan.weeks?.length ?? null;

  // Which plan week are we in?
  let currentWeek: number | null = null;
  for (const w of plan.weeks ?? []) {
    if (w.startDate && w.endDate && today >= w.startDate && today <= w.endDate) {
      currentWeek = w.weekNumber ?? null;
      break;
    }
  }

  // Orphaned: the plan claims a goal that no longer resolves.
  if (!goal) {
    return {
      ...base,
      status: "orphaned",
      weeksToGoal,
      currentWeek,
      totalWeeks,
      detail: plan.meta?.goalId
        ? `Plan is bound to goal "${plan.meta.goalId}" which no longer exists — re-link or re-generate.`
        : "Plan has no goal set — set an A-race and re-generate so the schedule is anchored.",
    };
  }

  // Stale: goal edited after the plan was built.
  if (goal.updated_at && plan.meta?.updatedAt && goal.updated_at > plan.meta.updatedAt) {
    return {
      ...base,
      status: "stale",
      weeksToGoal,
      currentWeek,
      totalWeeks,
      detail:
        "The goal changed after this plan was built — re-periodize so the ramp and taper line up with the new race.",
    };
  }

  const raceEFD =
    goal.distance_km != null
      ? efd(Number(goal.distance_km), Number(goal.elevation_gain_m ?? 0))
      : null;
  const longRuns = (plan.weeks ?? [])
    .filter((w) => (w.phase ?? "") !== "Taper")
    .map((w) => Number(w.longRunEFD ?? w.envelope?.longRunEFD ?? 0));
  const peakLongRunEFD = longRuns.length ? Math.max(...longRuns) : null;
  const peakPctOfRace =
    raceEFD && peakLongRunEFD ? Math.round((peakLongRunEFD / raceEFD) * 100) / 100 : null;

  let status: AnchorStatus = "on-track";
  let detail = `${weeksToGoal ?? "?"} weeks to race${currentWeek ? `, in plan week ${currentWeek}/${totalWeeks ?? "?"}` : ""}.`;
  const lastWeekEnd = (plan.weeks ?? []).reduce<string>(
    (m, w) => (w.endDate && w.endDate > m ? w.endDate : m),
    ""
  );
  if (goal.event_date && lastWeekEnd && lastWeekEnd < goal.event_date) {
    status = "behind";
    detail = `Plan ends ${lastWeekEnd}, before the race ${goal.event_date} — extend it to race week.`;
  } else if (peakPctOfRace != null && peakPctOfRace < 0.65) {
    status = "behind";
    detail = `Peak long run only ${Math.round(peakPctOfRace * 100)}% of race EFD — under-built; add base or weeks.`;
  } else if (peakPctOfRace != null && peakPctOfRace > 0.85) {
    status = "ahead";
    detail = `Peak long run ${Math.round(peakPctOfRace * 100)}% of race EFD — ahead of the 70–80% anchor; ensure recovery holds.`;
  }

  return {
    status,
    weeksToGoal,
    currentWeek,
    totalWeeks,
    raceEFD,
    peakLongRunEFD,
    peakPctOfRace,
    detail,
  };
}
