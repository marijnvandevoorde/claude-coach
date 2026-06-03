import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { ReadinessRing, BandPill, FactorBars, EmptyState, Skeleton, TagChip, Sheet } from "../components/primitives";
import { SleepStageBar } from "./Dashboard";
import { fmtDate, verdict } from "../lib/coach";
import { api, type JournalEntry } from "../api";
import { adaptSummary, type DayView } from "../lib/adapt";
import { useAsync } from "../lib/useAsync";

function MiniStat({
  label,
  value,
  unit,
  sub,
  color,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: "12px 13px", flex: 1 }}>
      <div className="lbl" style={{ marginBottom: 7 }}>
        {label}
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 4 }}>
        <span className="big-num mono" style={{ fontSize: 22, color: color || "var(--text)" }}>
          {value}
        </span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && (
        <div className="ctx-note" style={{ marginTop: 5 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function JournalInline({ j, bare }: { j: JournalEntry; bare?: boolean }) {
  const content = (
    <>
      <div className="row" style={{ gap: 8 }}>
        <TagChip tag={j.tag} />
        <span className="ctx-note" style={{ marginLeft: "auto" }}>
          {fmtDate(j.local_date)}
        </span>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5, textWrap: "pretty" }}>{j.entry}</p>
    </>
  );
  return bare ? (
    <div style={{ marginTop: 12 }}>{content}</div>
  ) : (
    <div className="card" style={{ marginTop: 12 }}>
      {content}
    </div>
  );
}

export function useDayDetail({
  date,
  onStep,
  canPrev,
  canNext,
  water,
  goal,
  todayISO,
}: {
  date: string;
  onStep: (delta: number) => void;
  canPrev: boolean;
  canNext: boolean;
  water: number;
  goal: number;
  todayISO: string;
}): { head: ReactNode; body: ReactNode } {
  const isToday = date === todayISO;
  const { data, loading, error } = useAsync(
    () => Promise.all([api.summary(date), api.journal({ since: date, until: date, limit: 50 })]),
    [date]
  );
  const day: DayView | null = data ? adaptSummary(data[0]) : null;
  const jEntries: JournalEntry[] = data ? data[1] : [];

  const head = (
    <div className="sheet-head">
      <div>
        <div className="lbl">{isToday ? "Today" : fmtDate(date, { weekday: "long" })}</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>
          {fmtDate(date, { month: "long", day: "numeric", year: "numeric" })}
        </div>
      </div>
      <div className="step-nav">
        <button onClick={() => onStep(-1)} disabled={!canPrev} aria-label="previous day">
          <Icon name="chevL" size={16} />
        </button>
        <button onClick={() => onStep(1)} disabled={!canNext} aria-label="next day">
          <Icon name="chevR" size={16} />
        </button>
      </div>
    </div>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton h={120} />
        <Skeleton h={90} />
        <Skeleton h={70} />
      </div>
    );
  } else if (error) {
    body = <EmptyState icon="info" title="Couldn't load this day" body={error} />;
  } else if (!day || (day.readiness == null && !day.hasData && jEntries.length === 0)) {
    body = (
      <EmptyState
        icon="calendar"
        title="No data for this day"
        body="Nothing was recorded here — no watch sync, activity, or journal note."
      />
    );
  } else if (day.readiness == null && day.sleep_hours == null && day.hrv == null) {
    body = (
      <div className="fade-in">
        <EmptyState
          icon="moon"
          title="Watch wasn't worn"
          body="No recovery signals synced. Readiness can't be estimated without sleep and HRV."
        />
        {jEntries.map((j) => (
          <JournalInline key={j.id} j={j} />
        ))}
      </div>
    );
  } else {
    const fs = day.factors;
    body = (
      <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ flexShrink: 0 }}>
            <ReadinessRing value={day.readiness} size={92} stroke={8} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <BandPill value={day.readiness} />
            <div className="ctx-note" style={{ marginTop: 8, lineHeight: 1.5 }}>
              {verdict(day.readiness).head}
            </div>
          </div>
        </div>

        {fs.length > 0 && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 12 }}>
              Factor breakdown
            </div>
            <FactorBars factors={fs} />
          </div>
        )}

        {day.sleep_hours != null && (
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="lbl">
                <Icon name="moon" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Sleep
              </span>
              {day.sleep_score != null && <span className="ctx-note">score {day.sleep_score}</span>}
            </div>
            <div className="row" style={{ gap: 6, alignItems: "baseline", marginBottom: 12 }}>
              <span className="big-num mono" style={{ fontSize: 24 }}>
                {Math.floor(day.sleep_hours)}
                <span className="unit">h</span> {Math.round((day.sleep_hours % 1) * 60)}
                <span className="unit">m</span>
              </span>
            </div>
            {day.sleep_stages && <SleepStageBar stages={day.sleep_stages} />}
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <MiniStat
            label="HRV"
            value={day.hrv ?? "—"}
            unit={day.hrv != null ? "ms" : undefined}
            color="var(--m-hrv)"
            sub={
              day.hrv_base_low != null && day.hrv_base_high != null
                ? `band ${day.hrv_base_low}–${day.hrv_base_high}`
                : undefined
            }
          />
          <MiniStat
            label="Resting HR"
            value={day.resting_hr ?? "—"}
            unit={day.resting_hr != null ? "bpm" : undefined}
            color="var(--m-rhr)"
            sub="overnight low"
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <MiniStat
            label="Body battery"
            value={day.body_battery ?? "—"}
            unit={day.body_battery != null ? "/100" : undefined}
            color="var(--m-batt)"
          />
          <MiniStat
            label="Stress"
            value={day.stress ?? "—"}
            unit={day.stress != null ? "/100" : undefined}
            sub="all-day avg"
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <MiniStat
            label="ACWR"
            value={day.acwr != null ? day.acwr.toFixed(2) : "—"}
            color={
              day.acwr != null && (day.acwr > 1.3 || day.acwr < 0.8) ? "var(--modify)" : "var(--go)"
            }
            sub={
              day.load_acute != null && day.load_chronic != null
                ? `${day.load_acute} / ${day.load_chronic} load`
                : undefined
            }
          />
          <MiniStat
            label="Steps"
            value={day.steps != null ? (day.steps / 1000).toFixed(1) : "—"}
            unit={day.steps != null ? "k" : undefined}
          />
        </div>

        {day.subjective && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 12 }}>
              Your check-in
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {(
                [
                  ["Energy", day.subjective.energy],
                  ["Soreness", day.subjective.soreness],
                  ["Mood", day.subjective.mood],
                ] as [string, number | undefined][]
              )
                .filter(([, val]) => val != null)
                .map(([k, val]) => (
                  <div key={k} style={{ flex: 1, textAlign: "center" }}>
                    <div className="big-num mono" style={{ fontSize: 22, color: "var(--accent)" }}>
                      {val}
                      <span className="unit" style={{ fontSize: 11 }}>
                        /5
                      </span>
                    </div>
                    <div className="ctx-note" style={{ marginTop: 4 }}>
                      {k}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {isToday && (
          <div className="card">
            <div className="row between">
              <span className="lbl">
                <Icon name="drop" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Hydration
              </span>
              <span className="ctx-note mono">
                {(water / 1000).toFixed(2)} / {(goal / 1000).toFixed(1)} L
              </span>
            </div>
            <div className="ctx-bar" style={{ marginTop: 10 }}>
              <div
                className="ctx-band"
                style={{
                  left: 0,
                  width: `${goal > 0 ? Math.min(100, (water / goal) * 100) : 0}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          </div>
        )}

        {jEntries.length > 0 && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 4 }}>
              Journal
            </div>
            {jEntries.map((j) => (
              <JournalInline key={j.id} j={j} bare />
            ))}
          </div>
        )}
      </div>
    );
  }

  return { head, body };
}

// Inner component so the data hook only runs while a date is selected.
function DayDetailInner(props: {
  date: string;
  open: boolean;
  onStep: (delta: number) => void;
  canPrev: boolean;
  canNext: boolean;
  water: number;
  goal: number;
  todayISO: string;
  onClose: () => void;
}) {
  const { head, body } = useDayDetail(props);
  return (
    <Sheet open={props.open} onClose={props.onClose} head={head}>
      {body}
    </Sheet>
  );
}

// Keeps the last date during the close transition so the drawer animates out.
export function DaySheet({
  date,
  onClose,
  onStep,
  canPrev,
  canNext,
  water,
  goal,
  todayISO,
}: {
  date: string | null;
  onClose: () => void;
  onStep: (delta: number) => void;
  canPrev: boolean;
  canNext: boolean;
  water: number;
  goal: number;
  todayISO: string;
}) {
  const last = useRef<string | null>(date);
  const cleared = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (date) {
    last.current = date;
    if (cleared.current) {
      clearTimeout(cleared.current);
      cleared.current = null;
    }
  }
  useEffect(() => {
    if (!date && last.current) {
      cleared.current = setTimeout(() => {
        last.current = null;
      }, 360);
    }
  }, [date]);
  const shown = date ?? last.current;
  if (!shown) return null;
  return (
    <DayDetailInner
      date={shown}
      open={!!date}
      onStep={onStep}
      canPrev={canPrev}
      canNext={canNext}
      water={water}
      goal={goal}
      todayISO={todayISO}
      onClose={onClose}
    />
  );
}
