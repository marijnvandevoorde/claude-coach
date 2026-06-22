// ============================================================================
// Plan audit — the coaching-soundness airlock at the save gate.
//
// validatePlan (src/db/plans.ts) checks a plan is STRUCTURALLY alive (has an id,
// dated workouts). planAudit checks it's COACHING-sound: the LLM filled the
// periodizer's skeleton without blowing the ramp, dropping the taper, or
// orphaning the goal. Findings are surfaced (heal-or-explain), not silently
// swallowed; `error`-level findings are the ones a strict save should refuse.
// Pure, cited (loadModel ramp caps + 70–80% long-run anchor); no DB.
// ============================================================================
import { efd, isRampSafe, maxWeeklyStep, type Foundation } from "./loadModel.js";

export interface AuditFinding {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface PlanAuditResult {
  ok: boolean; // no error-level findings
  findings: AuditFinding[];
  checked: boolean; // false when the plan carries no envelope to audit (legacy/hand plan)
}

interface AuditWeek {
  weekNumber?: number;
  phase?: string;
  isRecoveryWeek?: boolean;
  targetEFD?: number;
  targetDPlus?: number;
  longRunEFD?: number;
  easyPct?: number;
  envelope?: {
    targetEFD?: number;
    targetDPlus?: number;
    longRunEFD?: number;
    easyPct?: number;
  };
}

export interface AuditPlan {
  meta?: { goalId?: string; totalWeeks?: number };
  weeks?: AuditWeek[];
}

export interface AuditGoal {
  distance_km?: number | null;
  elevation_gain_m?: number | null;
}

const wEFD = (w: AuditWeek): number | undefined => w.targetEFD ?? w.envelope?.targetEFD;
const wDPlus = (w: AuditWeek): number | undefined => w.targetDPlus ?? w.envelope?.targetDPlus;
const wLong = (w: AuditWeek): number | undefined => w.longRunEFD ?? w.envelope?.longRunEFD;
const wEasy = (w: AuditWeek): number | undefined => w.easyPct ?? w.envelope?.easyPct;

/**
 * Audit a plan for coaching soundness. `opts.goal` enables the orphan-goal +
 * long-run-anchor checks; `opts.foundation` sets the ramp cap (default
 * intermediate). Tolerant: a plan with no EFD envelope is reported `checked:false`
 * with no findings rather than failed.
 */
export function auditPlan(
  plan: AuditPlan,
  opts: { goal?: AuditGoal | null; foundation?: Foundation } = {}
): PlanAuditResult {
  const findings: AuditFinding[] = [];
  const foundation = opts.foundation ?? "intermediate";
  const weeks = plan.weeks ?? [];

  // Orphan goal — the plan claims a goal that didn't resolve.
  if (plan.meta?.goalId && opts.goal === null) {
    findings.push({
      level: "error",
      code: "orphan-goal",
      message: `Plan is bound to goal "${plan.meta.goalId}" but it doesn't resolve — re-link or re-generate.`,
    });
  }

  const hasEnvelope = weeks.some((w) => wEFD(w) != null);
  if (!hasEnvelope) {
    return { ok: findings.every((f) => f.level !== "error"), findings, checked: false };
  }

  // 1. Ramp safety across consecutive build weeks (skip deloads + taper + their rebounds).
  for (let i = 1; i < weeks.length; i++) {
    const a = weeks[i - 1];
    const b = weeks[i];
    if (a.isRecoveryWeek || b.isRecoveryWeek) continue;
    if ((b.phase ?? "") === "Taper") continue;
    const ae = wEFD(a),
      ad = wDPlus(a),
      be = wEFD(b),
      bd = wDPlus(b);
    if (ae == null || be == null) continue;
    const prev = { efd: ae, dPlus: ad ?? 0 };
    const next = { efd: be, dPlus: bd ?? 0 };
    const step = maxWeeklyStep(prev, foundation);
    const spikeEFD = next.efd - prev.efd > step.efd * 1.5;
    const spikeDPlus = next.dPlus - prev.dPlus > step.dPlus * 1.5;
    if (spikeEFD || spikeDPlus) {
      findings.push({
        level: "error",
        code: "ramp-spike",
        message: `Week ${b.weekNumber}: ${spikeEFD ? `EFD jumps ${prev.efd}→${next.efd}` : `D+ jumps ${prev.dPlus}→${next.dPlus}`} — well past the ${foundation} ramp cap. Injury risk.`,
      });
    } else if (!isRampSafe(prev, next, foundation)) {
      findings.push({
        level: "warning",
        code: "ramp-steep",
        message: `Week ${b.weekNumber}: load steps a bit fast for ${foundation} — ease it or insert recovery.`,
      });
    }
  }

  // 2. Taper present — volume must come down into the race.
  const nonRace = weeks.filter((w) => wEFD(w) != null);
  const peakEFD = Math.max(...nonRace.map((w) => wEFD(w)!));
  const hasTaperPhase = weeks.some((w) => (w.phase ?? "") === "Taper");
  const lastBuild = [...weeks]
    .reverse()
    .find((w) => (w.phase ?? "") !== "Taper" && !w.isRecoveryWeek);
  const finalWeeks = weeks.slice(-2);
  const tapered = finalWeeks.some((w) => (wEFD(w) ?? peakEFD) < peakEFD * 0.75);
  if (!hasTaperPhase && !tapered && weeks.length >= 6) {
    findings.push({
      level: "warning",
      code: "no-taper",
      message: "No taper detected — cut volume ~40–60% over the final ~2 weeks (keep intensity).",
    });
  }
  void lastBuild;

  // 3. Deload cadence — a long build with no recovery week is a red flag.
  const buildWeeks = weeks.filter((w) => (w.phase ?? "") !== "Taper");
  const deloads = buildWeeks.filter((w) => w.isRecoveryWeek).length;
  if (buildWeeks.length >= 6 && deloads === 0) {
    findings.push({
      level: "warning",
      code: "no-deload",
      message:
        "No recovery/deload weeks across a long build — add a deload every 3rd–4th week (3:1).",
    });
  }

  // 4. Long-run anchor vs race EFD (needs the goal).
  if (opts.goal && opts.goal.distance_km != null) {
    const raceEFD = efd(Number(opts.goal.distance_km), Number(opts.goal.elevation_gain_m ?? 0));
    const longs = weeks.filter((w) => (w.phase ?? "") !== "Taper").map((w) => wLong(w) ?? 0);
    const peakLong = longs.length ? Math.max(...longs) : 0;
    const pct = raceEFD > 0 ? peakLong / raceEFD : 0;
    const isUltra = Number(opts.goal.distance_km) > 55;
    if (!isUltra && pct < 0.65) {
      findings.push({
        level: "warning",
        code: "long-run-short",
        message: `Peak long run ${peakLong} km EFD is only ${Math.round(pct * 100)}% of race EFD (${raceEFD}) — aim for 70–80%.`,
      });
    } else if (pct > 0.9) {
      findings.push({
        level: "warning",
        code: "long-run-long",
        message: `Peak long run ${peakLong} km EFD is ${Math.round(pct * 100)}% of race EFD — likely too much; 70–80% is the target.`,
      });
    }
  }

  // 5. Intensity discipline — build weeks should stay mostly easy.
  for (const w of buildWeeks) {
    const easy = wEasy(w);
    if (easy != null && easy < 0.75 && !w.isRecoveryWeek) {
      findings.push({
        level: "warning",
        code: "too-much-quality",
        message: `Week ${w.weekNumber}: only ${Math.round(easy * 100)}% easy — keep ≥80% easy (polarized) to protect recovery.`,
      });
    }
  }

  return { ok: findings.every((f) => f.level !== "error"), findings, checked: true };
}
