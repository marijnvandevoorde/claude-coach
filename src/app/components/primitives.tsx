import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { band, sportIcon } from "../lib/coach";
import type { Factor } from "../lib/adapt";

/* ---------- readiness ring ---------- */
export function ReadinessRing({
  value,
  size = 196,
  stroke = 13,
  refreshing = false,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  refreshing?: boolean;
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const b = band(value);
  const pct = value == null ? 0 : value / 100;
  const [draw, setDraw] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDraw(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="hero-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(135deg)" }}>
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={stroke}
          strokeDasharray={`${circ * 0.75} ${circ}`}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={b.color}
          strokeWidth={stroke}
          strokeDasharray={`${circ * 0.75 * draw} ${circ}`}
          strokeLinecap="round"
          style={{
            transition: "stroke-dasharray 1.1s cubic-bezier(.2,.7,.3,1)",
            filter: `drop-shadow(0 0 7px color-mix(in oklch, ${b.color} 45%, transparent))`,
          }}
        />
        {refreshing && (
          // A bright short arc that orbits the ring while a Garmin sync runs —
          // a subtle "alive" glow rather than a spinner.
          <circle
            className="ring-glow"
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={b.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ * 0.06} ${circ}`}
            style={{ filter: `drop-shadow(0 0 8px ${b.color})` }}
          />
        )}
      </svg>
      <div className="center">
        {value == null ? (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: Math.max(18, size * 0.16),
              color: "var(--text-3)",
            }}
          >
            —
          </div>
        ) : (
          <>
            <div
              className="val"
              style={{ color: b.color, fontSize: size < 130 ? Math.round(size * 0.36) : 60 }}
            >
              {value}
            </div>
            {size >= 130 && <div className="of">/ 100 · est.</div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- band pill ---------- */
export function BandPill({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <span
      className="band-pill"
      style={{ background: `color-mix(in oklch, ${b.color} 16%, transparent)`, color: b.color }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: b.color }} />
      {b.label}
    </span>
  );
}

/* ---------- signed factor bars ---------- */
export function FactorBars({ factors }: { factors: Factor[] }) {
  const max = 17;
  return (
    <div className="factors">
      {factors.map((f) => {
        const w = Math.min(Math.abs(f.v) / max, 1) * 50;
        const pos = f.v >= 0;
        return (
          <div className="factor" key={f.key}>
            <div className="fl">{f.label}</div>
            <div className="factor-track">
              <div className="mid" />
              <div
                className="fill"
                style={{
                  width: `${w}%`,
                  [pos ? "left" : "right"]: "50%",
                  background: pos ? "var(--pos)" : "var(--neg)",
                }}
              />
            </div>
            <div
              className="fv"
              style={{ color: f.v === 0 ? "var(--text-3)" : pos ? "var(--pos)" : "var(--neg)" }}
            >
              {f.v > 0 ? "+" : ""}
              {f.v}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- sparkline ---------- */
export function Sparkline({
  data,
  w = 70,
  h = 24,
  color = "var(--accent)",
  band: bnd,
}: {
  data: (number | null)[];
  w?: number;
  h?: number;
  color?: string;
  band?: [number, number];
}) {
  if (!data || !data.length) return null;
  const vals = data.filter((v): v is number => v != null);
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const rng = max - min || 1;
  const pts = data.map((v, i) =>
    v == null ? null : [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2]
  );
  let d = "";
  let started = false;
  pts.forEach((p) => {
    if (!p) {
      started = false;
      return;
    }
    d += (started ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1) + " ";
    started = true;
  });
  const last = pts.filter(Boolean).slice(-1)[0] as number[] | undefined;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {bnd && (
        <rect
          x="0"
          y={h - ((bnd[1] - min) / rng) * (h - 4) - 2}
          width={w}
          height={Math.max(2, ((bnd[1] - bnd[0]) / rng) * (h - 4))}
          fill="var(--accent-dim)"
          rx="2"
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last && <circle cx={last[0]} cy={last[1]} r="2" fill={color} />}
    </svg>
  );
}

/* ---------- metric tile w/ context band ---------- */
export function pctIn(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}
export function MetricTile({
  icon,
  label,
  value,
  unit,
  note,
  ctx,
  color = "var(--accent)",
  spark,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  ctx?: { min: number; max: number; low: number; high: number; val: number };
  color?: string;
  spark?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="tile fade-in" onClick={onClick}>
      <div className="tt">
        <span style={{ color }}>
          <Icon name={icon} size={15} />
        </span>
        <span className="lbl">{label}</span>
      </div>
      <div className="tval">
        <span className="n" style={{ color }}>
          {value}
        </span>
        {unit && <span className="unit">{unit}</span>}
        {spark && <span style={{ marginLeft: "auto" }}>{spark}</span>}
      </div>
      {ctx && (
        <div>
          <div className="ctx-bar">
            <div
              className="ctx-band"
              style={{
                left: `${pctIn(ctx.low, ctx.min, ctx.max)}%`,
                width: `${pctIn(ctx.high, ctx.min, ctx.max) - pctIn(ctx.low, ctx.min, ctx.max)}%`,
              }}
            />
            <div
              className="ctx-dot"
              style={{ left: `${pctIn(ctx.val, ctx.min, ctx.max)}%`, background: color }}
            />
          </div>
          {note && (
            <div className="ctx-note" style={{ marginTop: 6 }}>
              {note}
            </div>
          )}
        </div>
      )}
      {!ctx && note && <div className="ctx-note">{note}</div>}
    </div>
  );
}

/* ---------- tag chip ---------- */
const TAG_DOTS: Record<string, string> = {
  note: "var(--text-3)",
  race: "var(--modify)",
  niggle: "var(--back)",
  travel: "var(--accent)",
  illness: "var(--back)",
};
export function TagChip({ tag }: { tag: string | null }) {
  const t = tag ?? "note";
  return (
    <span className={`chip tag-${t}`}>
      <span className="tag-dot" style={{ background: TAG_DOTS[t] ?? "var(--text-3)" }} />
      {t}
    </span>
  );
}

/* ---------- sheet (bottom on mobile, right drawer on desktop) ---------- */
export function Sheet({
  open,
  onClose,
  children,
  head,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  head?: ReactNode;
}) {
  const [mount, setMount] = useState(open);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (open) {
      setMount(true);
      const t = setTimeout(() => setShow(true), 20);
      return () => clearTimeout(t);
    }
    setShow(false);
    const t = setTimeout(() => setMount(false), 340);
    return () => clearTimeout(t);
  }, [open]);
  if (!mount) return null;
  return (
    <>
      <div className={`scrim ${show ? "show" : ""}`} onClick={onClose} />
      <div className={`sheet ${show ? "show" : ""}`}>
        <div className="sheet-grab" />
        {head}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

/* ---------- undo toast ---------- */
export interface ToastState {
  id: number;
  text: string;
  base: number | null;
  noUndo?: boolean;
}
export function UndoToast({ toast, onUndo }: { toast: ToastState | null; onUndo: () => void }) {
  if (!toast) return null;
  return (
    <div className="toast-wrap">
      <div className="toast" key={toast.id}>
        <CountdownRing seconds={5} key={toast.id} />
        <span className="tx">{toast.text}</span>
        <button className="undo" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  );
}
export function CountdownRing({ seconds }: { seconds: number }) {
  const [p, setP] = useState(1);
  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      const e = (Date.now() - start) / (seconds * 1000);
      setP(Math.max(0, 1 - e));
      if (e >= 1) clearInterval(iv);
    }, 50);
    return () => clearInterval(iv);
  }, [seconds]);
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg className="timer" width="18" height="18" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--hairline-2)" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeDasharray={`${c * p} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
        style={{ transition: "stroke-dasharray .05s linear" }}
      />
    </svg>
  );
}

/* ---------- tab bar + nav config ---------- */
export type TabId = "today" | "calendar" | "trends" | "activities" | "journal";
export const TABS: { id: TabId; icon: IconName; label: string }[] = [
  { id: "today", icon: "today", label: "Today" },
  { id: "calendar", icon: "calendar", label: "Calendar" },
  { id: "trends", icon: "trends", label: "Trends" },
  { id: "activities", icon: "activity", label: "Activity" },
  { id: "journal", icon: "journal", label: "Journal" },
];
export function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <div>
      <div className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${active === t.id ? "on" : ""}`}
            onClick={() => onChange(t.id)}
          >
            <Icon name={t.icon} size={22} sw={active === t.id ? 2 : 1.6} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div
        className="home-ind"
        style={{ background: "color-mix(in oklch, var(--bg) 82%, transparent)" }}
      />
    </div>
  );
}

/* ---------- empty + loading states ---------- */
export function EmptyState({
  icon = "calendar",
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty fade-in">
      <div className="eicon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Skeleton({
  h = 16,
  w = "100%",
  style,
}: {
  h?: number;
  w?: number | string;
  style?: CSSProperties;
}) {
  return <div className="skel" style={{ height: h, width: w, ...style }} />;
}

/* ---------- sport icon chip ---------- */
export function SportChip({
  sport,
  size = 38,
  race,
}: {
  sport: string;
  size?: number;
  race?: boolean;
}) {
  return (
    <div
      className="sport-chip"
      style={{
        width: size,
        height: size,
        color: race ? "var(--modify)" : "var(--accent)",
        background: race ? "color-mix(in oklch, var(--modify) 15%, var(--surface-2))" : undefined,
      }}
    >
      <Icon name={sportIcon(sport)} size={size * 0.5} />
    </div>
  );
}
