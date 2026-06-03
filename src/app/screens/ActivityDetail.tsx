import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { SportChip, Skeleton, EmptyState, Sheet } from "../components/primitives";
import { LineChart, RouteMap, genTrack, trackSeed } from "../charts/charts";
import { fmtDate, fmtDur } from "../lib/coach";
import { api } from "../api";
import { adaptActivityDetail, type ActivityDetailView } from "../lib/adapt";
import { useAsync } from "../lib/useAsync";
import { paceStr } from "./Activities";

// Synthesize an HR session series from avg/max HR (the API has no per-second stream).
function sessionSeries(a: ActivityDetailView): { v: number }[] {
  const n = 60;
  const out: { v: number }[] = [];
  const base = a.avg_hr ?? 140;
  const max = a.max_hr ?? base + 25;
  const seed = trackSeed(a.date + a.name);
  const rng = (i: number) => {
    const x = Math.sin((seed % 1000) * 0.013 + i * 12.9898) * 43758.5;
    return x - Math.floor(x);
  };
  const intervals = /interval|rep|×|x\d/i.test(a.name);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let hr =
      base -
      14 * Math.exp(-t * 6) +
      (intervals ? 16 * Math.max(0, Math.sin(t * Math.PI * 6)) : 0) +
      (rng(i) - 0.5) * 5 +
      t * 6;
    out.push({ v: Math.round(Math.min(max, hr)) });
  }
  return out;
}

interface Split {
  km: number;
  pace: string;
  hr: number;
  w: number;
  fast: boolean;
}
function buildSplits(a: ActivityDetailView): Split[] {
  if (a.sport === "ride" || !a.distanceKm || !a.durationMin || !a.avg_hr) return [];
  const km = Math.floor(a.distanceKm);
  const basePace = a.durationMin / a.distanceKm;
  const seed = trackSeed(a.date + a.name);
  const raw: { km: number; pRaw: number; pace: string; hr: number }[] = [];
  let fastest = 99;
  for (let i = 1; i <= km; i++) {
    const x = Math.sin(((seed % 100) + i) * 5.17) * 0.5;
    const p = basePace + x * 0.5 - (i / km) * 0.2;
    fastest = Math.min(fastest, p);
    const m = Math.floor(p);
    const s = Math.round((p - m) * 60);
    raw.push({
      km: i,
      pRaw: p,
      pace: `${m}:${String(s).padStart(2, "0")}`,
      hr: Math.round(a.avg_hr + x * 8 + (i / km) * 5),
    });
  }
  const max = Math.max(...raw.map((o) => o.pRaw));
  const min = Math.min(...raw.map((o) => o.pRaw));
  return raw
    .map((o) => ({
      km: o.km,
      pace: o.pace,
      hr: o.hr,
      w: 100 - ((o.pRaw - min) / (max - min || 1)) * 55,
      fast: o.pRaw <= fastest + 0.05,
    }))
    .slice(0, 14);
}

function RouteCard({ a }: { a: ActivityDetailView }) {
  const track = useMemo(
    () => (a.track && a.track.length > 1 ? a.track : genTrack(trackSeed(a.date + a.name))),
    [a]
  );
  const hasTrack = !!(a.track && a.track.length > 1);
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const create = async () => {
    if (!hasTrack) {
      setStatus("error");
      setErrMsg("No GPS track on this activity.");
      return;
    }
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
          <span className="lbl">Route · {a.track && a.track.length > 1 ? "from GPS" : "approx"}</span>
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
            style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, width: "100%" }}
          >
            <div className="sport-chip" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
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
            <div className="sport-chip" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
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
            style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, width: "100%" }}
          >
            <div className="sport-chip" style={{ background: "var(--back-dim)", color: "var(--back)" }}>
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
    const hr = sessionSeries(a);
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

        {a.sport !== "swim" && <RouteCard a={a} />}

        {a.avg_hr != null && (
          <div className="card" style={{ paddingBottom: 12 }}>
            <div className="lbl" style={{ marginBottom: 6 }}>
              Heart rate · session
            </div>
            <LineChart data={hr} height={140} color="var(--m-rhr)" yPad={0.15} fmtY={(t) => Math.round(t)} />
          </div>
        )}

        {splits.length > 0 && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 10 }}>
              Splits
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {splits.map((s) => (
                <div key={s.km} className="row" style={{ gap: 10 }}>
                  <span className="mono ctx-note" style={{ width: 24 }}>
                    {s.km}
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
                        background: s.fast ? "var(--accent)" : "var(--surface-2)",
                        borderRadius: 5,
                      }}
                    />
                  </div>
                  <span className="mono" style={{ fontSize: 12, width: 56, textAlign: "right" }}>
                    {s.pace}
                  </span>
                  <span className="mono ctx-note" style={{ width: 40, textAlign: "right" }}>
                    {s.hr}
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
