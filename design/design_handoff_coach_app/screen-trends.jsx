/* screen-trends.jsx — charts with window selector + annotations. window.Trends */
var C = () => window.COACH;

const WINDOWS = [{ k: 7, label: '7 days' }, { k: 42, label: '6 weeks' }, { k: 120, label: 'Season' }];

function ChartCard({ title, sub, children, screenReader }) {
  return (
    <div className="card fade-in" style={{ paddingBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="lbl">{title}</span>
        {sub && <span className="ctx-note">{sub}</span>}
      </div>
      {screenReader && <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{screenReader}</span>}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Trends({ win, onWin, onPick }) {
  const days = C().lastN(win);
  // annotations from journal within window
  const dateIndex = {}; days.forEach((d, i) => { dateIndex[d.date] = i; });
  const annColor = { race: 'var(--modify)', niggle: 'var(--back)', illness: 'var(--back)', travel: 'var(--accent)', note: 'var(--text-3)' };
  const anns = C().journal.filter((j) => dateIndex[j.date] != null).map((j) => ({ i: dateIndex[j.date], color: annColor[j.tag] }));

  const val = (d, k) => d.gap || d.missing ? null : d[k];
  const readinessData = days.map((d) => ({ date: d.date, v: val(d, 'readiness') }));
  const hrvData = days.map((d) => ({ date: d.date, v: val(d, 'hrv') }));
  const hrvBand = days.map((d) => d.gap || d.missing ? null : { low: d.hrv_base_low, high: d.hrv_base_high });
  const acwrData = days.map((d) => ({ date: d.date, v: d.missing ? null : d.acwr }));
  const acuteLine = days.map((d) => d.missing ? null : d.load_acute);
  const chronicLine = days.map((d) => d.missing ? null : d.load_chronic);

  // weekly volume (sum suffer/duration per ISO week) over window
  const weeks = weeklyVolume(days);

  const avgReady = avg(readinessData.map((d) => d.v));
  const latestHrv = lastNonNull(hrvData.map((d) => d.v));

  return (
    <div className="scroll">
      <div className="topbar"><div><div className="eyebrow">Trends · journal woven in</div><h1>Trends</h1></div></div>
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="seg">{WINDOWS.map((wd) => <button key={wd.k} className={win === wd.k ? 'on' : ''} onClick={() => onWin(wd.k)}>{wd.label}</button>)}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <ChartCard title="Readiness" sub={`avg ${avgReady}`} screenReader={`Readiness over ${win} days, averaging ${avgReady} out of 100.`}>
            <LineChart data={readinessData} height={156} color="var(--accent)" annotations={anns} yPad={0.05}
              hbands={[{ from: 67, to: 100, color: 'var(--go)', opacity: 0.07 }, { from: 40, to: 67, color: 'var(--modify)', opacity: 0.07 }, { from: 0, to: 40, color: 'var(--back)', opacity: 0.07 }]} />
            <ZoneLegend />
          </ChartCard>

          <ChartCard title="HRV vs baseline band" sub={latestHrv ? `${latestHrv} ms` : '—'} screenReader="Heart-rate variability plotted against its rolling baseline band.">
            <LineChart data={hrvData} height={150} color="var(--m-hrv)" band={hrvBand} annotations={anns} fmtY={(t) => Math.round(t)} />
            <div className="ctx-note" style={{ marginTop: 6 }}>Shaded = your normal range. Below the band = under-recovered.</div>
          </ChartCard>

          <ChartCard title="Acute vs chronic load" sub={`ACWR ${days[days.length - 1].acwr?.toFixed(2) || '—'}`} screenReader="Acute 7-day load versus chronic 28-day load.">
            <LineChart data={days.map((d) => ({ date: d.date, v: d.missing ? null : d.load_acute }))} line2={chronicLine} height={150} color="var(--accent)" area={false} annotations={anns} fmtY={(t) => Math.round(t)} />
            <div className="row" style={{ gap: 14, marginTop: 6 }}>
              <span className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 2, background: 'var(--accent)' }} />acute (7d)</span>
              <span className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 0, borderTop: '2px dashed var(--text-3)' }} />chronic (28d)</span>
            </div>
          </ChartCard>

          <ChartCard title="ACWR sweet-spot" sub="acute : chronic" screenReader={`Current acute-to-chronic workload ratio is ${days[days.length - 1].acwr?.toFixed(2)}.`}>
            <ACWRGauge value={days[days.length - 1].acwr || 1} />
            <div className="ctx-note" style={{ marginTop: 2 }}>0.8–1.3 balances fitness gain against injury risk.</div>
          </ChartCard>

          <ChartCard title="Weekly volume" sub="training hours" screenReader="Training hours per week.">
            <VolumeBars data={weeks} height={120} />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ZoneLegend() {
  return <div className="row" style={{ gap: 14, marginTop: 8 }}>
    {[['Go', 'var(--go)'], ['Modify', 'var(--modify)'], ['Back off', 'var(--back)']].map(([l, c]) => <span key={l} className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}</span>)}
  </div>;
}

function weeklyVolume(days) {
  const buckets = {};
  days.forEach((d) => {
    if (d.missing) return;
    const dt = C().parse(d.date); const monday = new Date(dt); monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const key = C().iso(monday);
    const hrs = d.activity ? d.activity.duration / 60 : 0;
    buckets[key] = (buckets[key] || 0) + hrs;
  });
  const keys = Object.keys(buckets).sort();
  const show = keys.slice(-8);
  return show.map((k, i) => ({ label: C().parse(k).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }), v: Math.round(buckets[k] * 10) / 10, hl: i === show.length - 1 }));
}
function avg(arr) { const v = arr.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '—'; }
function lastNonNull(arr) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }

Object.assign(window, { Trends, ChartCard, weeklyVolume, WINDOWS });
