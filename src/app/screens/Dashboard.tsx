import { useState } from "react";
import { Icon } from "../components/Icon";
import {
  ReadinessRing,
  FactorBars,
  MetricTile,
  Sparkline,
  SportChip,
  EmptyState,
  Skeleton,
} from "../components/primitives";
import { NotifyToggle } from "../components/NotifyToggle";
import { band, verdict, fmtDate, normSport, sessionDetail } from "../lib/coach";
import type { DayView, SleepStages as Stages } from "../lib/adapt";
import type { PlannedSession } from "../api";

export function SleepStageBar({ stages }: { stages: Stages }) {
  const total = stages.deep + stages.light + stages.rem + stages.awake || 1;
  const seg = [
    { k: "Deep", v: stages.deep, c: "var(--m-deep)" },
    { k: "REM", v: stages.rem, c: "var(--m-rem)" },
    { k: "Light", v: stages.light, c: "var(--m-light)" },
    { k: "Awake", v: stages.awake, c: "var(--track)" },
  ];
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1.5 }}>
        {seg.map((s) => (
          <div
            key={s.k}
            style={{ width: `${(s.v / total) * 100}%`, background: s.c }}
            title={s.k}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 9, flexWrap: "wrap" }}>
        {seg.map((s) => (
          <span
            key={s.k}
            className="ctx-note"
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: s.c }} />
            {s.k} {Math.floor(s.v / 60)}:{String(s.v % 60).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const joinList = (a: string[]) =>
  a.length <= 1 ? a[0] || "" : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

function FactorCard({ day }: { day: DayView }) {
  const [open, setOpen] = useState(false);
  const fs = day.factors;
  const helped = fs
    .filter((f) => f.v > 1)
    .map((f) => f.label.toLowerCase().replace(" vs baseline", ""));
  const hurt = fs
    .filter((f) => f.v < -1)
    .map((f) => f.label.toLowerCase().replace(" vs baseline", ""));
  const plain = () => {
    const h = helped.length ? `${cap(joinList(helped))} lifted your score` : "";
    const d = hurt.length ? `${joinList(hurt)} held it back` : "";
    if (h && d) return `${h}; ${d}.`;
    return (h || d || "Signals were balanced today") + ".";
  };
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="lbl">What moved it</span>
        <button
          className="est-tag"
          onClick={() => setOpen(!open)}
          style={{ textTransform: "none", letterSpacing: 0 }}
        >
          {open ? "Hide numbers" : "Show numbers"}{" "}
          <Icon name={open ? "chevD" : "chevR"} size={12} />
        </button>
      </div>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 14.5,
          lineHeight: 1.5,
          color: "var(--text)",
          textWrap: "pretty",
        }}
      >
        {plain()}
      </p>
      {open && (
        <div style={{ marginTop: 14 }} className="fade-in">
          <FactorBars factors={fs} />
          <p className="ctx-note" style={{ marginTop: 12, lineHeight: 1.5 }}>
            Points are contributions to the estimate vs. your typical day. They don't sum to the
            score.
          </p>
        </div>
      )}
    </div>
  );
}

function ReadinessInfoPop({ day, onClose }: { day: DayView; onClose: () => void }) {
  const cov = day.coverage || {};
  const items = [
    { k: "sleep", label: "Sleep & stages" },
    { k: "hrv", label: "HRV vs baseline" },
    { k: "load", label: "Training load (ACWR)" },
    { k: "stress", label: "All-day stress" },
    { k: "subjective", label: "Your check-in" },
  ];
  const present = items.filter((i) => cov[i.k]).length;
  return (
    <div className="pop" onClick={onClose}>
      <div className="pop-card fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Readiness is estimated</h3>
          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <p>
          This is a <strong style={{ color: "var(--text)" }}>reconstructed score</strong>, not a
          number from your watch. It blends five recovery signals into a 0–100 estimate of how
          prepared you are to train hard today.
        </p>
        <div className="lbl" style={{ marginTop: 6 }}>
          Data coverage · {present}/5
        </div>
        <div className="coverage">
          {items.map((i) => (
            <div className="crow" key={i.k}>
              <span
                className="cdot"
                style={{ background: cov[i.k] ? "var(--go)" : "var(--track)" }}
              />
              <span style={{ color: cov[i.k] ? "var(--text)" : "var(--text-3)" }}>{i.label}</span>
              <span className="ctx-note" style={{ marginLeft: "auto" }}>
                {cov[i.k] ? "synced" : "missing"}
              </span>
            </div>
          ))}
        </div>
        {present < 5 && (
          <p className="ctx-note" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Fewer inputs = lower confidence. The score widens its uncertainty when signals are
            missing.
          </p>
        )}
      </div>
    </div>
  );
}

