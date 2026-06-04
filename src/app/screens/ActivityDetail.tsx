import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { SportChip, Skeleton, EmptyState, Sheet } from "../components/primitives";
import { LineChart, RouteMap } from "../charts/charts";
import { fmtDate, fmtDur } from "../lib/coach";
import { api } from "../api";
import { adaptActivityDetail, type ActivityDetailView } from "../lib/adapt";
import { useAsync } from "../lib/useAsync";
import { paceStr } from "./Activities";

// A rendered split row, derived from real Garmin lap data.
interface SplitRow {
  idx: number;
  label: string; // distance, e.g. "1.0 km"
  pace: string; // m:ss /km
  hr: number | null;
  w: number; // bar width %
  shade: number; // 0..1, 1 = fastest → deepest green
}

const fmtPace = (secPerKm: number): string => {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// Map the real per-split data to rendered rows (fastest split highlighted).
function buildSplits(a: ActivityDetailView): SplitRow[] {
  const splits = a.splits.filter((s) => s.paceSecPerKm != null && s.paceSecPerKm > 0);
  if (splits.length === 0) return [];
  const paces = splits.map((s) => s.paceSecPerKm as number);
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  return splits.map((s) => {
    const pace = s.paceSecPerKm as number;
    return {
      idx: s.idx,
      label: `${(s.distanceM / 1000).toFixed(s.distanceM >= 1000 ? 1 : 2)} km`,
      pace: fmtPace(pace),
      hr: s.avgHr,
      // Faster (lower s/km) → longer bar + deeper green.
      w: 100 - ((pace - min) / (max - min || 1)) * 55,
      shade: 1 - (pace - min) / (max - min || 1),
    };
  });
}

// Only rendered for activities that have a real GPS track (gated at the call
// site) — no synthetic/"approx" routes.
function RouteCard({ a }: { a: ActivityDetailView }) {
  const track = a.track ?? [];
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const create = async () => {
    setStatus("creating");
    setErrMsg(null);
    try {
      await api.courseFromActivity(a.id, { name: `${a.name} (from activity)` });
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Couldn't create route.");
    }
  };
  return (
    <>
      <div className="card" style={{ paddingBottom: 12 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="lbl">Route · from GPS</span>
          <span className="ctx-note">
            {a.distanceKm} km{a.elevation != null ? ` · ↑${a.elevation} m` : ""}
          </span>
        </div>
        <RouteMap track={track} />
        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--go)" }} />
            start
          </span>
          <span className="ctx-note" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--back)" }} />
            finish
          </span>
        </div>
      </div>
      <div
        className="card"
        style={{
          borderColor:
            status === "done"
              ? "color-mix(in oklch, var(--go) 45%, transparent)"
              : status === "error"
                ? "color-mix(in oklch, var(--back) 45%, transparent)"
                : status === "idle"
                  ? "var(--accent-line)"
                  : "var(--hairline-2)",
        }}
      >
        {status === "idle" && (
          <button
            onClick={create}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
            }}
          >
            <div
              className="sport-chip"
              style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
            >
              <Icon name="hike" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--accent)" }}>
                Create Garmin route from this activity
              </div>
              <div className="ctx-note" style={{ marginTop: 2 }}>
                Build a course from this track · syncs to your watch
              </div>
            </div>
            <Icon name="chevR" size={16} style={{ color: "var(--accent)" }} />
          </button>
        )}
        {status === "creating" && (
          <div className="row" style={{ gap: 12 }}>
            <div
              className="sport-chip"
              style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
            >
              <Icon name="hike" size={18} />
            </div>
            <div style={{ flex: 1, fontWeight: 500, fontSize: 14.5, color: "var(--text-2)" }}>
              Creating…
            </div>
          </div>
        )}
        {status === "done" && (
          <div className="row" style={{ gap: 12 }}>
            <div className="sport-chip" style={{ background: "var(--go-dim)", color: "var(--go)" }}>
              <Icon name="check" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--go)" }}>
                ✓ Route created — syncs to your watch
              </div>
              <div className="ctx-note" style={{ marginTop: 2 }}>
                “{a.name}”
              </div>
            </div>
          </div>
        )}
        {status === "error" && (
          <button
            onClick={create}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
            }}
          >
            <div
              className="sport-chip"
              style={{ background: "var(--back-dim)", color: "var(--back)" }}
            >
              <Icon name="info" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--back)" }}>
                Couldn't create route
              </div>
              <div className="ctx-note" style={{ marginTop: 2 }}>
                {errMsg ?? "Something went wrong."} · tap to retry
              </div>
            </div>
          </button>
        )}
      </div>
    </>
  );
}

