// ============================================================================
// Trail load primitives — Equivalent Flat Distance (EFD) + ramp/tier rules.
//
// The volume currency for trail/ultra training. Code owns these numbers; the
// periodizer and the plan-vs-actual reconcile both compute load through here so
// "how much work" means one thing everywhere. Pure + cited; no DB, no I/O —
// mirrors the src/lib/recovery.ts ethos.
//
// Cited heuristics (see skill/reference/trail.md + load-management.md):
//  - EFD = distance_km + (D+_m / 100) × k, default k = 1.0. k is a TECHNICAL /
//    musculoskeletal surcharge (≈1.1–1.2 for very technical terrain), NOT a
//    "steep vert costs more" factor — per vertical metre, steep climbing is
//    actually cheaper. EFD counts ascent only; descent damage is managed apart.
//  - Two axes ramp separately, each ≤10–15%/wk (≤5–8% on D+ for
//    beginners/returning/masters). Recovery weeks deload both ~30–40%.
//  - D+ tiers (m/week): flat <300 / moderate 300–800 / hilly 800–1500 /
//    mountain 1500–3000 / alpine >3000.
// ============================================================================

/** Athlete foundation, drives the ramp cap (periodization.md "10% rule" table). */
export type Foundation = "beginner" | "returning" | "intermediate" | "advanced";

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Equivalent Flat Distance (km). `dPlusM` is the session/week vertical gain in
 * metres; `k` the optional technical surcharge (leave at 1.0 unless the terrain
 * is genuinely technical). Negative/invalid inputs are floored to 0.
 */
export function efd(distanceKm: number, dPlusM = 0, k = 1.0): number {
  const dist = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const vert = Number.isFinite(dPlusM) ? Math.max(0, dPlusM) : 0;
  return round1(dist + (vert / 100) * k);
}

/** EFD from raw metres (e.g. a stored activity's distance + elevation gain). */
export function efdFromMeters(distanceM: number, dPlusM = 0, k = 1.0): number {
  return efd((Number(distanceM) || 0) / 1000, dPlusM, k);
}

export type DPlusTier = "flat" | "moderate" | "hilly" | "mountain" | "alpine";

/** Classify a weekly vertical load into the trail.md D+ tiers. */
export function dPlusTier(dPlusPerWeek: number): DPlusTier {
  const d = Number(dPlusPerWeek) || 0;
  if (d < 300) return "flat";
  if (d < 800) return "moderate";
  if (d < 1500) return "hilly";
  if (d < 3000) return "mountain";
  return "alpine";
}

/** Per-week ramp cap (fraction) for each axis, by foundation. The D+ axis ramps
 *  more conservatively than the aerobic (EFD) axis — vert loads connective tissue
 *  the cardiovascular system is already ahead of. */
export function rampCap(foundation: Foundation): { efd: number; dPlus: number } {
  switch (foundation) {
    case "beginner":
      return { efd: 0.08, dPlus: 0.05 };
    case "returning":
      return { efd: 0.12, dPlus: 0.08 };
    case "advanced":
      return { efd: 0.15, dPlus: 0.12 };
    case "intermediate":
    default:
      return { efd: 0.1, dPlus: 0.1 };
  }
}

/** The biggest single-week step each axis may take from `prev`, given foundation.
 *  A floor lets a very low starting base step a little in absolute terms. */
export function maxWeeklyStep(
  prev: { efd: number; dPlus: number },
  foundation: Foundation
): { efd: number; dPlus: number } {
  const cap = rampCap(foundation);
  return {
    efd: round1(Math.max(3, prev.efd * cap.efd)),
    dPlus: Math.round(Math.max(50, prev.dPlus * cap.dPlus)),
  };
}

/**
 * Whether a week-to-week jump exceeds the safe ramp (used by planAudit and the
 * periodizer's self-check). `tolerance` (default 1.25) allows the deliberate
 * post-deload rebound — a recovery week is intentionally low, so the week after
 * rebuilds past it and that isn't a true ramp.
 */
export function isRampSafe(
  prev: { efd: number; dPlus: number },
  next: { efd: number; dPlus: number },
  foundation: Foundation,
  tolerance = 1.25
): boolean {
  const step = maxWeeklyStep(prev, foundation);
  return (
    next.efd - prev.efd <= step.efd * tolerance && next.dPlus - prev.dPlus <= step.dPlus * tolerance
  );
}
