/* app.jsx — root: phone shell, routing, quick-action state, sheets, tweaks. */
var C = () => window.COACH;
const { useState: uS, useEffect: uE, useRef: uR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "scheme": "lagoon",
  "layout": "auto",
  "todayState": "populated",
  "waterGoal": 2.5
}/*EDITMODE-END*/;

const SCHEMES = [
  { k: 'lagoon', label: 'Lagoon' },
  { k: 'pop', label: 'Pop' },
  { k: 'savanna', label: 'Savanna' },
  { k: 'neon', label: 'Neon' },
  { k: 'sunset', label: 'Sunset' },
  { k: 'calm', label: 'Calm' },
];

const SCHEME_PREVIEW = {
  lagoon: ['#1ba3b0', '#ef6351', '#f7c59f', '#0081a7'],
  pop: ['#8b3dff', '#3a86ff', '#ff2d9e', '#37d67a'],
  savanna: ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  neon: ['#1fe0c8', '#3dff7e', '#ffe23d', '#ff2d9e'],
  sunset: ['#e85d3b', '#f4a93a', '#e0245e', '#8a1538'],
  calm: ['#5f9ea0', '#c98b6b', '#8aa98f', '#e0c389'],
};
function SchemeSwatches({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 0 4px' }}>
      {SCHEMES.map((s) => (
        <button key={s.k} onClick={() => onChange(s.k)} style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '6px 8px', borderRadius: 10, background: value === s.k ? 'rgba(127,127,127,0.16)' : 'transparent',
          border: value === s.k ? '1px solid rgba(127,127,127,0.4)' : '1px solid transparent', width: '100%', textAlign: 'left',
        }}>
          <span style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }}>
            {SCHEME_PREVIEW[s.k].map((c, i) => <span key={i} style={{ width: 16, height: 16, background: c }} />)}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: value === s.k ? 600 : 400, color: 'inherit' }}>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function LoadingToday() {
  return (
    <div className="scroll">
      <div className="topbar"><div><Skeleton h={11} w={120} /><div style={{ height: 8 }} /><Skeleton h={26} w={90} /></div></div>
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 26 }}>
          <div className="skel" style={{ width: 168, height: 168, borderRadius: '50%' }} />
          <Skeleton h={18} w={160} /><Skeleton h={13} w={220} />
        </div>
        <div className="card"><Skeleton h={13} w={110} /><div style={{ height: 14 }} /><Skeleton h={40} /></div>
        <div className="tiles" style={{ marginTop: 12 }}>{[0, 1, 2, 3].map((i) => <div className="tile" key={i}><Skeleton h={13} w={70} /><Skeleton h={26} w={50} /><Skeleton h={6} /></div>)}</div>
      </div>
    </div>
  );
}

