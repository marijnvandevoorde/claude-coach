/* screen-dashboard.jsx — Today. Exports window.Dashboard + helpers */
var { useState, useEffect, useRef } = React;
var C = () => window.COACH;

function SleepStages({ stages }) {
  const total = stages.deep + stages.light + stages.rem + stages.awake;
  const seg = [
    { k: 'Deep', v: stages.deep, c: 'var(--m-deep)' },
    { k: 'REM', v: stages.rem, c: 'var(--m-rem)' },
    { k: 'Light', v: stages.light, c: 'var(--m-light)' },
    { k: 'Awake', v: stages.awake, c: 'var(--track)' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1.5 }}>
        {seg.map((s) => <div key={s.k} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} title={s.k} />)}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
        {seg.map((s) => <span key={s.k} className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: s.c }} />{s.k} {Math.floor(s.v / 60)}:{String(s.v % 60).padStart(2, '0')}</span>)}
      </div>
    </div>
  );
}

function FactorCard({ day }) {
  const [open, setOpen] = useState(false);
  const fs = day.factors.slice().sort((a, b) => b.v - a.v);
  const top = fs[0], bottom = fs[fs.length - 1];
  const helped = fs.filter((f) => f.v > 1).map((f) => f.label.toLowerCase().replace(' vs baseline', ''));
  const hurt = fs.filter((f) => f.v < -1).map((f) => f.label.toLowerCase().replace(' vs baseline', ''));
  const plain = () => {
    const h = helped.length ? `${cap(joinList(helped))} lifted your score` : '';
    const d = hurt.length ? `${joinList(hurt)} held it back` : '';
    if (h && d) return `${h}; ${d}.`;
    return (h || d || 'Signals were balanced today') + '.';
  };
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="lbl">What moved it</span>
        <button className="est-tag" onClick={() => setOpen(!open)} style={{ textTransform: 'none', letterSpacing: 0 }}>
          {open ? 'Hide numbers' : 'Show numbers'} <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        </button>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: 14.5, lineHeight: 1.5, color: 'var(--text)', textWrap: 'pretty' }}>{plain()}</p>
      {open && <div style={{ marginTop: 14 }} className="fade-in"><FactorBars factors={day.factors} /><p className="ctx-note" style={{ marginTop: 12, lineHeight: 1.5 }}>Points are contributions to the estimate vs. your typical day. They don't sum to the score.</p></div>}
    </div>
  );
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const joinList = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

function ReadinessInfoPop({ day, onClose }) {
  const cov = day.coverage || {};
  const items = [
    { k: 'sleep', label: 'Sleep & stages' },
    { k: 'hrv', label: 'HRV vs 60-day baseline' },
    { k: 'load', label: 'Training load (ACWR)' },
    { k: 'stress', label: 'All-day stress' },
    { k: 'subjective', label: 'Your check-in' },
  ];
  const present = items.filter((i) => cov[i.k]).length;
  return (
    <div className="pop" onClick={onClose}>
      <div className="pop-card fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Readiness is estimated</h3>
          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p>This is a <strong style={{ color: 'var(--text)' }}>reconstructed score</strong>, not a number from your watch. It blends five recovery signals into a 0–100 estimate of how prepared you are to train hard today.</p>
        <div className="lbl" style={{ marginTop: 6 }}>Data coverage · {present}/5</div>
        <div className="coverage">
          {items.map((i) => (
            <div className="crow" key={i.k}>
              <span className="cdot" style={{ background: cov[i.k] ? 'var(--go)' : 'var(--track)' }} />
              <span style={{ color: cov[i.k] ? 'var(--text)' : 'var(--text-3)' }}>{i.label}</span>
              <span className="ctx-note" style={{ marginLeft: 'auto' }}>{cov[i.k] ? 'synced' : 'missing'}</span>
            </div>
          ))}
        </div>
        {present < 5 && <p className="ctx-note" style={{ marginTop: 10, lineHeight: 1.5 }}>Fewer inputs = lower confidence. The score widens its uncertainty when signals are missing.</p>}
      </div>
    </div>
  );
}

