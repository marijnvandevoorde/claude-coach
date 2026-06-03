/* charts.jsx — data-viz primitives. Exports to window. */
var { useState, useEffect, useRef } = React;
var C = () => window.COACH;

function useMeasure() {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => { const cw = e[0].contentRect.width; if (cw) setW(cw); });
    ro.observe(ref.current);
    setW(ref.current.clientWidth || 320);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------- line chart w/ baseline band + annotations ---------- */
function LineChart({ data, height = 150, color = 'var(--accent)', band, fmtY, annotations = [], yPad = 0.12, area = true, threshold, hbands, line2 }) {
  // data: [{date, v}]   band: [{date, low, high}] aligned by index (optional)
  const [ref, w] = useMeasure();
  const padL = 30, padR = 8, padT = 10, padB = 20;
  const iw = Math.max(10, w - padL - padR), ih = height - padT - padB;
  const vals = data.map((d) => d.v).filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (band) { band.forEach((b) => { if (b) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); } }); }
  const pad = (hi - lo) * yPad || 1; lo -= pad; hi += pad;
  const X = (i) => padL + (i / (data.length - 1)) * iw;
  const Y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;

  let line = '', started = false;
  data.forEach((d, i) => { if (d.v == null) { started = false; return; } line += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d.v).toFixed(1) + ' '; started = true; });
  const areaD = area && line ? line + `L ${X(data.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(padT + ih).toFixed(1)} Z` : '';

  // band path
  let bandTop = '', bandBot = '';
  if (band) {
    band.forEach((b, i) => { if (b) { bandTop += (bandTop ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(b.high).toFixed(1) + ' '; } });
    for (let i = band.length - 1; i >= 0; i--) { const b = band[i]; if (b) bandBot += 'L' + X(i).toFixed(1) + ' ' + Y(b.low).toFixed(1) + ' '; }
  }
  const ticks = 3;
  const yTicks = Array.from({ length: ticks }, (_, i) => lo + ((hi - lo) * i) / (ticks - 1));
  // second line (e.g. chronic load)
  let line2d = '', s2 = false;
  if (line2) line2.forEach((d, i) => { if (d == null) { s2 = false; return; } line2d += (s2 ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d).toFixed(1) + ' '; s2 = true; });
  const gid = 'g' + Math.round(lo * 100 + hi);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height} role="img">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {hbands && hbands.map((b, i) => <rect key={'hb' + i} x={padL} y={Y(b.to)} width={w - padR - padL} height={Math.max(0, Y(b.from) - Y(b.to))} fill={b.color} fillOpacity={b.opacity == null ? 0.1 : b.opacity} />)}
        {yTicks.map((t, i) => (
          <g key={i}><line x1={padL} y1={Y(t)} x2={w - padR} y2={Y(t)} stroke="var(--hairline)" strokeWidth="1" /><text x={padL - 6} y={Y(t) + 3.5} textAnchor="end" fontSize="9" fill="var(--text-3)" fontFamily="var(--font-mono)">{fmtY ? fmtY(t) : Math.round(t)}</text></g>
        ))}
        {threshold != null && <line x1={padL} y1={Y(threshold)} x2={w - padR} y2={Y(threshold)} stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3" />}
        {band && <path d={bandTop + bandBot + 'Z'} fill="var(--accent-dim)" stroke="none" />}
        {band && <path d={bandTop} fill="none" stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="2 3" />}
        {area && <path d={areaD} fill={`url(#${gid})`} />}
        {line2 && <path d={line2d} fill="none" stroke="var(--text-3)" strokeWidth="1.6" strokeDasharray="4 3" strokeLinecap="round" />}
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {annotations.map((a, i) => {
          const x = X(a.i);
          return <g key={i}><line x1={x} y1={padT} x2={x} y2={padT + ih} stroke={a.color || 'var(--modify)'} strokeWidth="1" strokeOpacity="0.5" strokeDasharray="2 2" /><circle cx={x} cy={padT + 3} r="3" fill={a.color || 'var(--modify)'} /></g>;
        })}
        {data.length && data[data.length - 1].v != null && <circle cx={X(data.length - 1)} cy={Y(data[data.length - 1].v)} r="3.2" fill={color} stroke="var(--bg)" strokeWidth="1.5" />}
      </svg>
    </div>
  );
}

/* ---------- ACWR sweet-spot gauge ---------- */
function ACWRGauge({ value }) {
  const [ref, w] = useMeasure();
  const min = 0.5, max = 1.8, h = 56;
  const X = (v) => 8 + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (w - 16);
  const zones = [
    { a: 0.5, b: 0.8, c: 'var(--modify)' },
    { a: 0.8, b: 1.3, c: 'var(--go)' },
    { a: 1.3, b: 1.5, c: 'var(--modify)' },
    { a: 1.5, b: 1.8, c: 'var(--back)' },
  ];
  const yBar = 20;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={h}>
        {zones.map((z, i) => <rect key={i} x={X(z.a)} y={yBar} width={X(z.b) - X(z.a)} height="10" fill={z.c} fillOpacity="0.85" rx={i === 0 ? 5 : 0} />)}
        {[0.8, 1.3, 1.5].map((t, i) => <line key={i} x1={X(t)} y1={yBar - 3} x2={X(t)} y2={yBar + 13} stroke="var(--bg-2)" strokeWidth="1.5" />)}
        <g transform={`translate(${X(value)},0)`}>
          <path d="M0 32 L-5 42 L5 42 Z" fill="var(--text)" />
          <text x="0" y="14" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)" fontFamily="var(--font-mono)">{value.toFixed(2)}</text>
        </g>
        <text x={X(1.05)} y="52" textAnchor="middle" fontSize="9" fill="var(--text-3)" fontFamily="var(--font-mono)">SWEET SPOT</text>
      </svg>
    </div>
  );
}