export function QuickAdd({
  water,
  goal,
  onWater,
}: {
  water: number;
  goal: number;
  onWater: (amt: number) => void;
}) {
  const pct = Math.min(1, goal > 0 ? water / goal : 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="card qa">
      <div className="row between">
        <span className="lbl">
          <Icon name="drop" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
          Hydration
        </span>
        <span className="ctx-note">tap to log · undoable</span>
      </div>
      <div className="water-ring-row">
        <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
          <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${c * pct} ${c}`}
              style={{ transition: "stroke-dasharray .4s cubic-bezier(.2,.7,.3,1)" }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <Icon name="drop" size={20} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
            <span className="big-num mono" style={{ fontSize: 22 }}>
              {(water / 1000).toFixed(2)}
            </span>
            <span className="unit">/ {(goal / 1000).toFixed(1)} L water</span>
          </div>
          <div className="stepper" style={{ marginTop: 9 }}>
            {[100, 250, 500].map((a) => (
              <button key={a} className="step-btn" onClick={() => onWater(a)}>
                +{a}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One planned-session row in the dashboard plan card. */
function PlanSessionRow({ s }: { s: PlannedSession }) {
  return (
    <div className="plan-item">
      <SportChip sport={normSport(s.sport)} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>{s.name}</div>
        <div className="ctx-note" style={{ marginTop: 2 }}>
          {sessionDetail(s)}
        </div>
      </div>
      {s.syncedToGarmin && (
        <span className="chip" style={{ color: "var(--go)", whiteSpace: "nowrap" }}>
          <Icon name="check" size={12} style={{ verticalAlign: -1, marginRight: 3 }} />
          on watch
        </span>
      )}
    </div>
  );
}

export function DashboardLoading({ theme }: { theme: string }) {
  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <Skeleton h={11} w={120} />
          <div style={{ height: 8 }} />
          <Skeleton h={26} w={90} />
        </div>
      </div>
      <div className="page" style={{ paddingTop: 0 }}>
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: 26,
          }}
        >
          <div className="skel" style={{ width: 168, height: 168, borderRadius: "50%" }} />
          <Skeleton h={18} w={160} />
          <Skeleton h={13} w={220} />
        </div>
        <div className="card">
          <Skeleton h={13} w={110} />
          <div style={{ height: 14 }} />
          <Skeleton h={40} />
        </div>
        <div className="tiles" style={{ marginTop: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div className="tile" key={i}>
              <Skeleton h={13} w={70} />
              <Skeleton h={26} w={50} />
              <Skeleton h={6} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Dashboard({
  day,
  hrvSeries,
  rhrSeries,
  water,
  goal,
  onWater,
  onOpenDay,
  theme,
  onToggleTheme,
  showThemeToggle,
  refreshing = false,
}: {
  day: DayView;
  hrvSeries: (number | null)[];
  rhrSeries: (number | null)[];
  water: number;
  goal: number;
  onWater: (amt: number) => void;
  onOpenDay: (date: string) => void;
  theme: string;
  onToggleTheme: () => void;
  showThemeToggle: boolean;
  refreshing?: boolean;
}) {
  const [info, setInfo] = useState(false);

  const topbar = (
    <div className="topbar">
      <div>
        <div className="eyebrow">
          {fmtDate(day.date, { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <h1>Today</h1>
      </div>
      {showThemeToggle && (
        <button className="icon-btn" onClick={onToggleTheme} aria-label="toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
      )}
    </div>
  );

  // Empty / no-sync state: still allow water logging.
  if (day.readiness == null && !day.hasData) {
    return (
      <div className="scroll">
        {topbar}
        <div className="page dash-page" style={{ paddingTop: 0 }}>
          <div className="card hero" style={{ padding: "30px 16px" }}>
            <ReadinessRing value={null} refreshing={refreshing} />
            <div className="verdict-head" style={{ marginTop: 18 }}>
              Waiting on your watch
            </div>
            <div className="verdict-sub">
              No sleep or HRV synced yet today, so readiness can't be estimated. It usually lands a
              few minutes after you wake and sync.
            </div>
          </div>
          <EmptyState
            icon="pulse"
            title="Recovery signals pending"
            body="Sync your Garmin to reconstruct today's score. You can still log water and a check-in below."
          />
          <div style={{ marginTop: 4 }}>
            <QuickAdd water={water} goal={goal} onWater={onWater} />
          </div>
        </div>
      </div>
    );
  }

  const v = verdict(day.readiness);
  const b = band(day.readiness);
  const plan = day.plan;
  const todaySessions = plan?.today ?? [];
  const nextUp = todaySessions.length === 0 ? (plan?.next ?? null) : null;
  const hasSleep = day.sleep_hours != null;

  return (
    <div className="scroll">
      {topbar}
      <div className="page dash-page" style={{ paddingTop: 0 }}>
        {/* HERO */}
        <div className="card hero fade-in" style={{ padding: "22px 16px 22px" }}>
          <ReadinessRing value={day.readiness} refreshing={refreshing} />
          <button className="est-tag" style={{ marginTop: 16 }} onClick={() => setInfo(true)}>
            <Icon name="info" size={12} /> Estimated readiness
          </button>
          <div className="verdict-head" style={{ color: b.color }}>
            {v.head}
          </div>
          <div className="verdict-sub">{v.sub}</div>
        </div>

        {/* HYDRATION */}
        <div style={{ marginTop: 12 }}>
          <QuickAdd water={water} goal={goal} onWater={onWater} />
        </div>

        {day.factors.length > 0 && <FactorCard day={day} />}

        {/* SLEEP */}
        {hasSleep && (
          <div className="card card-tap fade-in" onClick={() => onOpenDay(day.date)}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="lbl">
                <Icon name="moon" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Last night
              </span>
              {day.sleep_score != null && <span className="ctx-note">score {day.sleep_score}</span>}
            </div>
            <div className="row" style={{ gap: 6, alignItems: "baseline", marginBottom: 12 }}>
              <span className="big-num mono" style={{ fontSize: 30, whiteSpace: "nowrap" }}>
                {Math.floor(day.sleep_hours!)}
                <span className="unit">h</span> {Math.round((day.sleep_hours! % 1) * 60)}
                <span className="unit">m</span>
              </span>
              <span className="ctx-note" style={{ marginLeft: "auto" }}>
                asleep
              </span>
            </div>
            {day.sleep_stages && <SleepStageBar stages={day.sleep_stages} />}
          </div>
        )}

        {/* RECOVERY TILES */}
        <div className="recovery-sec">
          <div className="lbl" style={{ margin: "20px 4px 10px" }}>
            Recovery signals
          </div>
          <div className="tiles">
            <MetricTile
              icon="pulse"
              label="HRV"
              value={day.hrv ?? "—"}
              unit={day.hrv != null ? "ms" : undefined}
              color="var(--m-hrv)"
              ctx={
                day.hrv != null && day.hrv_base_low != null && day.hrv_base_high != null
                  ? {
                      min: day.hrv_base_low - 8,
                      max: day.hrv_base_high + 8,
                      low: day.hrv_base_low,
                      high: day.hrv_base_high,
                      val: day.hrv,
                    }
                  : undefined
              }
              note={
                day.hrv != null && day.hrv_base_low != null && day.hrv_base_high != null
                  ? day.hrv < day.hrv_base_low
                    ? "below baseline band"
                    : day.hrv > day.hrv_base_high
                      ? "above baseline"
                      : "within baseline band"
                  : "no HRV synced"
              }
              onClick={() => onOpenDay(day.date)}
            />
            <MetricTile
              icon="heart"
              label="Resting HR"
              value={day.resting_hr ?? "—"}
              unit={day.resting_hr != null ? "bpm" : undefined}
              color="var(--m-rhr)"
              spark={<Sparkline data={rhrSeries.slice(-14)} color="var(--m-rhr)" />}
              note="14-day trend"
              onClick={() => onOpenDay(day.date)}
            />
            <MetricTile
              icon="battery"
              label="Body battery"
              value={day.body_battery ?? "—"}
              unit={day.body_battery != null ? "/100" : undefined}
              color="var(--m-batt)"
              ctx={
                day.body_battery != null
                  ? { min: 0, max: 100, low: 0, high: day.body_battery, val: day.body_battery }
                  : undefined
              }
              note="charged overnight"
              onClick={() => onOpenDay(day.date)}
            />
            <MetricTile
              icon="gauge"
              label="Load · ACWR"
              value={day.acwr != null ? day.acwr.toFixed(2) : "—"}
              color={
                day.acwr != null && (day.acwr > 1.3 || day.acwr < 0.8)
                  ? "var(--modify)"
                  : "var(--go)"
              }
              note={
                day.acwr == null
                  ? "no load data"
                  : day.acwr > 1.3
                    ? "ramping — caution"
                    : day.acwr < 0.8
                      ? "detraining risk"
                      : "in the sweet spot"
              }
              onClick={() => onOpenDay(day.date)}
            />
          </div>
        </div>

        {/* PLAN — real data from the active plan (today's sessions, or the next up) */}
        <div className="card fade-in" style={{ marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <span className="lbl">{todaySessions.length > 0 ? "Today's plan" : "Next up"}</span>
            {nextUp && (
              <span className="ctx-note">
                {fmtDate(nextUp.date, { weekday: "short", month: "short", day: "numeric" })}
              </span>
            )}
          </div>

          {todaySessions.length > 0 ? (
            todaySessions.map((s, i) => <PlanSessionRow key={`${s.name}-${i}`} s={s} />)
          ) : nextUp ? (
            <PlanSessionRow s={nextUp} />
          ) : (
            <div className="plan-item">
              <div
                className="sport-chip"
                style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
              >
                <Icon name="calendar" size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>
                  {plan?.hasActivePlan ? "Nothing scheduled" : "No active plan"}
                </div>
                <div className="ctx-note" style={{ marginTop: 2 }}>
                  {plan?.hasActivePlan
                    ? "No upcoming sessions in your plan."
                    : "Ask Coach to build a training plan."}
                </div>
              </div>
            </div>
          )}

          {/* Coach suggestion (readiness-based, not plan data) */}
          <div className="plan-item" style={{ paddingBottom: 2 }}>
            <div
              className="sport-chip"
              style={{
                background: `color-mix(in oklch, ${b.color} 14%, var(--surface-2))`,
                color: b.color,
              }}
            >
              <Icon name="bolt" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, color: b.color }}>{v.head}</div>
              <div className="ctx-note" style={{ marginTop: 2 }}>
                Coach suggestion based on today's readiness
              </div>
            </div>
          </div>
        </div>

        {/* NOTIFICATIONS */}
        <NotifyToggle />
      </div>

      {info && <ReadinessInfoPop day={day} onClose={() => setInfo(false)} />}
    </div>
  );
}
