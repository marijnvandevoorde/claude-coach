import { useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { UndoToast, TabBar, TABS, type TabId, type ToastState } from "./components/primitives";
import { band, todayISO, isoOf, parseISO, DAY_MIN } from "./lib/coach";
import { api } from "./api";
import { adaptSummary, type DayView } from "./lib/adapt";
import { useAsync } from "./lib/useAsync";
import { PullToRefresh } from "./components/PullToRefresh";
import { Dashboard, DashboardLoading } from "./screens/Dashboard";
import { Calendar } from "./screens/Calendar";
import { Trends } from "./screens/Trends";
import { Activities } from "./screens/Activities";
import { Journal } from "./screens/Journal";
import { DaySheet } from "./screens/DayDetail";
import { ActivitySheet } from "./screens/ActivityDetail";
import type { MetricKey } from "./charts/charts";

const BREAKPOINT = 900;
const UNDO_MS = 5000;

const EMPTY_DAY = (date: string): DayView => ({
  date,
  readiness: null,
  factors: [],
  coverage: {},
  sleep_hours: null,
  sleep_score: null,
  sleep_stages: null,
  hrv: null,
  hrv_base_low: null,
  hrv_base_high: null,
  resting_hr: null,
  body_battery: null,
  acwr: null,
  load_acute: null,
  load_chronic: null,
  stress: null,
  steps: null,
  subjective: null,
  plan: null,
  hasData: false,
});

function Sidebar({
  active,
  onChange,
  theme,
  onToggleTheme,
  readiness,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  theme: string;
  onToggleTheme: () => void;
  readiness: number | null;
}) {
  const b = band(readiness);
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="brand-mark">C</div>
        <div>
          <div className="brand-name">Coach</div>
          <div className="brand-sub">small victories</div>
        </div>
      </div>
      <nav className="side-nav">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={`side-link ${active === tb.id ? "on" : ""}`}
            onClick={() => onChange(tb.id)}
          >
            <Icon name={tb.icon} size={19} sw={active === tb.id ? 2 : 1.6} />
            <span>{tb.label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="side-ready">
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: b.color }} />
          <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
            {readiness != null ? `Readiness ${readiness} · ${b.label}` : "Readiness —"}
          </span>
        </div>
        <button className="side-link" onClick={onToggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
          <span>{theme === "dark" ? "Light" : "Dark"} mode</span>
        </button>
      </div>
    </aside>
  );
}

