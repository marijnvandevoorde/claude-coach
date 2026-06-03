/* components.jsx — shared UI primitives. Exports to window. */
var { useState, useEffect, useRef } = React;
var C = () => window.COACH;

/* ---------- status bar ---------- */
function StatusBar() {
  return (
    <div className="statusbar">
      <span className="time">9:41</span>
      <div className="sb-icons">
        <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="7" width="3" height="5" rx=".7" fill="currentColor" /><rect x="4.5" y="4.5" width="3" height="7.5" rx=".7" fill="currentColor" /><rect x="9" y="2" width="3" height="10" rx=".7" fill="currentColor" /><rect x="13.5" y="0" width="3" height="12" rx=".7" fill="currentColor" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 3C10 3 11.8 3.8 13 5l1-1C12.4 2.4 10.3 1.5 8 1.5S3.6 2.4 2 4l1 1C4.2 3.8 6 3 8 3z" /><path d="M8 6.3c1.1 0 2.1.4 2.8 1.1l1-1C10.8 5.4 9.5 4.9 8 4.9s-2.8.5-3.8 1.5l1 1C5.9 6.7 6.9 6.3 8 6.3z" /><circle cx="8" cy="10" r="1.3" /></svg>
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="currentColor" strokeOpacity="0.4" fill="none" /><rect x="2" y="2" width="18" height="8" rx="1.8" fill="currentColor" /><path d="M23 4v4c.7-.3 1.3-1 1.3-2S23.7 4.3 23 4z" fill="currentColor" fillOpacity="0.5" /></svg>
      </div>
    </div>
  );
}

