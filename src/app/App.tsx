import { useEffect, useState } from "react";
import { api, type Summary } from "./api";

/**
 * App shell — scaffold. Responsive shell-swap (sidebar ≥900px / tab bar below)
 * + a live Today view off /api/summary. The full design screens (Calendar,
 * Trends, Activity, Journal, Day/Activity detail, charts) are ported on top of
 * this foundation; this proves the build → serve → API → render path.
 */
const TABS = [
  { k: "today", label: "Today" },
  { k: "calendar", label: "Calendar" },
  { k: "trends", label: "Trends" },
  { k: "activities", label: "Activity" },
  { k: "journal", label: "Journal" },
] as const;
type Tab = (typeof TABS)[number]["k"];

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

const BAND = (score: number | null | undefined): string =>
  score == null ? "var(--text-3)" : score >= 67 ? "var(--go)" : score >= 40 ? "var(--modify)" : "var(--back)";

function Today() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.summary().then(setS).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="page">Couldn’t load: {err}</div>;
  if (!s) return <div className="page">Loading…</div>;
  const r = s.readiness;
  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="card" style={{ textAlign: "center", padding: 26 }}>
        <div className="eyebrow">Readiness · est.</div>
        <div style={{ fontSize: 60, fontWeight: 600, color: BAND(r?.score) }}>{r?.score ?? "—"}</div>
        <div style={{ color: BAND(r?.score), fontWeight: 600, textTransform: "capitalize" }}>
          {r?.level ?? "no data"}
        </div>
      </div>
      {r?.contributions?.length ? (
        <div className="card">
          <h3>What moved it</h3>
          {r.contributions.map((c) => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{c.label}</span>
              <span style={{ color: c.points >= 0 ? "var(--go)" : "var(--back)" }}>
                {c.points > 0 ? "+" : ""}
                {c.points}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="card">
        <h3>Hydration</h3>
        <div style={{ fontSize: 22 }}>
          {s.hydration.total_ml} ml{s.hydration.goal_ml ? ` / ${s.hydration.goal_ml}` : ""}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[100, 250, 500].map((ml) => (
            <button
              key={ml}
              onClick={() => api.logWater(ml).then((h) => setS({ ...s, hydration: h }))}
              style={{ flex: 1, padding: 12, borderRadius: 12 }}
            >
              +{ml}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const wide = useWide();
  const [tab, setTab] = useState<Tab>("today");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const screen =
    tab === "today" ? <Today /> : <div className="page">“{tab}” — coming next.</div>;

  return (
    <div data-theme={theme} data-scheme="lagoon" className={wide ? "desktop" : "phone-screen"}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Coach</div>
          <h1>{TABS.find((t) => t.k === tab)!.label}</h1>
        </div>
        <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
      <div className="scroll">{screen}</div>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.k}
            className={tab === t.k ? "active" : ""}
            onClick={() => setTab(t.k)}
            style={{ flex: 1, padding: "10px 0" }}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
