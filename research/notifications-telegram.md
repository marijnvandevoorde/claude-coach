# Telegram as a push-notification channel for claude-coach reminders

Research for Sprint 2 (proactive wellness reminders: water, bedtime, recovery).
Reference fork: `luyckxrobbe/claude-coach-garmin` @ commit
`044170ca6ad13bf5d71518b5484312c49c64e216` ("Add Telegram coaching bot with
Claude API and tool use").

## TL;DR

**Recommendation: Yes — use Telegram, but NOT the way the fork uses it.**

Telegram is the best-value push channel for this project: free, a dead-simple
HTTP `sendMessage` API, reliable cross-platform phone push, no app-store
account, no server to host. The one-time user setup (create a bot in BotFather,
grab a token, send `/start` once to learn the chat id) is real but small and
one-time.

The fork, however, runs Telegram as a **long-running conversational coaching
daemon** (grammy long-polling + Claude API + tool use). That is much heavier
than what Sprint 2 needs and does not fit our cron-driven architecture. For
_push reminders_ we only need the **outbound half**: a tiny `coach notify`
subcommand that POSTs one message to the Bot API. No bot framework, no daemon,
no Anthropic SDK, no polling.

Proposed minimal path:

- Add a `coach notify "<text>"` subcommand that POSTs to
  `https://api.telegram.org/bot<token>/sendMessage` using the existing
  `fetch`/`undici` stack — **zero new dependencies**.
- Store `telegram_bot_token` + `telegram_chat_id` in the existing
  `reminder_prefs` row in `coach.db` (alongside bedtime/water prefs), or via
  env vars as an override.
- The Sprint 2 cron agent / `checkin` flow decides _what_ to say (respecting
  quiet hours, cadence, `reminders_enabled`) and shells out to `coach notify`
  to actually deliver the push.

If the user does not set up a bot, `coach notify` degrades to printing the
message to stdout (and/or a native macOS notification), so reminders still work
locally with no setup.

---

## Findings from the fork (cited)

All paths below are at commit `044170c` of `luyckxrobbe/claude-coach-garmin`.

### What the commit actually adds

A self-contained `src/bot/` module (7 files) plus a `bot` CLI command. It is a
**conversational coach**, not a notifier:

- `src/bot/telegram.ts` (171 lines) — builds a grammy `Bot`, registers slash
  commands (`/start`, `/plan`, `/week`, `/loadplan`, `/reset`), a
  `message:document` handler (upload a plan `.json`), and a `message:text`
  handler that forwards every message to `Coach.chat()`. It also splits replies
  to fit Telegram's 4096-char limit and shows a "typing" chat action.
- `src/bot/index.ts` (34 lines) — `startBot()`: loads config, inits the DB,
  creates the bot, wires `SIGINT`/`SIGTERM` shutdown, and calls
  `bot.start({ onStart })`. **This is a blocking, long-running process.**
- `src/bot/coach.ts` — the Claude conversation loop (Anthropic SDK + tool use).
- `src/bot/tools.ts` (353 lines) — on-demand tools (`get_recent_activities`,
  `get_week_plan`, `get_activity_detail`, `update_workout`, …) the model calls
  to read Garmin/Strava data and edit the plan.
- `src/bot/db.ts` + `src/bot/schema.sql` — two SQLite tables in the **same
  `coach.db`**: `messages` (conversation history per `chat_id`) and `plans`
  (training plan JSON per `chat_id`).
- `src/bot/config.ts` — config loader (see below).
- `src/cli.ts` — adds a `bot` command that lazy-imports and runs `startBot()`.
- `package.json` — adds two runtime deps: **`grammy` ^1.43.0** (Telegram bot
  framework) and **`@anthropic-ai/sdk` ^0.100.1** (the Claude API client).

### Library, transport, and where it runs

- **Library:** [grammy](https://grammy.dev) — a full Telegram Bot framework.
- **Transport: long polling.** `bot.start()` in `src/bot/index.ts` starts
  grammy's built-in long-polling loop (`getUpdates`). No webhook, no public URL
  needed. This is a deliberate choice that keeps it firewall-friendly but
  **requires a process to stay running**.
- **Where it runs: a long-running foreground daemon**, started manually:
  ```
  TELEGRAM_BOT_TOKEN=x ANTHROPIC_API_KEY=x npx claude-coach bot
  ```
  It is _not_ a cron job and _not_ part of the skill — it's a separate
  always-on process the user babysits (the commit message itself says
  "Long-running Telegram bot").

### What triggers messages / how it ties to coach data

In the fork, **the user triggers everything** — it is request/response, not
proactive push. A Telegram message in → `Coach.chat()` → Claude (with tools
that read activities/plan from `coach.db`) → reply out. The chat id comes from
`ctx.chat.id` on each inbound message; the bot only ever talks to people who
message it first. There is **no scheduler and no outbound/proactive
notification anywhere in this commit** — nothing here sends "drink water" or
"time for bed" on a timer. That proactive piece is exactly what Sprint 2 needs
and is _not_ present in the fork; we'd be building it ourselves.

### End-user setup burden (as implemented in the fork)

From `src/bot/config.ts` and the README diff:

- Create a bot via **@BotFather** and copy the bot token.
- Obtain an **`ANTHROPIC_API_KEY`** (because the fork runs Claude server-side).
- Start and keep alive a long-running process (`npx claude-coach bot`).
- Config is **env-var only**: `TELEGRAM_BOT_TOKEN` (required),
  `ANTHROPIC_API_KEY` (required), `CLAUDE_MODEL` (optional, default
  `claude-sonnet-4-20250514`), `MAX_CONTEXT_MESSAGES` (optional, default 50).
- `dbPath` defaults to `~/.claude-coach/coach.db` (`COACH_DB_PATH` override) —
  i.e. it reuses the same DB our project uses.
- **Notably, the fork never needs the user to find their chat id**, because it
  only replies to inbound messages. A _push_ use case (ours) does need a chat
  id — see the integration sketch for the one-time capture trick.

---

## Telegram as a PUSH channel for our use case

### Pros

- **Free**, no metering, generous rate limits for one-user personal use.
- **Trivial outbound API:** a single HTTPS POST to
  `…/bot<token>/sendMessage` with `{chat_id, text}`. No SDK, no framework — our
  existing `fetch`/`undici` is enough. (The fork pulls in grammy only because
  it needs _inbound_ handling; we don't.)
- **Reliable cross-platform push** to iOS, Android, desktop, web. Real
  lock-screen notifications via Telegram's own push infra — no APNs cert, no
  Firebase, no app-store account.
- **Cron-friendly:** our Sprint 2 agent already runs on a schedule; it just
  fires `coach notify` when a reminder is due. Stateless, no daemon.
- **Two-way later if wanted:** the same bot can grow into the fork's
  conversational coach without changing the push side.

### Cons

- **Outbound still needs _something_ to call the API at the right time.** That's
  our cron agent — Telegram doesn't schedule anything. (Same constraint applies
  to every option except a true OS-local scheduler.)
- **One-time user setup:** create a BotFather bot, paste a token, and capture
  the chat id once. More friction than zero-setup native notifications.
- **Not native iOS notifications** — they render as "Telegram" messages, not
  as a claude-coach app banner. Fine for reminders; not a branded experience.
- **Requires the Telegram app** installed and signed in on the phone.
- **Token is a secret** living in `coach.db`/env — must stay out of git and the
  packaged skill (our `.gitignore`/`.npmignore` already exclude `~/.claude-coach`).

### Alternatives compared (Telegram is the focus)

| Channel                                        | Phone push?            | User setup                       | Cost                      | Needs a sender process?                | Fit for cron reminders                                                                                         |
| ---------------------------------------------- | ---------------------- | -------------------------------- | ------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Telegram Bot API**                           | Yes, cross-platform    | Bot + token + chat id (one-time) | Free                      | Yes (our cron agent POSTs)             | **Strong** — simple, reliable, free                                                                            |
| Native macOS (`osascript`/`terminal-notifier`) | No (desktop only)      | None                             | Free                      | Local only; needs Mac awake & unlocked | Weak for "reach me on my phone"                                                                                |
| [ntfy.sh](https://ntfy.sh)                     | Yes (app or self-host) | Install app, pick a topic        | Free (public) / self-host | Yes (HTTP POST)                        | Good; even simpler than Telegram but needs its own app & topic is effectively public unless self-hosted/auth'd |
| Pushover                                       | Yes, native-feeling    | Buy app (~$5) + user/app key     | One-time paid             | Yes (HTTP POST)                        | Good, but paid and niche                                                                                       |
| Email (SMTP)                                   | Via mail app           | SMTP creds or relay              | Free-ish                  | Yes (SMTP send)                        | Poor latency/feel for nudges; easy to ignore                                                                   |

ntfy.sh is the closest free competitor and is arguably _simpler_ to send to (a
plain POST to `ntfy.sh/<topic>`), but Telegram wins on (a) the project/fork
already standardizing on it, (b) privacy (a guessable ntfy topic is world-
readable unless you self-host or add auth), and (c) the upgrade path to the
fork's two-way coach. **Recommend Telegram; keep the `notify` layer abstract
enough that ntfy or macOS can be a fallback/alternative backend.**

---

## Minimal integration sketch (fits our architecture)

Goal: deliver a reminder as a phone push with **no new dependencies** and **no
long-running process** — just one CLI subcommand the Sprint 2 cron agent calls.

### 1. Config: store token + chat id in `coach.db`

Extend the existing single-row `reminder_prefs` table (in
`src/db/schema.sql`, where bedtime/water/quiet-hours already live):

```sql
ALTER TABLE reminder_prefs ADD COLUMN telegram_bot_token TEXT;
ALTER TABLE reminder_prefs ADD COLUMN telegram_chat_id   TEXT;
ALTER TABLE reminder_prefs ADD COLUMN notify_channel     TEXT DEFAULT 'auto';
-- notify_channel: 'auto' | 'telegram' | 'stdout' | 'macos'
```

(Add via a `src/db/migrate.ts` migration so existing DBs upgrade in place.)
Env vars `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` override the DB values, mirroring
the fork's env-first style and keeping secrets out of the DB if preferred.
This keeps all reminder state in one place (`~/.claude-coach/coach.db`), which
the existing `getPrefs()`/`updatePrefs()` in `src/db/wellness.ts` already manage.

### 2. A tiny outbound sender (no grammy, no Anthropic SDK)

New file `src/notify/telegram.ts`:

```ts
export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
}
```

That's the entire transport. The proxy-aware global `fetch` dispatcher already
configured at the top of `src/cli.ts` covers it.

### 3. `coach notify` subcommand

Wire a `notify` command into the existing arg parser + `main()` switch in
`src/cli.ts` (same shape as the current `log`/`wellness`/`checkin` cases):

```
npx claude-coach notify "Time for water — 500ml to hit today's goal."
npx claude-coach notify --setup       # interactive: capture chat id (see §4)
npx claude-coach notify --test        # send a hello to verify wiring
```

Behavior of `runNotify(text)`:

1. Resolve token + chat id (env → `reminder_prefs`).
2. Pick channel from `notify_channel`: if `auto`, use Telegram when both token
   and chat id are present, otherwise fall back to stdout (and optionally a
   macOS `osascript` banner). **This guarantees reminders work even with zero
   setup** — Telegram is an upgrade, not a hard dependency.
3. Send; on failure log and fall back to stdout so a reminder is never silently
   lost.

### 4. One-time chat-id capture (`--setup`)

The fork never needs a chat id (it only replies to inbound messages). For push
we capture it once: after the user pastes a token, `--setup` calls
`getUpdates` once, tells the user to send any message to their bot, then reads
`result[].message.chat.id` and writes it to `reminder_prefs`. One plain HTTPS
GET — still no grammy.

### 5. How Sprint 2 triggers it

The Sprint 2 cron agent / `checkin` output owns the _decision_ logic that
already exists in `reminder_prefs`: respect `reminders_enabled`, `quiet_hours_*`,
`water_cadence_minutes`, and `bedtime_target`. When a reminder is due it simply
invokes `coach notify "<message>"`. Delivery is fully decoupled from scheduling,
so the same command serves cron pushes, in-session nudges, and manual tests.

### What we are deliberately NOT taking from the fork

- `grammy` and the whole `src/bot/` daemon — not needed for outbound push.
- `@anthropic-ai/sdk` and `coach.ts`/`tools.ts` — that's the conversational
  coach (a separate, larger feature), not a reminder channel.
- The `messages`/`plans` bot tables — irrelevant to notifications.

Net new footprint for Sprint 2 push: ~1 small file, ~1 CLI command, 3 DB
columns, **0 new npm dependencies**. The fork's long-running two-way bot remains
a clean, optional future upgrade on top of the same bot token.
