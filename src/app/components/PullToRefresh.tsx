import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

const TRIGGER = 64; // px of pull (after resistance) needed to fire a refresh
const MAX_PULL = 96; // cap so the indicator never runs away
const RESISTANCE = 0.5; // drag feels rubber-banded

/**
 * Pull-to-refresh for the mobile shell. Wraps a screen (which owns its own
 * `.scroll` element) without disturbing its layout — the wrapper is
 * `display: contents`, so the inner `.scroll` keeps being the flex child.
 * Only engages when that scroller is already at the top, so a normal upward
 * scroll is never hijacked. `refreshing` keeps the spinner up while the parent
 * runs the (async) sync.
 */
export function PullToRefresh({
  onRefresh,
  refreshing,
  children,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);

  const scroller = (): HTMLElement | null =>
    (wrap.current?.querySelector(".scroll") as HTMLElement | null) ?? null;

  function onTouchStart(e: React.TouchEvent) {
    const el = scroller();
    if (refreshing || !el || el.scrollTop > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null) return;
    // Bail if the scroller left the top mid-drag (user scrolled content).
    const el = scroller();
    if (el && el.scrollTop > 0) {
      startY.current = null;
      setPull(0);
      return;
    }
    const dy = e.touches[0].clientY - startY.current;
    setPull(dy > 0 ? Math.min(MAX_PULL, dy * RESISTANCE) : 0);
  }
  function onTouchEnd() {
    if (startY.current == null) return;
    if (pull >= TRIGGER && !refreshing) onRefresh();
    startY.current = null;
    setPull(0);
  }

  const armed = pull >= TRIGGER;
  const visible = refreshing || pull > 0;
  const height = refreshing ? 48 : pull;

  return (
    <div
      ref={wrap}
      style={{ display: "contents" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="ptr" style={{ height, opacity: visible ? 1 : 0 }} aria-hidden={!visible}>
        <span
          className={`ptr-spin${refreshing ? " spinning" : ""}`}
          style={{ transform: refreshing ? undefined : `rotate(${pull * 4}deg)` }}
        >
          <Icon name="refresh" size={16} />
        </span>
        <span className="ptr-label">
          {refreshing ? "Syncing Garmin…" : armed ? "Release to sync" : "Pull to sync"}
        </span>
      </div>
      {children}
    </div>
  );
}
