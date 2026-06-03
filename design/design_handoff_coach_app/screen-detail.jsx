/* screen-detail.jsx — shared Day Detail (bottom sheet content). window.DayDetail */
var C = () => window.COACH;

function MiniStat({ label, value, unit, sub, color }) {
  return (
    <div className="card" style={{ padding: '12px 13px', flex: 1 }}>
      <div className="lbl" style={{ marginBottom: 7 }}>{label}</div>
      <div className="row" style={{ alignItems: 'baseline', gap: 4 }}>
        <span className="big-num mono" style={{ fontSize: 22, color: color || 'var(--text)' }}>{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="ctx-note" style={{ marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function DayDetail({ date, onStep, canPrev, canNext, water, goal, journal }) {
  const d = C().get(date);
  const isToday = date === C().todayISO;
  const jEntries = (journal || C().journal).filter((j) => j.date === date);
  const head = (
    <div className="sheet-head">
      <div>
        <div className="lbl">{isToday ? 'Today' : C().fmtDate(date, { weekday: 'long' })}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600 }}>{C().fmtDate(date, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div className="step-nav">
        <button onClick={() => onStep(-1)} disabled={!canPrev} aria-label="previous day"><Icon name="chevL" size={16} /></button>
        <button onClick={() => onStep(1)} disabled={!canNext} aria-label="next day"><Icon name="chevR" size={16} /></button>
      </div>
    </div>
  );

  let body;
  if (!d || d.missing) {
    body = <EmptyState icon="calendar" title="No data for this day" body="Outside the tracked range — nothing was recorded here." />;
  } else if (d.gap) {
    body = (
      <div className="fade-in">
        {d.activity && <ActivityMini a={d.activity} />}
        <EmptyState icon="moon" title="Watch wasn't worn" body={`No recovery signals synced${d.activity ? ', but a workout was logged manually' : ''}. Readiness can't be estimated without sleep and HRV.`} />
        {jEntries.map((j, i) => <JournalInline key={i} j={j} />)}
      </div>
    );
  } else {
    const fs = d.factors || [];
    body = (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* readiness + factors */}
        <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flexShrink: 0 }}><ReadinessRing value={d.readiness} size={92} stroke={8} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <BandPill value={d.readiness} />
            <div className="ctx-note" style={{ marginTop: 8, lineHeight: 1.5 }}>{C().verdict(d.readiness).head}</div>
          </div>
        </div>
        {fs.length > 0 && <div className="card"><div className="lbl" style={{ marginBottom: 12 }}>Factor breakdown</div><FactorBars factors={fs} /></div>}

        {/* sleep */}
        <div className="card">
          <div className="row between" style={{ marginBottom: 12 }}><span className="lbl"><Icon name="moon" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Sleep</span><span className="ctx-note">score {d.sleep_score}</span></div>
          <div className="row" style={{ gap: 6, alignItems: 'baseline', marginBottom: 12 }}><span className="big-num mono" style={{ fontSize: 24 }}>{Math.floor(d.sleep_hours)}<span className="unit">h</span> {Math.round((d.sleep_hours % 1) * 60)}<span className="unit">m</span></span></div>
          <SleepStages stages={d.sleep_stages} />
        </div>

        {/* signals grid */}
        <div style={{ display: 'flex', gap: 12 }}>
          <MiniStat label="HRV" value={d.hrv} unit="ms" color="var(--m-hrv)" sub={`band ${d.hrv_base_low}–${d.hrv_base_high}`} />
          <MiniStat label="Resting HR" value={d.resting_hr} unit="bpm" color="var(--m-rhr)" sub="overnight low" />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <MiniStat label="Body battery" value={d.body_battery} unit="/100" color="var(--m-batt)" />
          <MiniStat label="Stress" value={d.stress} unit="/100" sub="all-day avg" />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <MiniStat label="ACWR" value={d.acwr.toFixed(2)} color={d.acwr > 1.3 || d.acwr < 0.8 ? 'var(--modify)' : 'var(--go)'} sub={`${d.load_acute} / ${d.load_chronic} load`} />
          <MiniStat label="Steps" value={(d.steps / 1000).toFixed(1)} unit="k" />
        </div>

        {/* activity */}
        {d.activity && <ActivityMini a={d.activity} />}

        {/* subjective */}
        {d.subjective && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 12 }}>Your check-in</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['Energy', d.subjective.energy], ['Soreness', d.subjective.soreness], ['Mood', d.subjective.mood]].map(([k, v]) => (
                <div key={k} style={{ flex: 1, textAlign: 'center' }}>
                  <div className="big-num mono" style={{ fontSize: 22, color: 'var(--accent)' }}>{v}<span className="unit" style={{ fontSize: 11 }}>/5</span></div>
                  <div className="ctx-note" style={{ marginTop: 4 }}>{k}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* hydration (today only realistic) */}
        {isToday && (
          <div className="card">
            <div className="row between"><span className="lbl"><Icon name="drop" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />Hydration</span><span className="ctx-note mono">{(water / 1000).toFixed(2)} / {(goal / 1000).toFixed(1)} L</span></div>
            <div className="ctx-bar" style={{ marginTop: 10 }}><div className="ctx-band" style={{ left: 0, width: `${Math.min(100, (water / goal) * 100)}%`, background: 'var(--accent)' }} /></div>
          </div>
        )}

        {/* journal inline */}
        {jEntries.length > 0 && <div className="card"><div className="lbl" style={{ marginBottom: 4 }}>Journal</div>{jEntries.map((j, i) => <JournalInline key={i} j={j} bare />)}</div>}
      </div>
    );
  }
  return { head, body };
}

function ActivityMini({ a }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12, marginBottom: a.distance ? 12 : 0 }}>
        <SportChip sport={a.sport} race={a.race} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 15 }}>{a.name}</div>
          <div className="ctx-note" style={{ marginTop: 2 }}>{a.race ? 'Race · ' : ''}{a.sport}</div>
        </div>
        {a.suffer != null && <div style={{ textAlign: 'right' }}><div className="big-num mono" style={{ fontSize: 18, color: 'var(--modify)' }}>{a.suffer}</div><div className="ctx-note">suffer</div></div>}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {[['Distance', a.distance + (a.sport === 'ride' ? ' km' : ' km')], ['Time', C().fmtDur(a.duration)], ['Elev', a.elevation + ' m'], ['Avg HR', a.avg_hr + ' bpm']].map(([k, v]) => (
          <div key={k}><div className="ctx-note">{k}</div><div className="mono" style={{ fontSize: 14, marginTop: 2 }}>{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function JournalInline({ j, bare }) {
  const content = (
    <>
      <div className="row" style={{ gap: 8 }}><TagChip tag={j.tag} /><span className="ctx-note" style={{ marginLeft: 'auto' }}>{C().fmtDate(j.date)}</span></div>
      <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{j.text}</p>
    </>
  );
  return bare ? <div style={{ marginTop: 12 }}>{content}</div> : <div className="card" style={{ marginTop: 12 }}>{content}</div>;
}

Object.assign(window, { DayDetail, ActivityMini, JournalInline, MiniStat });
