/**
 * Plan-shaping helpers for the web app's /api — pure of HTTP/transport so they
 * can be unit-tested directly (coach-app.ts binds a port on import). Each reads
 * the active plan through the shared plans.ts readers and annotates whether a
 * session has been pushed to Garmin (push_key = `${date}|${name}`).
 */
import { getActivePlan, sessionsForDate, upcomingWorkouts } from "../db/plans.js";
import { pushedWorkoutsForPlan } from "../db/garminPush.js";
import { localDate } from "../db/wellness.js";
import type { PlannedSession, DashboardPlan } from "../shared/api-types.js";

export type { DashboardPlan };

/** Set of `${date}|${name}` keys for a plan's workouts already pushed to Garmin. */
async function syncedKeySet(planId: string): Promise<Set<string>> {
  return new Set(
    (await pushedWorkoutsForPlan(planId)).map((p) => `${p.date ?? ""}|${p.name ?? ""}`)
  );
}

/** The active plan's sessions for the dashboard — today's plus the next upcoming —
 *  each flagged whether it's been pushed to Garmin. */
export async function planForDate(date: string): Promise<DashboardPlan> {
  const plan = await getActivePlan();
  if (!plan) return { hasActivePlan: false, today: [], next: null };
  const synced = await syncedKeySet(plan.meta.id);
  const mark = (s: PlannedSession): PlannedSession => ({
    ...s,
    syncedToGarmin: synced.has(`${s.date}|${s.name}`),
  });
  const today = sessionsForDate(plan, date).map(mark);
  const next = upcomingWorkouts(plan, date, 60).find((s) => s.date > date) ?? null;
  return { hasActivePlan: true, today, next: next ? mark(next) : null };
}

/** Upcoming planned sessions over the next `days` days (active plan), each flagged
 *  whether it's been pushed to Garmin. Powers the Activity screen's Upcoming list. */
export async function upcomingForApp(
  days: number
): Promise<{ hasActivePlan: boolean; sessions: PlannedSession[] }> {
  const plan = await getActivePlan();
  if (!plan) return { hasActivePlan: false, sessions: [] };
  const from = localDate();
  const cutoff = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const synced = await syncedKeySet(plan.meta.id);
  const sessions = upcomingWorkouts(plan, from, 200)
    .filter((s) => s.date <= cutoff)
    .map((s) => ({ ...s, syncedToGarmin: synced.has(`${s.date}|${s.name}`) }));
  return { hasActivePlan: true, sessions };
}

/** Every planned session in the active plan (any date), synced-flagged — for the
 *  calendar's planned-day markers. */
export async function allPlanSessions(): Promise<{
  hasActivePlan: boolean;
  sessions: PlannedSession[];
}> {
  const plan = await getActivePlan();
  if (!plan) return { hasActivePlan: false, sessions: [] };
  const synced = await syncedKeySet(plan.meta.id);
  const sessions = upcomingWorkouts(plan, "0000-01-01", 1000).map((s) => ({
    ...s,
    syncedToGarmin: synced.has(`${s.date}|${s.name}`),
  }));
  return { hasActivePlan: true, sessions };
}
