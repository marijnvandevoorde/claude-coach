/* screen-misc.jsx — Activities list, Activity detail, Journal. */
var { useState, useEffect, useRef } = React;
var C = () => window.COACH;

const SPORTS = [{ k: 'all', label: 'All' }, { k: 'run', label: 'Run' }, { k: 'ride', label: 'Ride' }];

function Activities({ onOpenActivity }) {
  const [sport, setSport] = useState('all');
  const [limit, setLimit] = useState(40);
  const allActs = C().activities.filter((a) => sport === 'all' || a.sport === sport);
  const acts = allActs.slice(0, limit);
  // group by month
  const groups = {};
  acts.forEach((a) => { const k = C().parse(a.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); (groups[k] = groups[k] || []).push(a); });
  const total = allActs.reduce((s, a) => s + a.distance, 0);
  return (
    <div className="scroll">
      <div className="topbar"><div><div className="eyebrow">{allActs.length} activities · {Math.round(total)} km</div><h1>Activity</h1></div></div>
      <div className="page act-page" style={{ paddingTop: 0 }}>
        <div className="seg" style={{ maxWidth: 220 }}>{SPORTS.map((s) => <button key={s.k} className={sport === s.k ? 'on' : ''} onClick={() => { setSport(s.k); setLimit(40); }}>{s.label}</button>)}</div>
        <div style={{ marginTop: 12 }}><GpxImport /></div>
        {acts.length === 0
          ? <EmptyState icon="activity" title="No activities" body="No workouts match this filter yet." />
          : Object.keys(groups).map((g) => (
            <div key={g} className="fade-in">
              <div className="lbl" style={{ margin: '20px 4px 4px' }}>{g}</div>
              <div className="list">
                {groups[g].map((a, i) => (
                  <div className="arow" key={i} onClick={() => onOpenActivity(a)}>
                    <SportChip sport={a.sport} race={a.race} />
                    <div className="ameta">
                      <div className="aname">{a.name}{a.race && <span style={{ color: 'var(--modify)', marginLeft: 6, fontSize: 12 }}>● PB</span>}</div>
                      <div className="asub">{C().fmtDate(a.date)} · {a.distance} km · {C().fmtDur(a.duration)}</div>
                    </div>
                    <div className="astat"><div>{a.avg_hr}<span className="unit" style={{ fontSize: 10 }}> bpm</span></div><div className="ctx-note" style={{ marginTop: 2 }}>{paceStr(a)}</div></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        {limit < allActs.length && (
          <button className="step-btn" style={{ width: '100%', marginTop: 16, height: 44 }} onClick={() => setLimit((l) => l + 40)}>Load more · {allActs.length - limit} earlier</button>
        )}
      </div>
    </div>
  );
}

function paceStr(a) {
  if (a.sport === 'ride') return Math.round(a.distance / (a.duration / 60)) + ' km/h';
  const pace = a.duration / a.distance; const m = Math.floor(pace), s = Math.round((pace - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

// synthesize HR/elevation series for the session
function sessionSeries(a) {
  const n = 60; const out = []; const rng = (i) => { let x = Math.sin((C().parse(a.date).getDate() * 7 + i) * 12.9898) * 43758.5; return x - Math.floor(x); };
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let base = a.avg_hr;
    // warmup ramp + intervals/surges
    let hr = base - 14 * Math.exp(-t * 6) + (a.name.match(/Interval/) ? 16 * Math.max(0, Math.sin(t * Math.PI * 6)) : 0) + (rng(i) - 0.5) * 5 + t * 6;
    out.push({ v: Math.round(Math.min(a.max_hr, hr)) });
  }
  return out;
}

function ActivityDetail({ a }) {
  const hr = sessionSeries(a);
  const splits = buildSplits(a);
  const head = (
    <div className="sheet-head">
      <div className="row" style={{ gap: 12 }}>
        <SportChip sport={a.sport} race={a.race} />
        <div><div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600 }}>{a.name}</div><div className="ctx-note" style={{ marginTop: 2 }}>{C().fmtDate(a.date, { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      </div>
    </div>
  );
  const body = (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {[['Distance', a.distance + ' km'], ['Time', C().fmtDur(a.duration)], ['Pace', paceStr(a)], ['Elev', a.elevation + ' m'], ['Avg HR', a.avg_hr + ' bpm'], ['Max HR', a.max_hr + ' bpm'], ['Suffer', a.suffer]].map(([k, v]) => (
          <div key={k} style={{ minWidth: 70 }}><div className="ctx-note">{k}</div><div className="mono" style={{ fontSize: 16, marginTop: 3 }}>{v}</div></div>
        ))}
      </div>
      {a.sport !== 'swim' && <RouteCard a={a} />}
      <div className="card" style={{ paddingBottom: 12 }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Heart rate · session</div>
        <LineChart data={hr} height={140} color="var(--m-rhr)" yPad={0.15} fmtY={(t) => Math.round(t)} />
      </div>
      <div className="card">
        <div className="lbl" style={{ marginBottom: 10 }}>Splits</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {splits.map((s, i) => (
            <div key={i} className="row" style={{ gap: 10 }}>
              <span className="mono ctx-note" style={{ width: 24 }}>{s.km}</span>
              <div style={{ flex: 1, height: 18, background: 'var(--track)', borderRadius: 5, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${s.w}%`, background: s.fast ? 'var(--accent)' : 'var(--surface-2)', borderRadius: 5 }} />
              </div>
              <span className="mono" style={{ fontSize: 12, width: 56, textAlign: 'right' }}>{s.pace}</span>
              <span className="mono ctx-note" style={{ width: 40, textAlign: 'right' }}>{s.hr}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  return { head, body };
}

function buildSplits(a) {
  if (a.sport === 'ride') return [];
  const km = Math.floor(a.distance); const basePace = a.duration / a.distance;
  const out = []; let fastest = 99;
  for (let i = 1; i <= km; i++) {
    let x = Math.sin((C().parse(a.date).getDate() + i) * 5.17) * 0.5;
    const p = basePace + x * 0.5 - (i / km) * 0.2;
    fastest = Math.min(fastest, p);
    const m = Math.floor(p), s = Math.round((p - m) * 60);
    out.push({ km: i, pRaw: p, pace: `${m}:${String(s).padStart(2, '0')}`, hr: Math.round(a.avg_hr + x * 8 + (i / km) * 5) });
  }
  const max = Math.max(...out.map((o) => o.pRaw)), min = Math.min(...out.map((o) => o.pRaw));
  out.forEach((o) => { o.w = 100 - ((o.pRaw - min) / (max - min || 1)) * 55; o.fast = o.pRaw <= fastest + 0.05; });
  return out.slice(0, 14);
}

/* ---------- route + Garmin course ---------- */
function RouteCard({ a }) {
  const track = React.useMemo(() => genTrack(trackSeed(a.date + a.name)), [a.date, a.name]);
  const [status, setStatus] = useState('idle'); // idle | creating | done
  const create = () => { setStatus('creating'); setTimeout(() => setStatus('done'), 1100); };
  return (
    <>
      <div className="card" style={{ paddingBottom: 12 }}>
        <div className="row between" style={{ marginBottom: 10 }}><span className="lbl">Route · from GPS</span><span className="ctx-note">{a.distance} km · ↑{a.elevation} m</span></div>
        <RouteMap track={track} />
        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <span className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--go)' }} />start</span>
          <span className="ctx-note" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--back)' }} />finish</span>
        </div>
      </div>
      <div className="card" style={{ borderColor: status === 'done' ? 'color-mix(in oklch, var(--go) 45%, transparent)' : status === 'idle' ? 'var(--accent-line)' : 'var(--hairline-2)' }}>
        {status === 'idle' && (
          <button onClick={create} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <div className="sport-chip" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}><Icon name="hike" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--accent)' }}>Create Garmin route from this GPX</div>
              <div className="ctx-note" style={{ marginTop: 2 }}>Build a course from this track · syncs to your watch</div>
            </div>
            <Icon name="chevR" size={16} style={{ color: 'var(--accent)' }} />
          </button>
        )}
        {status === 'creating' && <div className="row" style={{ gap: 12 }}><div className="sport-chip" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}><Icon name="hike" size={18} /></div><div style={{ flex: 1, fontWeight: 500, fontSize: 14.5, color: 'var(--text-2)' }}>Building course…</div></div>}
        {status === 'done' && (
          <div className="row" style={{ gap: 12 }}>
            <div className="sport-chip" style={{ background: 'var(--go-dim)', color: 'var(--go)' }}><Icon name="check" size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--go)' }}>Route created</div>
              <div className="ctx-note" style={{ marginTop: 2 }}>“{a.name}” · queued to sync to your watch</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- upload your own GPX → Garmin ---------- */
function GpxImport() {
  const [state, setState] = useState('idle'); // idle | uploading | done
  const [name, setName] = useState('');
  const inputRef = useRef(null);
  const pick = () => inputRef.current && inputRef.current.click();
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    setName(f ? f.name : 'route.gpx');
    setState('uploading');
    setTimeout(() => setState('done'), 1200);
  };
  return (
    <div className="card" style={{ borderColor: state === 'done' ? 'color-mix(in oklch, var(--go) 45%, transparent)' : 'var(--accent-line)', marginBottom: 4 }}>
      <input ref={inputRef} type="file" accept=".gpx,.fit" style={{ display: 'none' }} onChange={onFile} />
      {state === 'idle' && (
        <button onClick={pick} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <div className="sport-chip" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}><Icon name="plus" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--accent)' }}>Upload a GPX → push to Garmin</div>
            <div className="ctx-note" style={{ marginTop: 2 }}>Turn any .gpx into a course on your watch</div>
          </div>
          <Icon name="chevR" size={16} style={{ color: 'var(--accent)' }} />
        </button>
      )}
      {state === 'uploading' && <div className="row" style={{ gap: 12 }}><div className="sport-chip" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}><Icon name="layers" size={18} /></div><div style={{ flex: 1, fontWeight: 500, fontSize: 14.5, color: 'var(--text-2)' }}>Pushing {name}…</div></div>}
      {state === 'done' && (
        <div className="row" style={{ gap: 12 }}>
          <div className="sport-chip" style={{ background: 'var(--go-dim)', color: 'var(--go)' }}><Icon name="check" size={18} /></div>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--go)' }}>Pushed to Garmin</div><div className="ctx-note" style={{ marginTop: 2 }}>{name} · available as a course on your watch</div></div>
          <button className="chip" style={{ cursor: 'pointer' }} onClick={() => { setState('idle'); setName(''); }}>another</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Journal ---------- */
const TAGS = ['note', 'race', 'niggle', 'travel', 'illness'];
function Journal({ entries, onAdd, onPick, subjective, onSubj }) {
  const [text, setText] = useState('');
  const [tag, setTag] = useState('note');
  const [filter, setFilter] = useState('all');
  const list = entries.filter((e) => filter === 'all' || e.tag === filter);
  const submit = () => { if (!text.trim()) return; onAdd({ text: text.trim(), tag }); setText(''); };
  return (
    <div className="scroll">
      <div className="topbar"><div><div className="eyebrow">{entries.length} entries · annotates trends</div><h1>Journal</h1></div></div>
      <div className="page jrnl-page" style={{ paddingTop: 0 }}>
        <div className="card" style={{ marginBottom: 12 }}>
          <SubjectiveCheckIn subjective={subjective} onSubj={onSubj} />
        </div>
        <div className="card">
          <div className="compose">
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Quick note — how the session felt, a niggle, travel…" rows={4} />
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {TAGS.map((t) => <button key={t} onClick={() => setTag(t)} className={`chip tag-${t}`} style={{ cursor: 'pointer', opacity: tag === t ? 1 : 0.5, borderWidth: tag === t ? 1.5 : 1 }}><span className="tag-dot" style={{ background: { note: 'var(--text-3)', race: 'var(--modify)', niggle: 'var(--back)', travel: 'var(--accent)', illness: 'var(--back)' }[t] }} />{t}</button>)}
            </div>
            <button className="step-btn" style={{ flex: 'none', padding: '0 16px', height: 38, opacity: text.trim() ? 1 : 0.4 }} onClick={submit}>Add</button>
          </div>
        </div>

        <div className="seg" style={{ marginTop: 14 }}>
          {['all', ...TAGS].map((t) => <button key={t} className={filter === t ? 'on' : ''} onClick={() => setFilter(t)}>{t === 'all' ? 'All' : t}</button>)}
        </div>

        {list.length === 0
          ? <EmptyState icon="journal" title="No entries" body="Nothing tagged here yet. Jot a note above." />
          : <div className="list" style={{ marginTop: 6 }}>
            {list.map((j, i) => (
              <div className="jentry" key={i} onClick={() => onPick(j.date)} style={{ cursor: 'pointer' }}>
                <div className="row" style={{ gap: 8 }}><TagChip tag={j.tag} /><span className="ctx-note" style={{ marginLeft: 'auto' }}>{C().fmtDate(j.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
                <p className="jtext">{j.text}</p>
              </div>
            ))}
          </div>}
      </div>
    </div>
  );
}

Object.assign(window, { Activities, ActivityDetail, Journal, RouteCard, GpxImport, paceStr, sessionSeries, TAGS, SPORTS });