/* ---------- readiness ring ---------- */
function ReadinessRing({ value, size = 196, stroke = 13, coverage = 1 }) {
  const r = (size - stroke) / 2, cx = size / 2, circ = 2 * Math.PI * r;
  const band = C().band(value);
  const pct = value == null ? 0 : value / 100;
  const [draw, setDraw] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDraw(pct), 60); return () => clearTimeout(t); }, [pct]);
  // tick marks for band thresholds (40, 67)
  const tick = (v) => { const a = (v / 100) * 1.5 * Math.PI - 1.25 * Math.PI - Math.PI / 2; return a; };
  return (
    <div className="hero-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke}
          strokeDasharray={`${circ * 0.75} ${circ}`} strokeLinecap="round" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={band.color} strokeWidth={stroke}
          strokeDasharray={`${circ * 0.75 * draw} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.2,.7,.3,1)', filter: 'drop-shadow(0 0 7px color-mix(in oklch, ' + band.color + ' 45%, transparent))' }} />
      </svg>
      <div className="center">
        {value == null
          ? <div style={{ fontFamily: 'var(--font-display)', fontSize: Math.max(18, size * 0.16), color: 'var(--text-3)' }}>—</div>
          : <>
              <div className="val" style={{ color: band.color, fontSize: size < 130 ? Math.round(size * 0.36) : 60 }}>{value}</div>
              {size >= 130 && <div className="of">/ 100 · est.</div>}
            </>}
      </div>
    </div>
  );
}

/* ---------- band pill ---------- */
function BandPill({ value }) {
  const b = C().band(value);
  return <span className="band-pill" style={{ background: `color-mix(in oklch, ${b.color} 16%, transparent)`, color: b.color }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.color }} />{b.label}
  </span>;
}

/* ---------- signed factor bars ---------- */
function FactorBars({ factors }) {
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
              <div className="fill" style={{ width: `${w}%`, [pos ? 'left' : 'right']: '50%', background: pos ? 'var(--pos)' : 'var(--neg)' }} />
            </div>
            <div className="fv" style={{ color: f.v === 0 ? 'var(--text-3)' : pos ? 'var(--pos)' : 'var(--neg)' }}>{f.v > 0 ? '+' : ''}{f.v}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- sparkline ---------- */
function Sparkline({ data, w = 70, h = 24, color = 'var(--accent)', band }) {
  if (!data || !data.length) return null;
  const vals = data.filter((v) => v != null);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = data.map((v, i) => v == null ? null : [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2]);
  let d = '', started = false;
  pts.forEach((p) => { if (!p) { started = false; return; } d += (started ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; started = true; });
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {band && <rect x="0" y={h - ((band[1] - min) / rng) * (h - 4) - 2} width={w} height={Math.max(2, ((band[1] - band[0]) / rng) * (h - 4))} fill="var(--accent-dim)" rx="2" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {pts.filter(Boolean).slice(-1).map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={color} />)}
    </svg>
  );
}

/* ---------- metric tile w/ context band ---------- */
function MetricTile({ icon, label, value, unit, note, ctx, color = 'var(--accent)', spark, onClick }) {
  // ctx: {min,max, low,high, val} → renders a context bar with band + dot
  return (
    <div className="tile fade-in" onClick={onClick}>
      <div className="tt"><span style={{ color }}><Icon name={icon} size={15} /></span><span className="lbl">{label}</span></div>
      <div className="tval">
        <span className="n" style={{ color }}>{value}</span>
        {unit && <span className="unit">{unit}</span>}
        {spark && <span style={{ marginLeft: 'auto' }}>{spark}</span>}
      </div>
      {ctx && (
        <div>
          <div className="ctx-bar">
            <div className="ctx-band" style={{ left: `${pctIn(ctx.low, ctx.min, ctx.max)}%`, width: `${pctIn(ctx.high, ctx.min, ctx.max) - pctIn(ctx.low, ctx.min, ctx.max)}%` }} />
            <div className="ctx-dot" style={{ left: `${pctIn(ctx.val, ctx.min, ctx.max)}%`, background: color }} />
          </div>
          {note && <div className="ctx-note" style={{ marginTop: 6 }}>{note}</div>}
        </div>
      )}
      {!ctx && note && <div className="ctx-note">{note}</div>}
    </div>
  );
}
function pctIn(v, min, max) { return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)); }

/* ---------- tag chip ---------- */
function TagChip({ tag }) {
  const dots = { note: 'var(--text-3)', race: 'var(--modify)', niggle: 'var(--back)', travel: 'var(--accent)', illness: 'var(--back)' };
  return <span className={`chip tag-${tag}`}><span className="tag-dot" style={{ background: dots[tag] }} />{tag}</span>;
}

/* ---------- bottom sheet ---------- */
function Sheet({ open, onClose, children, head }) {
  const [mount, setMount] = useState(open);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (open) { setMount(true); const t = setTimeout(() => setShow(true), 20); return () => clearTimeout(t); }
    else { setShow(false); const t = setTimeout(() => setMount(false), 340); return () => clearTimeout(t); }
  }, [open]);
  if (!mount) return null;
  return (
    <>
      <div className={`scrim ${show ? 'show' : ''}`} onClick={onClose} />
      <div className={`sheet ${show ? 'show' : ''}`}>
        <div className="sheet-grab" />
        {head}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

/* ---------- undo toast ---------- */
function UndoToast({ toast, onUndo }) {
  if (!toast) return null;
  return (
    <div className="toast-wrap">
      <div className="toast" key={toast.id}>
        <CountdownRing seconds={5} key={toast.id} />
        <span className="tx">{toast.text}</span>
        <button className="undo" onClick={onUndo}>Undo</button>
      </div>
    </div>
  );
}
function CountdownRing({ seconds }) {
  const [p, setP] = useState(1);
  useEffect(() => { const start = Date.now(); const iv = setInterval(() => { const e = (Date.now() - start) / (seconds * 1000); setP(Math.max(0, 1 - e)); if (e >= 1) clearInterval(iv); }, 50); return () => clearInterval(iv); }, []);
  const r = 7, c = 2 * Math.PI * r;
  return <svg className="timer" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r={r} fill="none" stroke="var(--hairline-2)" strokeWidth="2" /><circle cx="9" cy="9" r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform="rotate(-90 9 9)" style={{ transition: 'stroke-dasharray .05s linear' }} /></svg>;
}

/* ---------- tab bar ---------- */
const TABS = [
  { id: 'today', icon: 'today', label: 'Today' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar' },
  { id: 'trends', icon: 'trends', label: 'Trends' },
  { id: 'activities', icon: 'activity', label: 'Activity' },
  { id: 'journal', icon: 'journal', label: 'Journal' },
];
function TabBar({ active, onChange }) {
  return (
    <div>
      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${active === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
            <Icon name={t.icon} size={22} sw={active === t.id ? 2 : 1.6} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="home-ind" style={{ background: 'color-mix(in oklch, var(--bg) 82%, transparent)' }} />
    </div>
  );
}

/* ---------- empty + loading states ---------- */
function EmptyState({ icon = 'calendar', title, body, action }) {
  return (
    <div className="empty fade-in">
      <div className="eicon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Skeleton({ h = 16, w = '100%', style }) { return <div className="skel" style={{ height: h, width: w, ...style }} />; }

/* ---------- sport icon chip ---------- */
function SportChip({ sport, size = 38, race }) {
  return <div className="sport-chip" style={{ width: size, height: size, color: race ? 'var(--modify)' : 'var(--accent)', background: race ? 'color-mix(in oklch, var(--modify) 15%, var(--surface-2))' : undefined }}>
    <Icon name={C().sportIcon(sport)} size={size * 0.5} />
  </div>;
}

Object.assign(window, {
  StatusBar, ReadinessRing, BandPill, FactorBars, Sparkline, MetricTile, pctIn,
  TagChip, Sheet, UndoToast, CountdownRing, TabBar, TABS, EmptyState, Skeleton, SportChip,
});