function EmptyToday({ theme, onToggleTheme, water, goal, onWater }) {
  return (
    <div className="scroll">
      <div className="topbar"><div><div className="eyebrow">{C().fmtDate(C().todayISO, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>Today</h1></div>
        <button className="icon-btn" onClick={onToggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button></div>
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="card hero" style={{ padding: '30px 16px' }}>
          <ReadinessRing value={null} />
          <div className="verdict-head" style={{ marginTop: 18 }}>Waiting on your watch</div>
          <div className="verdict-sub">No sleep or HRV synced yet today, so readiness can't be estimated. It usually lands a few minutes after you wake and sync.</div>
        </div>
        <EmptyState icon="pulse" title="Recovery signals pending" body="Sync your Garmin to reconstruct today's score. You can still log water and a check-in below." />
        <div style={{ marginTop: 4 }}><QuickAdd water={water} goal={goal} onWater={onWater} /></div>
      </div>
    </div>
  );
}

function Sidebar({ active, onChange, theme, onToggleTheme, today }) {
  const band = C().band(today.readiness);
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="brand-mark">C</div>
        <div><div className="brand-name">Coach</div><div className="brand-sub">small victories</div></div>
      </div>
      <nav className="side-nav">
        {TABS.map((tb) => (
          <button key={tb.id} className={`side-link ${active === tb.id ? 'on' : ''}`} onClick={() => onChange(tb.id)}>
            <Icon name={tb.icon} size={19} sw={active === tb.id ? 2 : 1.6} /><span>{tb.label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="side-ready">
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: band.color }} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>Readiness {today.readiness} · {band.label}</span>
        </div>
        <button className="side-link" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} /><span>{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
        </button>
      </div>
    </aside>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = uS('today');
  const [mountLoading, setMountLoading] = uS(true);
  const [metric, setMetric] = uS('readiness');
  const [win, setWin] = uS(42);
  const [daySheet, setDaySheet] = uS(null);
  const [activity, setActivity] = uS(null);
  const [journal, setJournal] = uS(() => C().journal.slice());

  const today = C().today();
  const goal = Math.round((t.waterGoal || 2.5) * 1000);
  const [water, setWater] = uS(1450);
  const [subjective, setSubjective] = uS(() => today.subjective || {});

  // toast / undo
  const [toast, setToast] = uS(null);
  const batchBase = uR(null); const batchTotal = uR(0); const timer = uR(null);

  uE(() => { const id = setTimeout(() => setMountLoading(false), 850); return () => clearTimeout(id); }, []);

  const [vw, setVw] = uS(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  uE(() => { const on = () => setVw(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const wide = t.layout === 'desktop' || (t.layout !== 'phone' && vw >= 900);

  const recent = C().lastN(30);

  function addWater(amt) {
    if (batchBase.current == null) batchBase.current = water;
    batchTotal.current += amt;
    setWater((w) => Math.min(goal * 2, w + amt));
    const base = batchBase.current, total = batchTotal.current;
    setToast({ id: Date.now(), text: `+${total} ml water logged`, base });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setToast(null); batchBase.current = null; batchTotal.current = 0; }, 5000);
  }
  function undoWater() {
    if (toast) setWater(toast.base);
    clearTimeout(timer.current); setToast(null); batchBase.current = null; batchTotal.current = 0;
  }
  function onSubj(k, v) { setSubjective((s) => ({ ...s, [k]: s[k] === v ? undefined : v })); }

  function openDay(date) { setDaySheet(date); }
  function stepDay(delta) {
    if (!daySheet) return;
    const d = new Date(C().parse(daySheet)); d.setDate(d.getDate() + delta);
    setDaySheet(C().iso(d));
  }
  const dayMin = '2021-01-01';
  const canPrev = daySheet && daySheet > dayMin;
  const canNext = daySheet && daySheet < C().todayISO;

  function addNote({ text, tag }) {
    setJournal((j) => [{ date: C().todayISO, text, tag }, ...j]);
    setToast({ id: Date.now(), text: 'Journal note added', base: null, noUndo: true });
    clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 4000);
  }

  // theme owns neutrals; scheme owns accent + readiness bands (CSS)
  const screenStyle = {};

  const loadingToday = tab === 'today' && (mountLoading || t.todayState === 'loading');
  const emptyToday = tab === 'today' && t.todayState === 'empty' && !mountLoading;

  let screen;
  if (tab === 'today') {
    screen = loadingToday ? <LoadingToday />
      : emptyToday ? <EmptyToday theme={t.theme} onToggleTheme={() => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark')} water={water} goal={goal} onWater={addWater} />
      : <Dashboard day={{ ...today, subjective: Object.keys(subjective).length ? subjective : today.subjective }} recent={recent} water={water} goal={goal} onWater={addWater} onOpenDay={openDay} theme={t.theme} onToggleTheme={() => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark')} />;
  } else if (tab === 'calendar') screen = <Calendar metric={metric} onMetric={setMetric} onPick={openDay} />;
  else if (tab === 'trends') screen = <Trends win={win} onWin={setWin} onPick={openDay} />;
  else if (tab === 'activities') screen = <Activities onOpenActivity={setActivity} />;
  else if (tab === 'journal') screen = <Journal entries={journal} onAdd={addNote} onPick={openDay} subjective={subjective} onSubj={onSubj} />;

  const dd = daySheet ? DayDetail({ date: daySheet, onStep: stepDay, canPrev, canNext, water, goal, journal }) : null;
  const ad = activity ? ActivityDetail({ a: activity }) : null;
  const toggleTheme = () => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark');

  const overlays = (
    <>
      <Sheet open={!!daySheet} onClose={() => setDaySheet(null)} head={dd && dd.head}>{dd && dd.body}</Sheet>
      <Sheet open={!!activity} onClose={() => setActivity(null)} head={ad && ad.head}>{ad && ad.body}</Sheet>
      <UndoToast toast={toast && !toast.noUndo ? toast : null} onUndo={undoWater} />
      {toast && toast.noUndo && <div className="toast-wrap"><div className="toast"><Icon name="check" size={16} style={{ color: 'var(--go)' }} /><span className="tx">{toast.text}</span></div></div>}
    </>
  );

  const tweaks = (
    <TweaksPanel>
      <TweakSection label="Appearance" />
      <TweakRadio label="Mode" value={t.theme} options={['light', 'dark']} onChange={(v) => setTweak('theme', v)} />
      <TweakRadio label="Layout" value={t.layout} options={['auto', 'phone', 'desktop']} onChange={(v) => setTweak('layout', v)} />
      <TweakSection label="Palette" />
      <SchemeSwatches value={t.scheme} onChange={(v) => setTweak('scheme', v)} />
      <TweakSection label="Demo data" />
      <TweakRadio label="Today's state" value={t.todayState} options={['populated', 'loading', 'empty']} onChange={(v) => setTweak('todayState', v)} />
      <TweakSlider label="Water goal" value={t.waterGoal} min={1.5} max={4} step={0.1} unit=" L" onChange={(v) => setTweak('waterGoal', v)} />
    </TweaksPanel>
  );

  if (wide) {
    return (
      <div className="desktop" data-theme={t.theme} data-scheme={t.scheme}>
        <Sidebar active={tab} onChange={setTab} theme={t.theme} onToggleTheme={toggleTheme} today={today} />
        <main className="desktop-main">{screen}</main>
        {overlays}
        {tweaks}
      </div>
    );
  }

  return (
    <div className="phone">
      <div className="island" />
      <div className="phone-screen" data-theme={t.theme} data-scheme={t.scheme} style={screenStyle}>
        <StatusBar />
        <div className="app">
          {screen}
          <TabBar active={tab} onChange={(x) => { setTab(x); }} />
          {overlays}
        </div>
        {tweaks}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
