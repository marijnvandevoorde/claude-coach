import { useState } from "react";
import { TagChip, EmptyState, Skeleton } from "../components/primitives";
import { fmtDate } from "../lib/coach";
import { api, type JournalEntry } from "../api";
import { useAsync } from "../lib/useAsync";

const TAGS = ["note", "race", "niggle", "travel", "illness"];
const TAG_DOTS: Record<string, string> = {
  note: "var(--text-3)",
  race: "var(--modify)",
  niggle: "var(--back)",
  travel: "var(--accent)",
  illness: "var(--back)",
};

/* ---------- subjective check-in (Energy + Mood sliders) ---------- */
function LevelSlider({
  field,
  value,
  onChange,
}: {
  field: { k: string; label: string; lo: string; hi: string };
  value: number;
  onChange: (v: number) => void;
}) {
  const set = !!value;
  const shown = set ? value : 3;
  const fill = ((shown - 1) / 4) * 100;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 9 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{field.label}</span>
        <span className="mono" style={{ fontSize: 13, color: set ? "var(--accent)" : "var(--text-3)" }}>
          {set ? `${value} / 5` : "—"}
        </span>
      </div>
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={shown}
        onChange={(e) => onChange(+e.target.value)}
        className={`lvl-range ${set ? "" : "unset"}`}
        aria-label={field.label}
        style={{
          background: `linear-gradient(to right, ${set ? "var(--accent)" : "var(--text-3)"} ${fill}%, var(--track) ${fill}%)`,
        }}
      />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="ctx-note">{field.lo}</span>
        <span className="ctx-note">{field.hi}</span>
      </div>
    </div>
  );
}

export function SubjectiveCheckIn({
  subjective,
  onSubj,
}: {
  subjective: { energy?: number; mood?: number };
  onSubj: (k: "energy" | "mood", v: number) => void;
}) {
  const fields = [
    { k: "energy", label: "Energy", lo: "Drained", hi: "Fresh" },
    { k: "mood", label: "Mood", lo: "Low", hi: "Great" },
  ] as const;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <span className="lbl">How do you feel?</span>
        <span className="ctx-note" style={{ whiteSpace: "nowrap" }}>
          today · drag to log
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {fields.map((f) => (
          <LevelSlider
            key={f.k}
            field={f}
            value={subjective[f.k] || 0}
            onChange={(v) => onSubj(f.k, v)}
          />
        ))}
      </div>
    </div>
  );
}

export function Journal({
  subjective,
  onSubj,
  onPick,
  refreshKey,
  onAdded,
}: {
  subjective: { energy?: number; mood?: number };
  onSubj: (k: "energy" | "mood", v: number) => void;
  onPick: (date: string) => void;
  refreshKey: number;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState("note");
  const [filter, setFilter] = useState("all");
  const [posting, setPosting] = useState(false);

  const { data, loading, error } = useAsync(() => api.journal({ limit: 200 }), [refreshKey]);
  const entries: JournalEntry[] = data ?? [];
  const list = entries.filter((e) => filter === "all" || e.tag === filter);

  const submit = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await api.addJournal({ entry: text.trim(), tag });
      setText("");
      onAdded();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="scroll">
      <div className="topbar">
        <div>
          <div className="eyebrow">{entries.length} entries · annotates trends</div>
          <h1>Journal</h1>
        </div>
      </div>
      <div className="page jrnl-page" style={{ paddingTop: 0 }}>
        <div className="card" style={{ marginBottom: 12 }}>
          <SubjectiveCheckIn subjective={subjective} onSubj={onSubj} />
        </div>

        <div className="card">
          <div className="compose">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Quick note — how the session felt, a niggle, travel…"
              rows={4}
            />
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {TAGS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(t)}
                  className={`chip tag-${t}`}
                  style={{ cursor: "pointer", opacity: tag === t ? 1 : 0.5, borderWidth: tag === t ? 1.5 : 1 }}
                >
                  <span className="tag-dot" style={{ background: TAG_DOTS[t] }} />
                  {t}
                </button>
              ))}
            </div>
            <button
              className="step-btn"
              style={{ flex: "none", padding: "0 16px", height: 38, opacity: text.trim() && !posting ? 1 : 0.4 }}
              onClick={submit}
            >
              {posting ? "…" : "Add"}
            </button>
          </div>
        </div>

        <div className="seg" style={{ marginTop: 14 }}>
          {["all", ...TAGS].map((t) => (
            <button key={t} className={filter === t ? "on" : ""} onClick={() => setFilter(t)}>
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} h={64} />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon="info" title="Couldn't load journal" body={error} />
        ) : list.length === 0 ? (
          <EmptyState icon="journal" title="No entries" body="Nothing tagged here yet. Jot a note above." />
        ) : (
          <div className="list" style={{ marginTop: 6 }}>
            {list.map((j) => (
              <div
                className="jentry"
                key={j.id}
                onClick={() => onPick(j.local_date)}
                style={{ cursor: "pointer" }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <TagChip tag={j.tag} />
                  <span className="ctx-note" style={{ marginLeft: "auto" }}>
                    {fmtDate(j.local_date, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <p className="jtext">{j.entry}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