export function useActivityDetail(id: number): { head: ReactNode; body: ReactNode } {
  const { data, loading, error } = useAsync(() => api.activity(id), [id]);
  const a: ActivityDetailView | null = data ? adaptActivityDetail(data) : null;

  const head = (
    <div className="sheet-head">
      <div className="row" style={{ gap: 12 }}>
        <SportChip sport={a?.sport ?? "run"} race={a?.race} />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
            {a?.name ?? "Activity"}
          </div>
          {a?.date && (
            <div className="ctx-note" style={{ marginTop: 2 }}>
              {fmtDate(a.date, { weekday: "long", month: "short", day: "numeric" })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  let body: ReactNode;
  if (loading) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton h={70} />
        <Skeleton h={168} />
        <Skeleton h={140} />
      </div>
    );
  } else if (error || !a) {
    body = <EmptyState icon="info" title="Couldn't load activity" body={error ?? "Not found."} />;
  } else {
    const hr = a.hrSeries.map((v) => ({ v }));
    const splits = buildSplits(a);
    const stats: [string, ReactNode][] = [
      ["Distance", `${a.distanceKm} km`],
      ["Time", fmtDur(a.durationMin)],
      ["Pace", paceStr(a)],
      ["Elev", a.elevation != null ? `${a.elevation} m` : "—"],
      ["Avg HR", a.avg_hr != null ? `${a.avg_hr} bpm` : "—"],
      ["Max HR", a.max_hr != null ? `${a.max_hr} bpm` : "—"],
      ["Suffer", a.suffer ?? "—"],
    ];
    body = (
      <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ minWidth: 70 }}>
              <div className="ctx-note">{k}</div>
              <div className="mono" style={{ fontSize: 16, marginTop: 3 }}>
                {v}
              </div>
            </div>
          ))}
        </div>

        {a.sport !== "swim" && a.track && a.track.length > 1 && <RouteCard a={a} />}

        {hr.length > 1 && (
          <div className="card" style={{ paddingBottom: 12 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>
              Heart rate · session
            </div>
            <LineChart
              data={hr}
              height={140}
              color="var(--m-rhr)"
              yPad={0.15}
              fmtY={(t) => Math.round(t)}
            />
          </div>
        )}

        {splits.length > 0 && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 10 }}>
              Splits
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {splits.map((s) => (
                <div key={s.idx} className="row" style={{ gap: 10 }}>
                  <span className="mono ctx-note" style={{ width: 24 }}>
                    {s.idx}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 18,
                      background: "var(--track)",
                      borderRadius: 5,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: `${s.w}%`,
                        // All bars green + clearly visible; faster = deeper green.
                        background: `color-mix(in oklch, var(--go) ${Math.round(60 + s.shade * 40)}%, var(--track))`,
                        borderRadius: 5,
                      }}
                    />
                  </div>
                  <span className="mono" style={{ fontSize: 12, width: 56, textAlign: "right" }}>
                    {s.pace}
                  </span>
                  <span className="mono ctx-note" style={{ width: 40, textAlign: "right" }}>
                    {s.hr ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return { head, body };
}

function ActivityDetailInner({
  id,
  open,
  onClose,
}: {
  id: number;
  open: boolean;
  onClose: () => void;
}) {
  const { head, body } = useActivityDetail(id);
  return (
    <Sheet open={open} onClose={onClose} head={head}>
      {body}
    </Sheet>
  );
}

// Keeps the last id during the close transition so the drawer animates out.
export function ActivitySheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const last = useRef<number | null>(id);
  const cleared = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (id != null) {
    last.current = id;
    if (cleared.current) {
      clearTimeout(cleared.current);
      cleared.current = null;
    }
  }
  useEffect(() => {
    if (id == null && last.current != null) {
      cleared.current = setTimeout(() => {
        last.current = null;
      }, 360);
    }
  }, [id]);
  const shown = id ?? last.current;
  if (shown == null) return null;
  return <ActivityDetailInner key={shown} id={shown} open={id != null} onClose={onClose} />;
}