// --- URL routing (History API): /app/<tab> + ?day=/?activity= so refresh and
// direct links land on the same view. (The server SPA-fallback serves index.html
// for any /app/* path.)
const TAB_IDS = TABS.map((t) => t.id) as string[];
function readRoute(): { tab: TabId; day: string | null; activity: number | null } {
  const seg = window.location.pathname.replace(/^\/app\/?/, "").split(/[/?#]/)[0];
  const tab = (TAB_IDS.includes(seg) ? seg : "today") as TabId;
  const q = new URLSearchParams(window.location.search);
  const day = q.get("day");
  const act = q.get("activity");
  return { tab, day: day || null, activity: act && /^\d+$/.test(act) ? Number(act) : null };
}
function routeUrl(tab: TabId, day: string | null, activity: number | null): string {
  const q = new URLSearchParams();
  if (day) q.set("day", day);
  if (activity != null) q.set("activity", String(activity));
  const qs = q.toString();
  return `/app/${tab === "today" ? "" : tab}${qs ? `?${qs}` : ""}`;
}

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState<TabId>(() => readRoute().tab);
  const [metric, setMetric] = useState<MetricKey>("readiness");
  const [win, setWin] = useState(42);
  const [daySheet, setDaySheet] = useState<string | null>(() => readRoute().day);
  const [activityId, setActivityId] = useState<number | null>(() => readRoute().activity);

  // Keep the URL in sync with the view, and react to back/forward.
  useEffect(() => {
    const want = routeUrl(tab, daySheet, activityId);
    if (want !== window.location.pathname + window.location.search) {
      window.history.pushState(null, "", want);
    }
  }, [tab, daySheet, activityId]);
  useEffect(() => {
    const onPop = () => {
      const r = readRoute();
      setTab(r.tab);
      setDaySheet(r.day);
      setActivityId(r.activity);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // viewport-driven shell swap at 900px
  const [vw, setVw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const wide = vw >= BREAKPOINT;

  const today = todayISO();

  // Bumping reloadKey re-runs the summary/trends fetches in place — the live-update
  // mechanism the Garmin pull-to-refresh polls on.
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // today's summary — drives dashboard + sidebar readiness + hydration seed
  const summaryState = useAsync(() => api.summary(), [reloadKey]);
  const day: DayView | null = summaryState.data ? adaptSummary(summaryState.data) : null;

  // recent window for tile sparklines (HRV / RHR)
  const trendsState = useAsync(() => api.trends(30), [reloadKey]);
  const recent = trendsState.data?.series ?? [];
  const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const hrvSeries = recent.map((r) => numOrNull((r as Record<string, unknown>).hrv_weekly_avg));
  const rhrSeries = recent.map((r) => numOrNull((r as Record<string, unknown>).resting_hr));

  // hydration: optimistic local total + 5s batched undo
  const [water, setWater] = useState(0);
  const [goal, setGoal] = useState(2500);
  const summaryHyd = summaryState.data?.hydration;
  useEffect(() => {
    if (summaryHyd) {
      setWater(summaryHyd.total_ml ?? 0);
      if (summaryHyd.goal_ml) setGoal(summaryHyd.goal_ml);
    }
  }, [summaryHyd]);

  // subjective (today) — seed from summary, override locally
  const [subjective, setSubjective] = useState<{ energy?: number; mood?: number }>({});
  useEffect(() => {
    if (day?.subjective)
      setSubjective({ energy: day.subjective.energy, mood: day.subjective.mood });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryState.data]);

  const [journalKey, setJournalKey] = useState(0);

  // toast / undo (batched)
  const [toast, setToast] = useState<ToastState | null>(null);
  const batchBase = useRef<number | null>(null);
  const batchTotal = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commitWater() {
    const amt = batchTotal.current;
    batchBase.current = null;
    batchTotal.current = 0;
    if (amt > 0) api.logWater(amt).catch(() => {});
  }
  function addWater(amt: number) {
    if (batchBase.current == null) batchBase.current = water;
    batchTotal.current += amt;
    setWater((w) => Math.min(goal * 2, w + amt));
    const base = batchBase.current;
    const total = batchTotal.current;
    setToast({ id: Date.now(), text: `+${total} ml water logged`, base });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast(null);
      commitWater();
    }, UNDO_MS);
  }
  function undoWater() {
    if (toast?.base != null) setWater(toast.base);
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
    batchBase.current = null;
    batchTotal.current = 0;
  }

  // Flush any un-committed water if the page is hidden/closed before the 5s undo
  // window elapses — otherwise a quick refresh loses the tap. sendBeacon survives
  // unload and carries the same-origin Access cookie.
  useEffect(() => {
    const flush = () => {
      const amt = batchTotal.current;
      if (amt <= 0) return;
      batchTotal.current = 0;
      batchBase.current = null;
      try {
        navigator.sendBeacon(
          "/api/hydration",
          new Blob([JSON.stringify({ ml: amt })], { type: "application/json" })
        );
      } catch {
        /* best effort */
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // A `?water=NNN` param means a notification action button couldn't log in the
  // background (e.g. the Access session had expired) and handed off to the app.
  // Log it once, then strip the param so a refresh doesn't double-count.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("water");
    if (!raw) return;
    params.delete("water");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    const ml = parseInt(raw, 10);
    if (Number.isFinite(ml) && ml > 0 && ml <= 3000) addWater(ml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-refresh → kick off a server-side Garmin sync, then poll a few times,
  // re-fetching the dashboard so fresh wellness/activities appear live as they land.
  async function runGarminRefresh() {
    if (syncing) return;
    setSyncing(true);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await api.refreshGarmin();
      // Poll up to ~40s; each tick re-fetches summary/trends (live update).
      for (let i = 0; i < 10; i++) {
        await sleep(4000);
        setReloadKey((k) => k + 1);
        const st = await api.garminRefreshStatus().catch(() => null);
        if (st && !st.running && st.finishedAt) break;
      }
    } catch {
      /* best effort — the dashboard just keeps the last-known data */
    } finally {
      setReloadKey((k) => k + 1);
      setSyncing(false);
    }
  }

  function onSubj(k: "energy" | "mood", v: number) {
    setSubjective((s) => {
      const next = { ...s, [k]: s[k] === v ? undefined : v };
      api.logSubjective({ energy: next.energy, mood: next.mood }).catch(() => {});
      return next;
    });
  }

  function stepDay(delta: number) {
    setDaySheet((cur) => {
      if (!cur) return cur;
      const d = parseISO(cur);
      d.setDate(d.getDate() + delta);
      return isoOf(d);
    });
  }
  const canPrev = !!daySheet && daySheet > DAY_MIN;
  const canNext = !!daySheet && daySheet < today;

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const dashDay: DayView | null = day
    ? {
        ...day,
        subjective:
          subjective.energy != null || subjective.mood != null
            ? { ...day.subjective, ...subjective }
            : day.subjective,
      }
    : null;

  let screen: React.ReactNode;
  if (tab === "today") {
    // Show the skeleton only on the very first load; a refresh/poll keeps the
    // current dashboard up and updates it in place (no flash to the loader).
    screen =
      summaryState.loading && !summaryState.data ? (
        <DashboardLoading theme={theme} />
      ) : (
        <PullToRefresh onRefresh={runGarminRefresh} refreshing={syncing}>
          <Dashboard
            day={dashDay ?? EMPTY_DAY(today)}
            hrvSeries={hrvSeries}
            rhrSeries={rhrSeries}
            water={water}
            goal={goal}
            onWater={addWater}
            onOpenDay={setDaySheet}
            theme={theme}
            onToggleTheme={toggleTheme}
            showThemeToggle={!wide}
            refreshing={syncing}
          />
        </PullToRefresh>
      );
  } else if (tab === "calendar") {
    screen = <Calendar metric={metric} onMetric={setMetric} onPick={setDaySheet} />;
  } else if (tab === "trends") {
    screen = <Trends win={win} onWin={setWin} />;
  } else if (tab === "activities") {
    screen = <Activities onOpenActivity={setActivityId} />;
  } else {
    screen = (
      <Journal
        subjective={subjective}
        onSubj={onSubj}
        onPick={setDaySheet}
        refreshKey={journalKey}
        onAdded={() => setJournalKey((k) => k + 1)}
      />
    );
  }

  const overlays = (
    <>
      <DaySheet
        date={daySheet}
        onClose={() => setDaySheet(null)}
        onStep={stepDay}
        canPrev={canPrev}
        canNext={canNext}
        water={water}
        goal={goal}
        todayISO={today}
      />
      <ActivitySheet id={activityId} onClose={() => setActivityId(null)} />
      <UndoToast toast={toast} onUndo={undoWater} />
    </>
  );

  if (wide) {
    return (
      <div className="desktop app-root" data-theme={theme} data-scheme="lagoon">
        <Sidebar
          active={tab}
          onChange={setTab}
          theme={theme}
          onToggleTheme={toggleTheme}
          readiness={day?.readiness ?? null}
        />
        <main className="desktop-main">{screen}</main>
        {overlays}
      </div>
    );
  }

  return (
    <div className="app-root mobile" data-theme={theme} data-scheme="lagoon">
      <div className="app">
        {screen}
        <TabBar active={tab} onChange={setTab} />
        {overlays}
      </div>
    </div>
  );
}
