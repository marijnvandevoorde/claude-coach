import { useMemo, useRef, useState, useEffect } from "react";
import { Icon } from "../components/Icon";
import { Skeleton, EmptyState } from "../components/primitives";
import { metricColor, readinessColor, type MetricKey, type HeatDay } from "../charts/charts";
import { isoOf, parseISO, fmtDate, todayISO, DAY_MIN } from "../lib/coach";
import { api, type CalendarDay, type JournalEntry, type PlannedSession } from "../api";
import { useAsync } from "../lib/useAsync";

const METRICS: { k: MetricKey; label: string }[] = [
  { k: "readiness", label: "Readiness" },
  { k: "load", label: "Load" },
  { k: "sleep", label: "Sleep" },
  { k: "hrv", label: "HRV" },
];

type HeatCell = (HeatDay & { date: string; missing?: boolean }) | null;

function MetricPicker({ value, onChange }: { value: MetricKey; onChange: (m: MetricKey) => void }) {
  return (
    <div className="seg">
      {METRICS.map((m) => (
        <button key={m.k} className={value === m.k ? "on" : ""} onClick={() => onChange(m.k)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

function YearHeatmap({
  metric,
  onPick,
  weeks,
}: {
  metric: MetricKey;
  onPick: (d: string) => void;
  weeks: HeatCell[][];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [weeks]);
  return (
    <div ref={scroller} style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "inline-block", minWidth: "100%" }}>
        <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
          {weeks.map((wk, i) => {
            const first = wk.find((d) => d);
            const showLabel = first && parseISO(first.date).getDate() <= 7;
            return (
              <div
                key={i}
                style={{
                  width: 13,
                  fontSize: 8.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "visible",
                  height: 10,
                }}
              >
                {showLabel ? parseISO(first!.date).toLocaleDateString("en-US", { month: "short" }) : ""}
              </div>
            );
          })}
        </div>
        <div className="cal-grid">
          {weeks.map((wk, i) => (
            <div className="cal-col" key={i}>
              {wk.map((d, j) => {
                if (!d) return <div key={j} className="cal-cell cal-na" />;
                const col = metricColor(metric, d);
                const cls =
                  col === "gap" ? "cal-cell gap" : col === "empty" ? "cal-cell cal-na" : "cal-cell";
                return (
                  <div
                    key={j}
                    className={cls}
                    style={col !== "gap" && col !== "empty" ? { background: col } : undefined}
                    onClick={() => onPick(d.date)}
                    title={fmtDate(d.date)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function readinessTextColor(v: number) {
  return v >= 50 ? "oklch(0.22 0.01 60)" : "oklch(0.20 0.012 40)";
}

const DOT_COLOR: Record<string, string> = {
  note: "var(--text-2)",
  race: "var(--modify)",
  niggle: "var(--back)",
  travel: "var(--accent)",
  illness: "var(--back)",
};

function MonthGrid({
  year,
  month,
  metric,
  onPick,
  byDate,
  journalTags,
  plannedByDate,
}: {
  year: number;
  month: number;
  metric: MetricKey;
  onPick: (d: string) => void;
  byDate: Map<string, HeatCell>;
  journalTags: Map<string, string>;
  plannedByDate: Map<string, PlannedSession[]>;
}) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(dd);
  const today = todayISO();
  const todayDate = parseISO(today);
  return (
    <div>
      <div className="month-strip" style={{ marginBottom: 6 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="ctx-note" style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div className="month-strip">
        {cells.map((dd, i) => {
          if (dd == null) return <div key={i} />;
          const date = isoOf(new Date(year, month, dd));
          const d = byDate.get(date) ?? null;
          const isToday = date === today;
          const future = parseISO(date) > todayDate;
          const planned = plannedByDate.get(date);
          // A planned-session marker: green when pushed to the watch, accent otherwise.
          const plannedMark =
            planned && planned.length > 0 ? (
              <span
                className="pmark"
                title={planned.map((s) => s.name).join(", ")}
                style={{ background: planned.some((s) => s.syncedToGarmin) ? "var(--go)" : "var(--accent)" }}
              />
            ) : null;
          if (future)
            return (
              <div
                key={i}
                className="mcell"
                style={{ opacity: planned ? 0.7 : 0.3 }}
                onClick={() => onPick(date)}
              >
                <span className="mday">{dd}</span>
                {plannedMark}
              </div>
            );
          const col = d ? metricColor(metric, d) : "empty";
          const isGap = !!(d && d.gap);
          const bg = isGap ? undefined : col === "empty" ? "var(--track)" : col;
          const valText = d && !d.gap && metric === "readiness" && d.readiness != null ? d.readiness : "";
          const tag = journalTags.get(date);
          return (
            <div
              key={i}
              className={`mcell ${isGap ? "gap" : ""} ${isToday ? "today-cell" : ""}`}
              style={{ background: bg }}
              onClick={() => onPick(date)}
            >
              <span className="mday" style={{ position: "absolute", top: 4, left: 6 }}>
                {dd}
              </span>
              {tag && <span className="jmark" style={{ background: DOT_COLOR[tag] ?? "var(--text-2)" }} />}
              {valText !== "" && (
                <span style={{ color: readinessTextColor(valText as number), fontWeight: 600 }}>
                  {valText}
                </span>
              )}
              {isGap && <span style={{ fontSize: 9, color: "var(--text-3)" }}>—</span>}
              {plannedMark}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ metric }: { metric: MetricKey }) {
  const sample = (a: number): HeatDay => {
    if (metric === "load") return { readiness: null, load: a * 160, sleep: null, hrv: null, gap: false };
    if (metric === "sleep") return { readiness: null, load: null, sleep: 40 + a * 55, hrv: null, gap: false };
    return { readiness: null, load: null, sleep: null, hrv: 40 + a * 50, gap: false };
  };
  const samples: [string, string][] =
    metric === "readiness"
      ? [
          ["low", readinessColor(20)],
          ["", readinessColor(45)],
          ["", readinessColor(60)],
          ["", readinessColor(72)],
          ["high", readinessColor(88)],
        ]
      : [
          ["less", metricColor(metric, sample(0.15))],
          ["", metricColor(metric, sample(0.45))],
          ["", metricColor(metric, sample(0.7))],
          ["more", metricColor(metric, sample(1))],
        ];
  return (
    <div className="row" style={{ gap: 4, marginTop: 12, alignItems: "center" }}>
      <span className="ctx-note" style={{ marginRight: 4 }}>
        {samples[0][0]}
      </span>
      {samples.map((s, i) => (
        <span key={i} style={{ width: 13, height: 13, borderRadius: 3, background: s[1] }} />
      ))}
      <span className="ctx-note" style={{ marginLeft: 4 }}>
        {samples[samples.length - 1][0]}
      </span>
      <span className="cal-cell gap" style={{ marginLeft: 10 }} />
      <span className="ctx-note">no watch</span>
    </div>
  );
}

export function Calendar({
  metric,
  onMetric,
  onPick,
}: {
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  onPick: (d: string) => void;
}) {
  const today = todayISO();
  const todayDate = parseISO(today);
  const [cursor, setCursor] = useState({ y: todayDate.getFullYear(), m: todayDate.getMonth() });

  // ~14 months back
  const from = useMemo(() => {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - 60 * 7);
    return isoOf(d);
  }, [today]);

  const { data, loading, error } = useAsync(
    () =>
      Promise.all([
        api.calendar({ from, to: today }),
        api.journal({ since: from, until: today, limit: 2000 }),
        api.planSessions(),
      ]),
    [from, today]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, HeatCell>();
    (data?.[0] ?? []).forEach((c: CalendarDay) => {
      m.set(c.date, {
        date: c.date,
        readiness: c.readiness,
        load: c.load,
        sleep: c.sleep,
        hrv: c.hrv,
        gap: c.gap,
      });
    });
    return m;
  }, [data]);

  const journalTags = useMemo(() => {
    const m = new Map<string, string>();
    (data?.[1] ?? []).forEach((j: JournalEntry) => {
      if (j.tag && !m.has(j.local_date)) m.set(j.local_date, j.tag);
    });
    return m;
  }, [data]);

  // Planned sessions by date (active plan) → markers in the month grid.
  const plannedByDate = useMemo(() => {
    const m = new Map<string, PlannedSession[]>();
    (data?.[2]?.sessions ?? []).forEach((s: PlannedSession) => {
      (m.get(s.date) ?? m.set(s.date, []).get(s.date)!).push(s);
    });
    return m;
  }, [data]);

  // build week columns for the heatmap
  const weeks = useMemo<HeatCell[][]>(() => {
    const end = new Date(todayDate);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const start = new Date(end);
    start.setDate(start.getDate() - 60 * 7 + 1);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
    const out: HeatCell[][] = [];
    const cur = new Date(start);
    while (cur <= end) {
      const wk: HeatCell[] = [];
      for (let i = 0; i < 7; i++) {
        const ds = isoOf(cur);
        if (cur > todayDate) wk.push(null);
        else wk.push(byDate.get(ds) ?? { date: ds, readiness: null, load: null, sleep: null, hrv: null, gap: false, missing: true });
        cur.setDate(cur.getDate() + 1);
      }
      out.push(wk);
    }
    return out;
  }, [byDate, today]);

  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const canNext = !(cursor.y === todayDate.getFullYear() && cursor.m === todayDate.getMonth());
  const canPrev = !(cursor.y === parseISO(DAY_MIN).getFullYear() && cursor.m === 0);
  const step = (delta: number) =>
    setCursor((c) => {
      let m = c.m + delta;
      let y = c.y;
      if (m < 0) {
        m = 11;
        y--;
      }
      if (m > 11) {
        m = 0;
        y++;
      }
      return { y, m };
    });

  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <div className="eyebrow">2021 → today · ~1,900 days</div>
          <h1>Calendar</h1>
        </div>
      </div>
      <div className="page cal-page" style={{ paddingTop: 0 }}>
        <MetricPicker value={metric} onChange={onMetric} />

        <div className="card fade-in" style={{ marginTop: 12, paddingBottom: 10 }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="lbl">Last 14 months</span>
            <span className="ctx-note">tap any day</span>
          </div>
          {loading ? (
            <Skeleton h={120} />
          ) : error ? (
            <EmptyState icon="info" title="Couldn't load calendar" body={error} />
          ) : (
            <>
              <YearHeatmap metric={metric} onPick={onPick} weeks={weeks} />
              <Legend metric={metric} />
            </>
          )}
        </div>

        <div className="card fade-in" style={{ marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>
              {monthName}
            </span>
            <div className="step-nav">
              <button onClick={() => step(-1)} disabled={!canPrev} aria-label="previous month">
                <Icon name="chevL" size={16} />
              </button>
              <button onClick={() => step(1)} disabled={!canNext} aria-label="next month">
                <Icon name="chevR" size={16} />
              </button>
            </div>
          </div>
          <MonthGrid
            year={cursor.y}
            month={cursor.m}
            metric={metric}
            onPick={onPick}
            byDate={byDate}
            journalTags={journalTags}
            plannedByDate={plannedByDate}
          />
          <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            {["race", "niggle", "travel", "note"].map((t) => (
              <span
                key={t}
                className="ctx-note"
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT_COLOR[t] }} />
                {t}
              </span>
            ))}
            <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
              planned
            </span>
            <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--go)" }} />
              on watch
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
