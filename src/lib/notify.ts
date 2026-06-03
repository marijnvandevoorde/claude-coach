import { spawnSync } from "child_process";

// ============================================================================
// Push notification delivery
//
// A tiny, dependency-free notifier used by reminders / the cron check-in.
// Channels:
//   - webhook : POST {title, message} JSON to a configured URL (e.g. a Home
//               Assistant webhook that fires notify.mobile_app_*).
//   - macos   : native macOS banner via osascript.
//   - stdout  : print to the console (last-resort fallback).
//   - auto    : webhook if a URL is configured, else macOS on darwin, else stdout.
// ============================================================================

export type NotifyChannel = "webhook" | "macos" | "stdout";

export interface NotifyConfig {
  /** Requested channel: "auto" | "webhook" | "macos" | "stdout" (case-insensitive). */
  channel: string | null | undefined;
  /** Webhook URL, if configured. */
  webhookUrl: string | null | undefined;
}

export interface ResolvedNotify {
  channel: NotifyChannel;
  webhookUrl: string | null;
  /** Human-readable explanation of why this channel was chosen. */
  reason: string;
}

/** Resolve the effective channel from config + platform. Pure (testable). */
export function resolveNotify(
  cfg: NotifyConfig,
  platform: string = process.platform
): ResolvedNotify {
  const channel = (cfg.channel ?? "auto").toLowerCase();
  const webhookUrl = cfg.webhookUrl ?? null;

  if (channel === "webhook") return { channel: "webhook", webhookUrl, reason: "channel=webhook" };
  if (channel === "macos") return { channel: "macos", webhookUrl: null, reason: "channel=macos" };
  if (channel === "stdout")
    return { channel: "stdout", webhookUrl: null, reason: "channel=stdout" };

  // auto (or anything unrecognised): pick the best available channel.
  if (webhookUrl)
    return { channel: "webhook", webhookUrl, reason: "auto → webhook (url configured)" };
  if (platform === "darwin") return { channel: "macos", webhookUrl: null, reason: "auto → macos" };
  return { channel: "stdout", webhookUrl: null, reason: "auto → stdout (no webhook, non-macOS)" };
}

/** Escape a string for safe interpolation into an AppleScript string literal. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface NotifyResult {
  ok: boolean;
  detail: string;
}

/** Deliver a notification through the resolved channel. */
export async function sendNotification(
  message: string,
  title: string,
  resolved: ResolvedNotify
): Promise<NotifyResult> {
  switch (resolved.channel) {
    case "webhook": {
      if (!resolved.webhookUrl) return { ok: false, detail: "no webhook URL configured" };
      // The webhook target (e.g. a self-hosted Home Assistant) can be briefly
      // unreachable, so retry a few times with backoff before giving up.
      const attempts = 3;
      let detail = "no attempt";
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(resolved.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, message }),
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) return { ok: true, detail: `HTTP ${res.status}` };
          detail = `HTTP ${res.status}`;
          if (res.status < 500 && res.status !== 429) break; // 4xx won't fix on retry
        } catch (err) {
          detail = `request failed: ${(err as Error).message}`;
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 750 * (i + 1)));
      }
      return { ok: false, detail: `${detail} (after ${attempts} attempts)` };
    }
    case "macos": {
      const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`;
      const r = spawnSync("osascript", ["-e", script], { encoding: "utf-8" });
      if (r.error) return { ok: false, detail: r.error.message };
      return r.status === 0
        ? { ok: true, detail: "macOS notification" }
        : { ok: false, detail: r.stderr?.trim() || `osascript exit ${r.status}` };
    }
    case "stdout":
    default:
      console.log(`🔔 ${title}: ${message}`);
      return { ok: true, detail: "printed to stdout" };
  }
}
