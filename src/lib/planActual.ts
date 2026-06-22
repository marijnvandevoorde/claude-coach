// ============================================================================
// Plan-vs-actual reconcile — match each prescribed session to what the athlete
// actually did, and judge adherence with the HR-lag-aware rules in
// sessionAdherence.ts. The "hands" of the adaptive loop: planDrift.ts reads its
// output to decide whether to suggest a change.
//
// Matching reuses the plan's stable per-day-workout keys (keyedPlanWorkouts in
// src/db/plans.ts) so a match round-trips to the app's "✓ on watch" join. Pure:
// the CLI loads keyed prescriptions + actual activities (localized dates) and
// passes them in. Emits per-session verdicts, the prescriptions with no actual
// (missed), the activities with no prescription (unplanned), and the OUTLIER
// QUESTIONS the agent should ask the athlete.
// ============================================================================
import { judgeSession, type PrescribedSession, type AdherenceVerdict } from "./sessionAdherence.js";
import { sportFamily } from "./fitness.js";

export interface PrescribedItem extends PrescribedSession {
  key: string; // stable workoutKey
  date: string; // local YYYY-MM-DD
  name?: string;
}

export interface ActualActivity {
  id: number;
  date: string; // local YYYY-MM-DD
  sport: string;
  movingMin: number;
  distanceKm: number;
  dPlusM: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
}

export interface ReconcileMatch {
  key: string;
  date: string;
  name?: string;
  activityId: number;
  verdict: AdherenceVerdict;
}

export interface ReconcileResult {
  from: string;
  to: string;
  matched: ReconcileMatch[];
  missed: Array<{ key: string; date: string; name?: string; sport: string }>;
  unplanned: Array<{ activityId: number; date: string; sport: string; distanceKm: number }>;
  questions: Array<{ key: string; date: string; activityId?: number; question: string }>;
  summary: {
    prescribed: number;
    matched: number;
    onTarget: number;
    outliers: number;
    missed: number;
    unplanned: number;
  };
}

/** Magnitude of an activity (for greedy nearest matching when a day has several). */
const magnitude = (a: ActualActivity): number => a.movingMin || a.distanceKm * 6;
const presMagnitude = (p: PrescribedItem): number =>
  p.durationMinutes ?? (p.distanceMeters ? p.distanceMeters / 1000 / 0.16 : 0);

/**
 * Reconcile prescriptions against actuals within [from, to]. Greedy nearest-by-
 * magnitude match within each date + sport family; HR-lag-aware verdict per match.
 */
export function reconcile(
  prescribed: PrescribedItem[],
  actuals: ActualActivity[],
  opts: { from: string; to: string }
): ReconcileResult {
  const inRange = (d: string) => d >= opts.from && d <= opts.to;
  const pres = prescribed.filter((p) => inRange(p.date));
  const acts = actuals.filter((a) => inRange(a.date));

  const usedActivity = new Set<number>();
  const matched: ReconcileMatch[] = [];
  const missed: ReconcileResult["missed"] = [];

  // Match within each date, biggest prescription first (so a long run grabs the
  // long activity before an easy shakeout does).
  const byDate = new Map<string, PrescribedItem[]>();
  for (const p of pres) (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)!).push(p);

  for (const [date, items] of byDate) {
    items.sort((a, b) => presMagnitude(b) - presMagnitude(a));
    const sameDay = acts.filter((a) => a.date === date && !usedActivity.has(a.id));
    for (const p of items) {
      const fam = sportFamily(p.sport);
      const candidates = sameDay
        .filter((a) => !usedActivity.has(a.id) && sportFamily(a.sport) === fam)
        .sort(
          (a, b) =>
            Math.abs(magnitude(a) - presMagnitude(p)) - Math.abs(magnitude(b) - presMagnitude(p))
        );
      const actual = candidates[0];
      if (actual) {
        usedActivity.add(actual.id);
        matched.push({
          key: p.key,
          date: p.date,
          name: p.name,
          activityId: actual.id,
          verdict: judgeSession(p, {
            sport: actual.sport,
            movingMin: actual.movingMin,
            distanceKm: actual.distanceKm,
            dPlusM: actual.dPlusM,
            avgHr: actual.avgHr,
            maxHr: actual.maxHr,
            avgWatts: actual.avgWatts,
          }),
        });
      } else {
        missed.push({ key: p.key, date: p.date, name: p.name, sport: fam });
      }
    }
  }

  const unplanned = acts
    .filter((a) => !usedActivity.has(a.id))
    .map((a) => ({
      activityId: a.id,
      date: a.date,
      sport: sportFamily(a.sport),
      distanceKm: round1(a.distanceKm),
    }));

  const questions: ReconcileResult["questions"] = [];
  for (const m of matched) {
    if (m.verdict.questionToAsk)
      questions.push({
        key: m.key,
        date: m.date,
        activityId: m.activityId,
        question: m.verdict.questionToAsk,
      });
  }
  for (const m of missed) {
    questions.push({
      key: m.key,
      date: m.date,
      question: `No activity logged for "${m.name ?? m.key}" (${m.date}) — did you skip it, move it, or train untracked?`,
    });
  }

  const onTarget = matched.filter(
    (m) => m.verdict.class === "on-target" && !m.verdict.isOutlier
  ).length;
  const outliers = matched.filter((m) => m.verdict.isOutlier).length;

  return {
    from: opts.from,
    to: opts.to,
    matched,
    missed,
    unplanned,
    questions,
    summary: {
      prescribed: pres.length,
      matched: matched.length,
      onTarget,
      outliers,
      missed: missed.length,
      unplanned: unplanned.length,
    },
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