function QuickAdd({ water, goal, onWater }) {
  const pct = Math.min(1, water / goal);
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="card qa">
      <div className="row between"><span className="lbl"><Icon name="drop" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Hydration</span><span className="ctx-note">tap to log · undoable</span></div>
      {/* water */}
      <div className="water-ring-row">
        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
          <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: 'stroke-dasharray .4s cubic-bezier(.2,.7,.3,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--accent)' }}><Icon name="drop" size={20} /></div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
            <span className="big-num mono" style={{ fontSize: 22 }}>{(water / 1000).toFixed(2)}</span>
            <span className="unit">/ {(goal / 1000).toFixed(1)} L water</span>
          </div>
          <div className="stepper" style={{ marginTop: 9 }}>
            {[100, 250, 500].map((a) => <button key={a} className="step-btn" onClick={() => onWater(a)}>+{a}</button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function SubjectiveCheckIn({ subjective, onSubj }) {
  const fields = [
    { k: 'energy', label: 'Energy', lo: 'Drained', hi: 'Fresh' },
    { k: 'mood', label: 'Mood', lo: 'Low', hi: 'Great' },
  ];
  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <span className="lbl">How do you feel?</span>
        <span className="ctx-note" style={{ whiteSpace: 'nowrap' }}>today · drag to log</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {fields.map((f) => <LevelSlider key={f.k} field={f} value={subjective[f.k] || 0} onChange={(v) => onSubj(f.k, v)} />)}
      </div>
    </div>
  );
}

function LevelSlider({ field, value, onChange }) {
  const set = !!value;
  const shown = set ? value : 3;
  const fill = ((shown - 1) / 4) * 100;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 9 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{field.label}</span>
        <span className="mono" style={{ fontSize: 13, color: set ? 'var(--accent)' : 'var(--text-3)' }}>{set ? `${value} / 5` : '—'}</span>
      </div>
      <input type="range" min="1" max="5" step="1" value={shown} onChange={(e) => onChange(+e.target.value)}
        className={`lvl-range ${set ? '' : 'unset'}`} aria-label={field.label}
        style={{ background: `linear-gradient(to right, ${set ? 'var(--accent)' : 'var(--text-3)'} ${fill}%, var(--track) ${fill}%)` }} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="ctx-note">{field.lo}</span>
        <span className="ctx-note">{field.hi}</span>
      </div>
    </div>
  );
}

