import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SportChip, EmptyState, Skeleton } from "../components/primitives";
import { fmtDate, fmtDur, normSport, sessionDetail } from "../lib/coach";
import { api, type ActivityRow, type PlannedSession } from "../api";
import { adaptActivityRow, type ActivityView } from "../lib/adapt";

const SPORTS = [
  { k: "all", label: "All" },
  { k: "run", label: "Run" },
  { k: "ride", label: "Ride" },
];

const PAGE = 40;

function paceStr(a: ActivityView): string {
  if (!a.distanceKm || !a.durationMin) return "—";
  if (a.sport === "ride") return Math.round(a.distanceKm / (a.durationMin / 60)) + " km/h";
  const pace = a.durationMin / a.distanceKm;
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

// API sport_type filter expects server-side values; we filter client-side on the
// normalized sport so the run/ride buttons work regardless of raw labels.
export function Activities({ onOpenActivity }: { onOpenActivity: (id: number) => void }) {
  const [sport, setSport] = useState<string>("all");
  const [rows, setRows] = useState<ActivityView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [upcoming, setUpcoming] = useState<PlannedSession[]>([]);
  const reqId = useRef(0);

  // Upcoming planned sessions from the active plan (shown above completed activities).
  useEffect(() => {
    api
      .upcoming(21)
      .then((r) => setUpcoming(r.sessions))
      .catch(() => setUpcoming([]));
  }, []);

  const load = (reset: boolean) => {
    const before = reset ? undefined : rows[rows.length - 1]?.date || undefined;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    api
      .activities({ limit: PAGE, before })
      .then((res: ActivityRow[]) => {
        if (id !== reqId.current) return;
        const mapped = res.map(adaptActivityRow);
        setRows((prev) => (reset ? mapped : [...prev, ...mapped]));
        setDone(res.length < PAGE);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (id !== reqId.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    setRows([]);
    setDone(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((a) => sport === "all" || a.sport === sport);

  // group by month
  const groups: Record<string, ActivityView[]> = {};
  filtered.forEach((a) => {
    const k = a.date ? fmtDate(a.date, { month: "long", year: "numeric" }) : "Undated";
    (groups[k] = groups[k] || []).push(a);
  });
  const totalKm = filtered.reduce((s, a) => s + a.distanceKm, 0);

  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {filtered.length} activities · {Math.round(totalKm)} km
          </div>
          <h1>Activity</h1>
        </div>
      </div>
      <div className="page act-page" style={{ paddingTop: 0 }}>
        <div className="seg" style={{ maxWidth: 220 }}>
          {SPORTS.map((s) => (
            <button key={s.k} className={sport === s.k ? "on" : ""} onClick={() => setSport(s.k)}>
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <GpxImport />
        </div>

        {/* Upcoming planned sessions — clearly not completed activities. */}
        {(() => {
          const ups = upcoming.filter((s) => sport === "all" || normSport(s.sport) === sport);
          if (ups.length === 0) return null;
          return (
            <div className="fade-in">
              <div className="lbl" style={{ margin: "20px 4px 4px" }}>
                Upcoming
              </div>
              <div className="list">
                {ups.map((s, i) => (
                  <div
                    className="arow"
                    key={`up-${s.date}-${i}`}
                    style={{ borderLeft: "2px dashed var(--accent-line)", opacity: 0.95 }}
                  >
                    <SportChip sport={normSport(s.sport)} />
                    <div className="ameta">
                      <div className="aname">
                        {s.name}
                        <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 12 }}>
                          ● planned
                        </span>
                      </div>
                      <div className="asub">
                        {s.date ? fmtDate(s.date) : "—"} · {sessionDetail(s)}
                      </div>
                    </div>
                    <div className="astat">
                      <div
                        className="ctx-note"
                        style={{ color: s.syncedToGarmin ? "var(--go)" : "var(--text-3)" }}
                      >
                        {s.syncedToGarmin ? "on watch" : "scheduled"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {error && <EmptyState icon="info" title="Couldn't load activities" body={error} />}
        {!error && loading && rows.length === 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={56} />
            ))}
          </div>
        )}
        {!error && !loading && filtered.length === 0 && (
          <EmptyState
            icon="activity"
            title="No activities"
            body="No workouts match this filter yet."
          />
        )}

        {Object.keys(groups).map((g) => (
          <div key={g} className="fade-in">
            <div className="lbl" style={{ margin: "20px 4px 4px" }}>
              {g}
            </div>
            <div className="list">
              {groups[g].map((a) => (
                <div className="arow" key={a.id} onClick={() => onOpenActivity(a.id)}>
                  <SportChip sport={a.sport} race={a.race} />
                  <div className="ameta">
                    <div className="aname">
                      {a.name}
                      {a.race && (
                        <span style={{ color: "var(--modify)", marginLeft: 6, fontSize: 12 }}>
                          ● PB
                        </span>
                      )}
                    </div>
                    <div className="asub">
                      {a.date ? fmtDate(a.date) : "—"} · {a.distanceKm} km · {fmtDur(a.durationMin)}
                    </div>
                  </div>
                  <div className="astat">
                    <div>
                      {a.avg_hr ?? "—"}
                      <span className="unit" style={{ fontSize: 10 }}>
                        {" "}
                        bpm
                      </span>
                    </div>
                    <div className="ctx-note" style={{ marginTop: 2 }}>
                      {paceStr(a)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!done && rows.length > 0 && (
          <button
            className="step-btn"
            style={{ width: "100%", marginTop: 16, height: 44 }}
            onClick={() => load(false)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- upload your own GPX → Garmin course (real) ---------- */
export function GpxImport() {
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    setName(f.name);
    setErr(null);
    setState("uploading");
    try {
      const gpx = await f.text();
      await api.uploadRoute(gpx, { name: f.name.replace(/\.gpx$/i, "") });
      setState("done");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
      setState("error");
    }
  };
  const reset = () => {
    setState("idle");
    setName("");
    setErr(null);
  };
  return (
    <div
      className="card"
      style={{
        borderColor:
          state === "done"
            ? "color-mix(in oklch, var(--go) 45%, transparent)"
            : state === "error"
              ? "color-mix(in oklch, var(--back) 45%, transparent)"
              : "var(--accent-line)",
        marginBottom: 4,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        style={{ display: "none" }}
        onChange={onFile}
      />
      {state === "idle" && (
        <button
          onClick={pick}
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
            <Icon name="plus" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--accent)" }}>
              Upload a GPX → push to Garmin
            </div>
            <div className="ctx-note" style={{ marginTop: 2 }}>
              Turn any .gpx into a course on your watch
            </div>
          </div>
          <Icon name="chevR" size={16} style={{ color: "var(--accent)" }} />
        </button>
      )}
      {state === "uploading" && (
        <div className="row" style={{ gap: 12 }}>
          <div
            className="sport-chip"
            style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
          >
            <Icon name="layers" size={18} />
          </div>
          <div style={{ flex: 1, fontWeight: 500, fontSize: 14.5, color: "var(--text-2)" }}>
            Pushing {name}…
          </div>
        </div>
      )}
      {state === "done" && (
        <div className="row" style={{ gap: 12 }}>
          <div className="sport-chip" style={{ background: "var(--go-dim)", color: "var(--go)" }}>
            <Icon name="check" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--go)" }}>
              Pushed to Garmin
            </div>
            <div className="ctx-note" style={{ marginTop: 2 }}>
              {name} · available as a course on your watch
            </div>
          </div>
          <button className="chip" style={{ cursor: "pointer" }} onClick={reset}>
            another
          </button>
        </div>
      )}
      {state === "error" && (
        <button
          onClick={reset}
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
              Couldn't upload {name}
            </div>
            <div className="ctx-note" style={{ marginTop: 2 }}>
              {err ?? "Something went wrong."} · tap to try another
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

export { paceStr };
