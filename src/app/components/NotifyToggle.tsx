import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { pushState, enablePush, disablePush, testPush, type PushState } from "../lib/push";

// A small card to turn PWA push notifications on/off and fire a test. On iOS,
// Web Push only exists once the app is installed to the home screen, so an
// "unsupported" state nudges the user to install first.
export function NotifyToggle() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    pushState().then(setState);
  }, []);

  const run = async (fn: () => Promise<PushState | void>, after?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      if (next) setState(next);
      if (after) setMsg(after);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return null;

  return (
    <div className="card fade-in" style={{ marginTop: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="lbl">
          <Icon name="pulse" size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
          Notifications
        </span>
        {state === "on" && <span className="ctx-note">on this device</span>}
      </div>

      {state === "unsupported" && (
        <div className="ctx-note">
          To get push notifications on iPhone, add Coach to your home screen first (Share → Add to
          Home Screen), then open it from there.
        </div>
      )}

      {state === "denied" && (
        <div className="ctx-note">
          Notifications are blocked in your browser settings — re-enable them for this site to
          receive nudges here.
        </div>
      )}

      {state === "off" && (
        <button className="step-btn" disabled={busy} onClick={() => run(enablePush)}>
          {busy ? "Enabling…" : "Turn on push notifications"}
        </button>
      )}

      {state === "on" && (
        <div className="row" style={{ gap: 8 }}>
          <button className="step-btn" disabled={busy} onClick={() => run(testPush, "Test sent.")}>
            Send a test
          </button>
          <button className="step-btn" disabled={busy} onClick={() => run(disablePush)}>
            Turn off
          </button>
        </div>
      )}

      {msg && (
        <div className="ctx-note" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