function Dashboard({ day, recent, water, goal, onWater, onOpenDay, theme, onToggleTheme }) {
  const [info, setInfo] = useState(false);
  const verdict = C().verdict(day.readiness);
  const band = C().band(day.readiness);
  // rolling sparkline series for tiles
  const hrvSeries = recent.map((d) => d.gap || d.missing ? null : d.hrv);
  const rhrSeries = recent.map((d) => d.gap || d.missing ? null : d.resting_hr);
  const plan = todayPlan(day);
  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <div className="eyebrow">{C().fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>Today</h1>
        </div>
        <button className="icon-btn" onClick={onToggleTheme} aria-label="toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
      </div>

      <div className="page dash-page" style={{ paddingTop: 0 }}>
        {/* HERO */}
        <div className="card hero fade-in" style={{ padding: '22px 16px 22px' }}>
          <ReadinessRing value={day.readiness} />
          <button className="est-tag" style={{ marginTop: 16 }} onClick={() => setInfo(true)}>
            <Icon name="info" size={12} /> Estimated readiness
          </button>
          <div className="verdict-head" style={{ color: band.color }}>{verdict.head}</div>
          <div className="verdict-sub">{verdict.sub}</div>
        </div>

        {/* HYDRATION (quick action) */}
        <div style={{ marginTop: 12 }}><QuickAdd water={water} goal={goal} onWater={onWater} /></div>

        <FactorCard day={day} />

        {/* SLEEP */}
        <div className="card card-tap fade-in" onClick={() => onOpenDay(day.date)}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <span className="lbl"><Icon name="moon" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Last night</span>
            <span className="ctx-note">score {day.sleep_score}</span>
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'baseline', marginBottom: 12 }}>
            <span className="big-num mono" style={{ fontSize: 30, whiteSpace: 'nowrap' }}>{Math.floor(day.sleep_hours)}<span className="unit">h</span> {Math.round((day.sleep_hours % 1) * 60)}<span className="unit">m</span></span>
            <span className="ctx-note" style={{ marginLeft: 'auto' }}>asleep</span>
          </div>
          <SleepStages stages={day.sleep_stages} />
        </div>

        {/* RECOVERY TILES */}
        <div className="recovery-sec">
        <div className="lbl" style={{ margin: '20px 4px 10px' }}>Recovery signals</div>
        <div className="tiles">
          <MetricTile icon="pulse" label="HRV" value={day.hrv} unit="ms" color="var(--m-hrv)"
            ctx={{ min: day.hrv_base_low - 8, max: day.hrv_base_high + 8, low: day.hrv_base_low, high: day.hrv_base_high, val: day.hrv }}
            note={day.hrv < day.hrv_base_low ? 'below baseline band' : day.hrv > day.hrv_base_high ? 'above baseline' : 'within baseline band'}
            onClick={() => onOpenDay(day.date)} />
          <MetricTile icon="heart" label="Resting HR" value={day.resting_hr} unit="bpm" color="var(--m-rhr)"
            spark={<Sparkline data={rhrSeries.slice(-14)} color="var(--m-rhr)" />}
            note="14-day trend" onClick={() => onOpenDay(day.date)} />
          <MetricTile icon="battery" label="Body battery" value={day.body_battery} unit="/100" color="var(--m-batt)"
            ctx={{ min: 0, max: 100, low: 0, high: day.body_battery, val: day.body_battery }} note="charged overnight" onClick={() => onOpenDay(day.date)} />
          <MetricTile icon="gauge" label="Load · ACWR" value={day.acwr.toFixed(2)} color={day.acwr > 1.3 || day.acwr < 0.8 ? 'var(--modify)' : 'var(--go)'}
            note={day.acwr > 1.3 ? 'ramping — caution' : day.acwr < 0.8 ? 'detraining risk' : 'in the sweet spot'} onClick={() => onOpenDay(day.date)} />
        </div>
        </div>

        {/* PLAN */}
        <div className="card fade-in" style={{ marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 4 }}><span className="lbl">Today's plan</span><span className="ctx-note">from training log</span></div>
          <div className="plan-item">
            <SportChip sport={plan.sport} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>{plan.title}</div>
              <div className="ctx-note" style={{ marginTop: 2 }}>{plan.detail}</div>
            </div>
          </div>
          <div className="plan-item" style={{ paddingBottom: 2 }}>
            <div className="sport-chip" style={{ background: `color-mix(in oklch, ${band.color} 14%, var(--surface-2))`, color: band.color }}><Icon name="bolt" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, color: band.color }}>{verdict.head}</div>
              <div className="ctx-note" style={{ marginTop: 2 }}>Coach suggestion based on today's readiness</div>
            </div>
          </div>
        </div>
      </div>

      {info && <ReadinessInfoPop day={day} onClose={() => setInfo(false)} />}
    </div>
  );
}

function todayPlan(day) {
  // derive a plausible session from weekday
  const dow = C().parse(day.date).getDay();
  const map = {
    0: { sport: 'run', title: 'Long run · 18 km', detail: 'Z2 aerobic, finish steady' },
    1: { sport: 'run', title: 'Rest or mobility', detail: 'Optional 20 min easy spin' },
    2: { sport: 'run', title: 'Intervals · 6×800m', detail: '5k pace, 2 min jog recovery' },
    3: { sport: 'ride', title: 'Endurance ride · 90 min', detail: 'Z2, cadence focus' },
    4: { sport: 'run', title: 'Tempo · 40 min', detail: '20 min @ threshold' },
    5: { sport: 'run', title: 'Rest', detail: 'Stretch, hydrate, prep for weekend' },
    6: { sport: 'ride', title: 'Long ride · 3 hr', detail: 'Z2 with 3×8 min tempo' },
  };
  return map[dow];
}

Object.assign(window, { Dashboard, SleepStages, QuickAdd, SubjectiveCheckIn, LevelSlider, ReadinessInfoPop, FactorCard, todayPlan });
