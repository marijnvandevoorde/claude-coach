import { useMemo, type ReactNode } from "react";
import {
  LineChart,
  ACWRGauge,
  VolumeBars,
  type Annotation,
  type BandPoint,
} from "../charts/charts";
import { Skeleton, EmptyState } from "../components/primitives";
import { api, type JournalEntry } from "../api";
import { useAsync } from "../lib/useAsync";
import {
  adaptTrendSeries,
  adaptWeeklyVolume,
  type TrendPoint,
  type WeeklyVolume,
} from "../lib/adapt";

const WINDOWS = [
  { k: 7, label: "7 days" },
  { k: 42, label: "6 weeks" },
  { k: 120, label: "Season" },
];

const ANN_COLOR: Record<string, string> = {
  race: "var(--modify)",
  niggle: "var(--back)",
  illness: "var(--back)",
  travel: "var(--accent)",
  note: "var(--text-3)",
};

function ChartCard({
  title,
  sub,
  children,
  screenReader,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  screenReader?: string;
}) {
  return (
    <div className="card fade-in" style={{ paddingBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="lbl">{title}</span>
        {sub && <span className="ctx-note">{sub}</span>}
      </div>
      {screenReader && (
        <span
          className="sr-only"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
          }}
        >
          {screenReader}
        </span>
      )}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function ZoneLegend() {
  return (
    <div className="row" style={{ gap: 14, marginTop: 8 }}>
      {[
        ["Go", "var(--go)"],
        ["Modify", "var(--modify)"],
        ["Back off", "var(--back)"],
      ].map(([l, c]) => (
        <span
          key={l}
          className="ctx-note"
          style={{ display: "flex", alignItems: "center", gap: 5 }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function avg(arr: (number | null)[]): number | string {
  const v = arr.filter((x): x is number => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : "—";
}
function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

export function Trends({ win, onWin }: { win: number; onWin: (w: number) => void }) {
  const { data, loading, error } = useAsync(() => api.trends(win), [win]);

  const series: TrendPoint[] = useMemo(() => (data ? adaptTrendSeries(data) : []), [data]);
  const weeks: WeeklyVolume[] = useMemo(() => (data ? adaptWeeklyVolume(data) : []), [data]);

  // journal annotations within the window
  const jState = useAsync(() => {
    if (!series.length) return Promise.resolve<JournalEntry[]>([]);
    const since = series[0].date;
    const until = series[series.length - 1].date;
    return api.journal({ since, until, limit: 500 });
  }, [series.length ? series[0].date : null, series.length]);

  const anns: Annotation[] = useMemo(() => {
    if (!series.length || !jState.data) return [];
    const idx = new Map<string, number>();
    series.forEach((d, i) => idx.set(d.date, i));
    return jState.data
      .filter((j) => idx.has(j.local_date))
      .map((j) => ({ i: idx.get(j.local_date)!, color: ANN_COLOR[j.tag ?? "note"] }));
  }, [series, jState.data]);

  if (loading) {
    return (
      <div className="scroll">
        <div className="topbar">
          <div>
            <div className="eyebrow">Trends · journal woven in</div>
            <h1>Trends</h1>
          </div>
        </div>
        <div className="page trends-page" style={{ paddingTop: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div className="card" key={i}>
                <Skeleton h={13} w={90} />
                <div style={{ height: 12 }} />
                <Skeleton h={140} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !series.length) {
    return (
      <div className="scroll">
        <div className="topbar">
          <div>
            <div className="eyebrow">Trends · journal woven in</div>
            <h1>Trends</h1>
          </div>
        </div>
        <div className="page trends-page" style={{ paddingTop: 0 }}>
          <EmptyState
            icon="trends"
            title={error ? "Couldn't load trends" : "No trend data"}
            body={error ?? "No recovery data in this window yet."}
          />
        </div>
      </div>
    );
  }

  const readinessData = series.map((d) => ({ date: d.date, v: d.readiness }));
  const hrvData = series.map((d) => ({ date: d.date, v: d.hrv }));
  const hrvBand: (BandPoint | null)[] = series.map((d) =>
    d.hrv_base_low != null && d.hrv_base_high != null
      ? { low: d.hrv_base_low, high: d.hrv_base_high }
      : null
  );
  const acuteLine = series.map((d) => ({ date: d.date, v: d.load_acute }));
  const chronicLine = series.map((d) => d.load_chronic);

  const avgReady = avg(readinessData.map((d) => d.v));
  const latestHrv = lastNonNull(hrvData.map((d) => d.v));
  const latestAcwr = lastNonNull(series.map((d) => d.acwr));

  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <div className="eyebrow">Trends · journal woven in</div>
          <h1>Trends</h1>
        </div>
      </div>
      <div className="page trends-page" style={{ paddingTop: 0 }}>
        <div className="seg">
          {WINDOWS.map((wd) => (
            <button key={wd.k} className={win === wd.k ? "on" : ""} onClick={() => onWin(wd.k)}>
              {wd.label}
            </button>
          ))}
        </div>

        <ChartCard
          title="Readiness"
          sub={`avg ${avgReady}`}
          screenReader={`Readiness over ${win} days, averaging ${avgReady} out of 100.`}
        >
          <LineChart
            data={readinessData}
            height={156}
            color="var(--accent)"
            annotations={anns}
            yPad={0.05}
            seriesLabel="readiness"
            unit=" / 100"
            hbands={[
              { from: 67, to: 100, color: "var(--go)", opacity: 0.07 },
              { from: 40, to: 67, color: "var(--modify)", opacity: 0.07 },
              { from: 0, to: 40, color: "var(--back)", opacity: 0.07 },
            ]}
          />
          <ZoneLegend />
        </ChartCard>

        <ChartCard
          title="HRV vs baseline band"
          sub={latestHrv != null ? `${latestHrv} ms` : "—"}
          screenReader="Heart-rate variability plotted against its rolling baseline band."
        >
          <LineChart
            data={hrvData}
            height={150}
            color="var(--m-hrv)"
            band={hrvBand}
            annotations={anns}
            fmtY={(t) => Math.round(t)}
            seriesLabel="HRV"
            unit=" ms"
          />
          <div className="ctx-note" style={{ marginTop: 6 }}>
            Shaded = your normal range. Below the band = under-recovered.
          </div>
        </ChartCard>

        <ChartCard
          title="Acute vs chronic load"
          sub={`ACWR ${latestAcwr != null ? latestAcwr.toFixed(2) : "—"}`}
          screenReader="Acute 7-day load versus chronic 28-day load."
        >
          <LineChart
            data={acuteLine}
            line2={chronicLine}
            height={150}
            color="var(--accent)"
            area={false}
            annotations={anns}
            fmtY={(t) => Math.round(t)}
            seriesLabel="acute 7d"
            line2Label="chronic 28d"
          />
          <div className="row" style={{ gap: 14, marginTop: 6 }}>
            <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 2, background: "var(--accent)" }} />
              acute (7d)
            </span>
            <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 0, borderTop: "2px dashed var(--text-3)" }} />
              chronic (28d)
            </span>
          </div>
        </ChartCard>

        <ChartCard
          title="ACWR sweet-spot"
          sub="acute : chronic"
          screenReader={`Current acute-to-chronic workload ratio is ${
            latestAcwr != null ? latestAcwr.toFixed(2) : "unknown"
          }.`}
        >
          <ACWRGauge value={latestAcwr ?? 1} />
          <div className="ctx-note" style={{ marginTop: 2 }}>
            0.8–1.3 balances fitness gain against injury risk.
          </div>
        </ChartCard>

        <ChartCard
          title="Weekly volume"
          sub="training hours"
          screenReader="Training hours per week."
        >
          {weeks.length ? (
            <VolumeBars data={weeks} height={120} />
          ) : (
            <div className="ctx-note">No volume recorded.</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
