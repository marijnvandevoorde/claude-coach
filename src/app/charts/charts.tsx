import { useEffect, useRef, useState } from "react";

export function useMeasure(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => {
      const cw = e[0].contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(ref.current);
    setW(ref.current.clientWidth || 320);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface LinePoint {
  date?: string;
  v: number | null;
}
export interface BandPoint {
  low: number;
  high: number;
}
export interface Annotation {
  i: number;
  color?: string;
}
export interface HBand {
  from: number;
  to: number;
  color: string;
  opacity?: number;
}

/* ---------- line chart w/ baseline band + annotations ---------- */
export function LineChart({
  data,
  height = 150,
  color = "var(--accent)",
  band,
  fmtY,
  annotations = [],
  yPad = 0.12,
  area = true,
  threshold,
  hbands,
  line2,
}: {
  data: LinePoint[];
  height?: number;
  color?: string;
  band?: (BandPoint | null)[];
  fmtY?: (t: number) => string | number;
  annotations?: Annotation[];
  yPad?: number;
  area?: boolean;
  threshold?: number;
  hbands?: HBand[];
  line2?: (number | null)[];
}) {
  const [ref, w] = useMeasure();
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const vals = data.map((d) => d.v).filter((v): v is number => v != null);
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  if (band) {
    band.forEach((b) => {
      if (b) {
        lo = Math.min(lo, b.low);
        hi = Math.max(hi, b.high);
      }
    });
  }
  const pad = (hi - lo) * yPad || 1;
  lo -= pad;
  hi += pad;
  const X = (i: number) => padL + (i / Math.max(1, data.length - 1)) * iw;
  const Y = (v: number) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;

  let line = "";
  let started = false;
  data.forEach((d, i) => {
    if (d.v == null) {
      started = false;
      return;
    }
    line += (started ? "L" : "M") + X(i).toFixed(1) + " " + Y(d.v).toFixed(1) + " ";
    started = true;
  });
  const areaD =
    area && line
      ? line +
        `L ${X(data.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(
          padT + ih
        ).toFixed(1)} Z`
      : "";

  let bandTop = "";
  let bandBot = "";
  if (band) {
    band.forEach((b, i) => {
      if (b) bandTop += (bandTop ? "L" : "M") + X(i).toFixed(1) + " " + Y(b.high).toFixed(1) + " ";
    });
    for (let i = band.length - 1; i >= 0; i--) {
      const b = band[i];
      if (b) bandBot += "L" + X(i).toFixed(1) + " " + Y(b.low).toFixed(1) + " ";
    }
  }
  const ticks = 3;
  const yTicks = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * i) / (ticks - 1));
  let line2d = "";
  let s2 = false;
  if (line2)
    line2.forEach((d, i) => {
      if (d == null) {
        s2 = false;
        return;
      }
      line2d += (s2 ? "L" : "M") + X(i).toFixed(1) + " " + Y(d).toFixed(1) + " ";
      s2 = true;
    });
  const gid = "g" + Math.round(lo * 100 + hi);
  const lastIdx = data.length - 1;
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={height} role="img">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {hbands &&
          hbands.map((b, i) => (
            <rect
              key={"hb" + i}
              x={padL}
              y={Y(b.to)}
              width={w - padR - padL}
              height={Math.max(0, Y(b.from) - Y(b.to))}
              fill={b.color}
              fillOpacity={b.opacity == null ? 0.1 : b.opacity}
            />
          ))}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(t)} x2={w - padR} y2={Y(t)} stroke="var(--hairline)" strokeWidth="1" />
            <text
              x={padL - 6}
              y={Y(t) + 3.5}
              textAnchor="end"
              fontSize="9"
              fill="var(--text-3)"
              fontFamily="var(--font-mono)"
            >
              {fmtY ? fmtY(t) : Math.round(t)}
            </text>
          </g>
        ))}
        {threshold != null && (
          <line
            x1={padL}
            y1={Y(threshold)}
            x2={w - padR}
            y2={Y(threshold)}
            stroke="var(--text-3)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        {band && <path d={bandTop + bandBot + "Z"} fill="var(--accent-dim)" stroke="none" />}
        {band && (
          <path d={bandTop} fill="none" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="2 3" />
        )}
        {area && <path d={areaD} fill={`url(#${gid})`} />}
        {line2 && (
          <path
            d={line2d}
            fill="none"
            stroke="var(--text-3)"
            strokeWidth="1.6"
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
        )}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {annotations.map((a, i) => {
          const x = X(a.i);
          return (
            <g key={i}>
              <line
                x1={x}
                y1={padT}
                x2={x}
                y2={padT + ih}
                stroke={a.color || "var(--modify)"}
                strokeWidth="1"
                strokeOpacity="0.5"
                strokeDasharray="2 2"
              />
              <circle cx={x} cy={padT + 3} r="3" fill={a.color || "var(--modify)"} />
            </g>
          );
        })}
        {data.length > 0 && data[lastIdx].v != null && (
          <circle
            cx={X(lastIdx)}
            cy={Y(data[lastIdx].v as number)}
            r="3.2"
            fill={color}
            stroke="var(--bg)"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  );
}

/* ---------- ACWR sweet-spot gauge ---------- */
export function ACWRGauge({ value }: { value: number }) {
  const [ref, w] = useMeasure();
  const min = 0.5;
  const max = 1.8;
  const h = 56;
  const X = (v: number) => 8 + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (w - 16);
  const zones = [
    { a: 0.5, b: 0.8, c: "var(--modify)" },
    { a: 0.8, b: 1.3, c: "var(--go)" },
    { a: 1.3, b: 1.5, c: "var(--modify)" },
    { a: 1.5, b: 1.8, c: "var(--back)" },
  ];
  const yBar = 20;
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={h}>
        {zones.map((z, i) => (
          <rect
            key={i}
            x={X(z.a)}
            y={yBar}
            width={X(z.b) - X(z.a)}
            height="10"
            fill={z.c}
            fillOpacity="0.85"
            rx={i === 0 ? 5 : 0}
          />
        ))}
        {[0.8, 1.3, 1.5].map((t, i) => (
          <line key={i} x1={X(t)} y1={yBar - 3} x2={X(t)} y2={yBar + 13} stroke="var(--bg-2)" strokeWidth="1.5" />
        ))}
        <g transform={`translate(${X(value)},0)`}>
          <path d="M0 32 L-5 42 L5 42 Z" fill="var(--text)" />
          <text
            x="0"
            y="14"
            textAnchor="middle"
            fontSize="13"
            fontWeight="600"
            fill="var(--text)"
            fontFamily="var(--font-mono)"
          >
            {value.toFixed(2)}
          </text>
        </g>
        <text
          x={X(1.05)}
          y="52"
          textAnchor="middle"
          fontSize="9"
          fill="var(--text-3)"
          fontFamily="var(--font-mono)"
        >
          SWEET SPOT
        </text>
      </svg>
    </div>
  );
}

/* ---------- weekly volume bars ---------- */
export function VolumeBars({
  data,
  height = 120,
}: {
  data: { label: string; v: number; hl: boolean }[];
  height?: number;
}) {
  const [ref, w] = useMeasure();
  const padB = 20;
  const padT = 8;
  const padL = 4;
  const ih = height - padB - padT;
  const max = Math.max(...data.map((d) => d.v), 1);
  const bw = (w - padL * 2) / Math.max(1, data.length);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={w} height={height}>
        {data.map((d, i) => {
          const bh = (d.v / max) * ih;
          const x = padL + i * bw + bw * 0.18;
          const ww = bw * 0.64;
          return (
            <g key={i}>
              <rect
                x={x}
                y={padT + ih - bh}
                width={ww}
                height={Math.max(1, bh)}
                rx="3"
                fill={d.hl ? "var(--accent)" : "var(--surface-2)"}
              />
              <text
                x={x + ww / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="8.5"
                fill="var(--text-3)"
                fontFamily="var(--font-mono)"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- heatmap color logic ---------- */
export function readinessColor(v: number | null): string {
  if (v == null) return "var(--track)";
  if (v >= 82) return "var(--r6)";
  if (v >= 70) return "var(--r5)";
  if (v >= 58) return "var(--r4)";
  if (v >= 46) return "var(--r3)";
  if (v >= 32) return "var(--r2)";
  return "var(--r1)";
}

export interface HeatDay {
  readiness: number | null;
  load: number | null;
  sleep: number | null;
  hrv: number | null;
  gap: boolean;
}
export type MetricKey = "readiness" | "load" | "sleep" | "hrv";

// Returns a CSS color, or the sentinel strings "gap" / "empty".
export function metricColor(metric: MetricKey, d: (HeatDay & { missing?: boolean }) | null): string {
  if (!d || d.missing) return "empty";
  if (d.gap) return "gap";
  if (metric === "readiness") return readinessColor(d.readiness);
  let a = 0;
  if (metric === "load") {
    const v = d.load ?? 0;
    if (!v) return "var(--track)";
    a = Math.min(1, v / 160);
  } else if (metric === "sleep") {
    if (d.sleep == null) return "var(--track)";
    a = Math.min(1, d.sleep / 100);
  } else {
    if (d.hrv == null) return "var(--track)";
    a = Math.min(1, (d.hrv - 35) / 60);
  }
  const pct = Math.round(14 + a * 74);
  return `color-mix(in oklch, var(--accent) ${pct}%, var(--track))`;
}

/* ---------- route map (from a GPS track) ---------- */
// Deterministic synthetic track for activities that lack GPS (fallback only).
export function genTrack(seed: number): number[][] {
  let s = seed >>> 0;
  const R = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = Math.round(70 + R() * 40);
  const loop = R() > 0.4;
  const baseR = 0.26 + R() * 0.08;
  const ph1 = R() * 6.283;
  const ph2 = R() * 6.283;
  const ph3 = R() * 6.283;
  const w1 = 2 + Math.floor(R() * 3);
  const w2 = 3 + Math.floor(R() * 4);
  const cl = (v: number) => Math.max(0.05, Math.min(0.95, v));
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    let p: number;
    if (loop) p = i / n;
    else {
      const half = i / (n - 1);
      p = (half <= 0.5 ? half : 1 - half) * 0.5;
    }
    const ang = p * 6.283 + ph1;
    const rad = baseR * (0.78 + 0.32 * Math.sin(w1 * ang + ph2) + 0.16 * Math.cos(w2 * ang + ph3));
    let x = 0.5 + rad * Math.cos(ang) * 1.3;
    let y = 0.5 + rad * Math.sin(ang);
    x += 0.012 * Math.sin(i * 0.9 + ph2);
    y += 0.012 * Math.cos(i * 1.1 + ph3);
    pts.push([cl(x), cl(y)]);
  }
  return pts;
}
export function trackSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function RouteMap({ track, height = 168 }: { track: number[][]; height?: number }) {
  const [ref, w] = useMeasure();
  const pad = 16;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  // tracks may be [lat,lon] or [x,y]; use first two coords
  track.forEach((pt) => {
    const x = pt[1] ?? pt[0];
    const y = pt[0];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const px = (x: number) => (pad + ((x - minX) / sx) * (w - 2 * pad)).toFixed(1);
  // invert Y so north is up
  const py = (y: number) => (pad + (1 - (y - minY) / sy) * (height - 2 * pad)).toFixed(1);
  const pts = track.map((pt) => `${px(pt[1] ?? pt[0])},${py(pt[0])}`).join(" ");
  const first = track[0];
  const last = track[track.length - 1];
  const grid: React.ReactNode[] = [];
  for (let i = 1; i < 6; i++)
    grid.push(
      <line key={"v" + i} x1={(w / 6) * i} y1="0" x2={(w / 6) * i} y2={height} stroke="var(--hairline)" strokeWidth="1" />
    );
  for (let i = 1; i < 4; i++)
    grid.push(
      <line key={"h" + i} x1="0" y1={(height / 4) * i} x2={w} y2={(height / 4) * i} stroke="var(--hairline)" strokeWidth="1" />
    );
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg
        width={w}
        height={height}
        style={{ display: "block", borderRadius: 12, background: "var(--surface-2)" }}
      >
        <g opacity="0.6">{grid}</g>
        <polyline
          points={pts}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={px(first[1] ?? first[0])} cy={py(first[0])} r="5" fill="var(--go)" stroke="var(--bg-2)" strokeWidth="1.5" />
        <circle cx={px(last[1] ?? last[0])} cy={py(last[0])} r="5" fill="var(--back)" stroke="var(--bg-2)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