/* ---------- weekly volume bars ---------- */
function VolumeBars({ data, height = 120, fmtY }) {
  // data: [{label, v, hl}]
  const [ref, w] = useMeasure();
  const padB = 20, padT = 8, padL = 4, ih = height - padB - padT;
  const max = Math.max(...data.map((d) => d.v), 1);
  const bw = (w - padL * 2) / data.length;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height}>
        {data.map((d, i) => {
          const bh = (d.v / max) * ih;
          const x = padL + i * bw + bw * 0.18, ww = bw * 0.64;
          return <g key={i}>
            <rect x={x} y={padT + ih - bh} width={ww} height={Math.max(1, bh)} rx="3" fill={d.hl ? 'var(--accent)' : 'var(--surface-2)'} />
            <text x={x + ww / 2} y={height - 6} textAnchor="middle" fontSize="8.5" fill="var(--text-3)" fontFamily="var(--font-mono)">{d.label}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

/* ---------- heatmap (GitHub-style) ---------- */
function readinessColor(v) {
  if (v == null) return 'var(--track)';
  if (v >= 82) return 'var(--r6)';
  if (v >= 70) return 'var(--r5)';
  if (v >= 58) return 'var(--r4)';
  if (v >= 46) return 'var(--r3)';
  if (v >= 32) return 'var(--r2)';
  return 'var(--r1)';
}
function metricColor(metric, d) {
  if (!d || d.missing) return 'empty';
  if (d.gap) return 'gap';
  if (metric === 'readiness') return readinessColor(d.readiness);
  // non-readiness metrics: a pale→accent intensity ramp, so they follow the active palette
  let a = 0;
  if (metric === 'load') { const v = d.ts || 0; if (v === 0) return 'var(--track)'; a = Math.min(1, v / 160); }
  else if (metric === 'sleep') { if (d.sleep_score == null) return 'var(--track)'; a = Math.min(1, d.sleep_score / 100); }
  else if (metric === 'hrv') { if (d.hrv == null) return 'var(--track)'; a = Math.min(1, (d.hrv - 35) / 60); }
  const pct = Math.round(14 + a * 74);
  return `color-mix(in oklch, var(--accent) ${pct}%, var(--track))`;
}

/* ---------- route map (from a GPS track) ---------- */
function genTrack(seed) {
  let s = seed >>> 0;
  const R = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = Math.round(70 + R() * 40), loop = R() > 0.4, baseR = 0.26 + R() * 0.08;
  const ph1 = R() * 6.283, ph2 = R() * 6.283, ph3 = R() * 6.283;
  const w1 = 2 + Math.floor(R() * 3), w2 = 3 + Math.floor(R() * 4);
  const cl = (v) => Math.max(0.05, Math.min(0.95, v));
  const pts = [];
  for (let i = 0; i < n; i++) {
    let p; if (loop) p = i / n; else { const half = i / (n - 1); p = (half <= 0.5 ? half : 1 - half) * 0.5; }
    const ang = p * 6.283 + ph1;
    const rad = baseR * (0.78 + 0.32 * Math.sin(w1 * ang + ph2) + 0.16 * Math.cos(w2 * ang + ph3));
    let x = 0.5 + rad * Math.cos(ang) * 1.3, y = 0.5 + rad * Math.sin(ang);
    x += 0.012 * Math.sin(i * 0.9 + ph2); y += 0.012 * Math.cos(i * 1.1 + ph3);
    pts.push([cl(x), cl(y)]);
  }
  return pts;
}
function trackSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function RouteMap({ track, height = 168 }) {
  const [ref, w] = useMeasure();
  const pad = 16;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  track.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const px = (x) => (pad + ((x - minX) / sx) * (w - 2 * pad)).toFixed(1);
  const py = (y) => (pad + ((y - minY) / sy) * (height - 2 * pad)).toFixed(1);
  const pts = track.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
  const first = track[0], last = track[track.length - 1];
  const grid = [];
  for (let i = 1; i < 6; i++) grid.push(<line key={'v' + i} x1={(w / 6) * i} y1="0" x2={(w / 6) * i} y2={height} stroke="var(--hairline)" strokeWidth="1" />);
  for (let i = 1; i < 4; i++) grid.push(<line key={'h' + i} x1="0" y1={(height / 4) * i} x2={w} y2={(height / 4) * i} stroke="var(--hairline)" strokeWidth="1" />);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height} style={{ display: 'block', borderRadius: 12, background: 'var(--surface-2)' }}>
        <g opacity="0.6">{grid}</g>
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={px(first[0])} cy={py(first[1])} r="5" fill="var(--go)" stroke="var(--bg-2)" strokeWidth="1.5" />
        <circle cx={px(last[0])} cy={py(last[1])} r="5" fill="var(--back)" stroke="var(--bg-2)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

Object.assign(window, { useMeasure, LineChart, ACWRGauge, VolumeBars, readinessColor, metricColor, genTrack, trackSeed, RouteMap });
