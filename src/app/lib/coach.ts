// View-only derivations: band color, verdict text, formatting, sport icons.
import type { IconName } from "../components/Icon";
import type { PlannedSession } from "../../shared/api-types";

/** One-line summary of a planned session, e.g. "45 min · 8 km · Z2". */
export function sessionDetail(s: PlannedSession): string {
  const bits: string[] = [];
  if (s.durationMinutes) bits.push(`${s.durationMinutes} min`);
  if (s.distanceMeters)
    bits.push(`${(s.distanceMeters / 1000).toFixed(s.distanceMeters % 1000 === 0 ? 0 : 1)} km`);
  if (s.primaryZone) bits.push(s.primaryZone);
  else if (s.type) bits.push(s.type);
  return bits.join(" · ") || s.description || "Planned session";
}

export interface Band {
  key: "go" | "modify" | "back" | "none";
  label: string;
  color: string;
}

// Band thresholds: >=67 go, 40-66 modify, <40 back.
export function band(value: number | null | undefined): Band {
  if (value == null) return { key: "none", label: "No data", color: "var(--text-3)" };
  if (value >= 67) return { key: "go", label: "Go", color: "var(--go)" };
  if (value >= 40) return { key: "modify", label: "Modify", color: "var(--modify)" };
  return { key: "back", label: "Back off", color: "var(--back)" };
}

export interface Verdict {
  head: string;
  sub: string;
}

export function verdict(value: number | null | undefined): Verdict {
  if (value == null)
    return { head: "Not enough data", sub: "No recovery signals synced for today yet." };
  if (value >= 80)
    return { head: "Train as planned", sub: "You're primed. Green light for the hard session." };
  if (value >= 67)
    return { head: "Train as planned", sub: "Recovered and ready. Hit the plan as written." };
  if (value >= 53)
    return {
      head: "Modify — keep it aerobic",
      sub: "Some fatigue lingering. Hold intensity, keep it easy.",
    };
  if (value >= 40)
    return {
      head: "Modify — ease off",
      sub: "Recovery's incomplete. Trim volume or drop the intervals.",
    };
  if (value >= 25)
    return { head: "Back off today", sub: "Your body's asking for recovery. Easy or rest." };
  return { head: "Rest", sub: "Deep fatigue. Prioritize sleep and an easy day off." };
}

const SPORT_ICON: Record<string, IconName> = {
  run: "run",
  running: "run",
  ride: "bike",
  cycling: "bike",
  bike: "bike",
  swim: "swim",
  swimming: "swim",
  hike: "hike",
  hiking: "hike",
  walk: "hike",
};
export function sportIcon(sport: string | null | undefined): IconName {
  if (!sport) return "activity" as IconName;
  return SPORT_ICON[sport.toLowerCase()] ?? ("run" as IconName);
}

// normalize a free-text sport into one of run / ride / swim / hike for grouping + chip color
export function normSport(sport: string | null | undefined): string {
  if (!sport) return "run";
  const s = sport.toLowerCase();
  if (s.includes("ride") || s.includes("cycl") || s.includes("bike")) return "ride";
  if (s.includes("swim")) return "swim";
  if (s.includes("hik") || s.includes("walk")) return "hike";
  return "run";
}

// ---------- date helpers ----------
export const todayISO = (): string => isoOf(new Date());

export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// parse an ISO date as a local date (no TZ shift)
export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function fmtDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
): string {
  return parseISO(iso).toLocaleDateString("en-US", opts);
}

export function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// seconds → "Hh Mm" / "Mm"
export function fmtDurSec(seconds: number): string {
  return fmtDur(seconds / 60);
}

export const DAY_MIN = "2021-01-01";
