/* screen-calendar.jsx — multi-year heatmap + scrollable month grid. window.Calendar */
var { useState, useEffect, useRef } = React;
var C = () => window.COACH;

const METRICS = [
  { k: 'readiness', label: 'Readiness' },
  { k: 'load', label: 'Load' },
  { k: 'sleep', label: 'Sleep' },
  { k: 'hrv', label: 'HRV' },
];

function MetricPicker({ value, onChange }) {
  return (
    <div className="seg">
      {METRICS.map((m) => <button key={m.k} className={value === m.k ? 'on' : ''} onClick={() => onChange(m.k)}>{m.label}</button>)}
    </div>
  );
}

function YearHeatmap({ metric, onPick, weeks }) {
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, []);
  // month labels: mark first week of each month
  return (
    <div ref={scroller} style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'inline-block', minWidth: '100%' }}>
        <div style={{ display: 'flex', gap: 3, marginBottom: 4, marginLeft: 0 }}>
          {weeks.map((wk, i) => {
            const first = wk.find((d) => d);
            const showLabel = first && C().parse(first.date).getDate() <= 7;
            return <div key={i} style={{ width: 13, fontSize: 8.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'visible', height: 10 }}>{showLabel ? C().parse(first.date).toLocaleDateString('en-US', { month: 'short' }) : ''}</div>;
          })}
        </div>
        <div className="cal-grid">
          {weeks.map((wk, i) => (
            <div className="cal-col" key={i}>
              {wk.map((d, j) => {
                if (!d) return <div key={j} className="cal-cell cal-na" />;
                const col = metricColor(metric, d);
                const cls = col === 'gap' ? 'cal-cell gap' : col === 'empty' ? 'cal-cell cal-na' : 'cal-cell';
                return <div key={j} className={cls} style={col !== 'gap' && col !== 'empty' ? { background: col } : undefined} onClick={() => onPick(d.date)} title={C().fmtDate(d.date)} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ year, month, metric, onPick }) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(dd);
  const jset = new Set(C().journal.map((j) => j.date));
  const jtag = {}; C().journal.forEach((j) => { jtag[j.date] = j.tag; });
  const dotColor = { note: 'var(--text-2)', race: 'var(--modify)', niggle: 'var(--back)', travel: 'var(--accent)', illness: 'var(--back)' };
  return (
    <div>
      <div className="month-strip" style={{ marginBottom: 6 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="ctx-note" style={{ textAlign: 'center' }}>{d}</div>)}
      </div>
      <div className="month-strip">
        {cells.map((dd, i) => {
          if (dd == null) return <div key={i} />;
          const date = C().iso(new Date(year, month, dd));
          const d = C().get(date);
          const isToday = date === C().todayISO;
          const future = C().parse(date) > C().TODAY;
          if (future) return <div key={i} className="mcell" style={{ opacity: .3 }}><span className="mday">{dd}</span></div>;
          const col = d ? metricColor(metric, d) : 'empty';
          const isGap = d && d.gap;
          const bg = isGap ? undefined : (col === 'empty' ? 'var(--track)' : col);
          const valText = d && !d.gap && metric === 'readiness' ? d.readiness : '';
          return (
            <div key={i} className={`mcell ${isGap ? 'gap' : ''} ${isToday ? 'today-cell' : ''}`} style={{ background: bg }} onClick={() => onPick(date)}>
              <span className="mday" style={{ position: 'absolute', top: 4, left: 6 }}>{dd}</span>
              {jset.has(date) && <span className="jmark" style={{ background: dotColor[jtag[date]] }} />}
              {valText !== '' && <span style={{ color: readinessTextColor(d.readiness), fontWeight: 600 }}>{valText}</span>}
              {isGap && <span style={{ fontSize: 9, color: 'var(--text-3)' }}>—</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function readinessTextColor(v) { return v >= 50 ? 'oklch(0.22 0.01 60)' : 'oklch(0.20 0.012 40)'; }

function Calendar({ metric, onMetric, onPick }) {
  const [cursor, setCursor] = useState({ y: C().TODAY.getFullYear(), m: C().TODAY.getMonth() });
  // build weeks for year heatmap: last 60 weeks ending this week
  const weeks = React.useMemo(() => {
    const end = new Date(C().TODAY);
    end.setDate(end.getDate() + (6 - end.getDay())); // end of current week (Sat)
    const start = new Date(end); start.setDate(start.getDate() - 60 * 7 + 1);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
    const out = []; let cur = new Date(start);
    while (cur <= end) {
      const wk = [];
      for (let i = 0; i < 7; i++) { const ds = C().iso(cur); wk.push(cur > C().TODAY ? null : (C().get(ds) || { date: ds, missing: true })); cur.setDate(cur.getDate() + 1); }
      out.push(wk);
    }
    return out;
  }, []);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const canNext = !(cursor.y === C().TODAY.getFullYear() && cursor.m === C().TODAY.getMonth());
  const step = (delta) => setCursor((c) => { let m = c.m + delta, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });

  return (
    <div className="scroll">
      <div className="topbar"><div><div className="eyebrow">2021 → today · ~1,900 days</div><h1>Calendar</h1></div></div>
      <div className="page" style={{ paddingTop: 0 }}>
        <MetricPicker value={metric} onChange={onMetric} />
        <div className="card fade-in" style={{ marginTop: 12, paddingBottom: 10 }}>
          <div className="row between" style={{ marginBottom: 10 }}><span className="lbl">Last 14 months</span><span className="ctx-note">tap any day</span></div>
          <YearHeatmap metric={metric} onPick={onPick} weeks={weeks} />
          <Legend metric={metric} />
        </div>

        <div className="card fade-in" style={{ marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>{monthName}</span>
            <div className="step-nav">
              <button onClick={() => step(-1)} aria-label="previous month"><Icon name="chevL" size={16} /></button>
              <button onClick={() => step(1)} disabled={!canNext} aria-label="next month"><Icon name="chevR" size={16} /></button>
            </div>
          </div>
          <MonthGrid year={cursor.y} month={cursor.m} metric={metric} onPick={onPick} />
          <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            {[['race', 'race'], ['niggle', 'niggle'], ['travel', 'travel'], ['note', 'note']].map(([t]) => <span key={t} className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: { note: 'var(--text-2)', race: 'var(--modify)', niggle: 'var(--back)', travel: 'var(--accent)' }[t] }} />{t}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ metric }) {
  const samples = metric === 'readiness'
    ? [['low', readinessColor(20)], ['', readinessColor(45)], ['', readinessColor(60)], ['', readinessColor(72)], ['high', readinessColor(88)]]
    : [['less', metricColor(metric, { [metricKey(metric)]: lowVal(metric), ts: 10 })], ['', metricColor(metric, sample(metric, 0.4))], ['', metricColor(metric, sample(metric, 0.7))], ['more', metricColor(metric, sample(metric, 1))]];
  return (
    <div className="row" style={{ gap: 4, marginTop: 12, alignItems: 'center' }}>
      <span className="ctx-note" style={{ marginRight: 4 }}>{samples[0][0]}</span>
      {samples.map((s, i) => <span key={i} style={{ width: 13, height: 13, borderRadius: 3, background: s[1] }} />)}
      <span className="ctx-note" style={{ marginLeft: 4 }}>{samples[samples.length - 1][0]}</span>
      <span className="cal-cell gap" style={{ marginLeft: 10 }} />
      <span className="ctx-note">no watch</span>
    </div>
  );
}
function metricKey(m) { return ({ load: 'ts', sleep: 'sleep_score', hrv: 'hrv' })[m]; }
function lowVal(m) { return ({ load: 10, sleep: 40, hrv: 40 })[m]; }
function sample(m, a) { return ({ load: { ts: a * 160 }, sleep: { sleep_score: 40 + a * 55 }, hrv: { hrv: 40 + a * 50 } })[m]; }

Object.assign(window, { Calendar, YearHeatmap, MonthGrid, MetricPicker, Legend, METRICS });
