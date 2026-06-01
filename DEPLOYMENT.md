# Deploying Claude Coach

**One image, two services.** A single image (built by the GitHub Action, published to GHCR) runs as:

- **`coach`** — the always-on reminder cron (Tier 1). Outbound-only → **no ingress**.
- **`coach-mcp`** — the remote MCP (Tier 2), the same image in `mcp` mode, with **built-in Google OAuth** so any Claude client (Desktop, web, mobile, Code) can use it.

The compose files just **pull** the image.

---

## Tier 1 — always-on reminder service

A super-light `node:22-alpine` image runs the CLI on a cron schedule: `checkin --notify` → your push webhook (Home Assistant). Outbound-only, so **no open ports, no proxy**.

### What's where

- `Dockerfile` — multi-stage build (compile TS → run prod-only).
- `scheduling/docker-entrypoint.sh` — builds a crontab from env and runs `crond`. With args it runs the CLI (`docker compose run --rm coach wellness`); with `mcp` it runs the MCP server.
- `docker-compose.yml` + `.env.example` — committed template; **pulls** the published image.
- `.github/workflows/docker-build.yml` — **manually-triggered** (`workflow_dispatch`) multi-arch (amd64 + arm64) build pushing `ghcr.io/<you>/claude-coach:<tag>`.

> Keep your real bundle — `.env` (with secrets), a copy of `coach.db`, Garmin tokens, and any host-specific compose — in a **gitignored** directory; never commit it.

### Step 1 — publish the image (the manual Action)

GitHub → **Actions → "Build Docker image" → Run workflow** (or `gh workflow run "Build Docker image"`). It builds and pushes `ghcr.io/<you>/claude-coach:latest`.

### Step 2 — run it

```bash
docker login ghcr.io                     # once: GitHub PAT with read:packages (or make the package public)
docker compose pull
docker compose up -d
docker compose run --rm coach config --enable          # enable reminders in the db
docker compose run --rm coach notify "alive ✅"         # test the push to your phone
docker compose logs -f
```

Drop `coach.db` + `garmin_tokens.json` into `./data/` and `cp .env.example .env` first.

### Config knobs (env)

| Var                                                                  | What                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `TZ`                                                                 | Local timezone — reminders fire in local time (needs `tzdata`, baked in). |
| `COACH_DB_PATH` / `GARMINTOKENS`                                     | DB + Garmin-tokens paths in the container (default under `/data`).        |
| `COACH_NOTIFY_CHANNEL` / `COACH_NOTIFY_WEBHOOK_URL`                  | Push channel + webhook (your HA webhook).                                 |
| `COACH_MORNING_CRON` / `COACH_HYDRATION_CRON` / `COACH_BEDTIME_CRON` | Override the schedules.                                                   |

> **Live Garmin data:** the image bundles a python fetcher (`garmin-fetch`) that logs in to Garmin Connect with the tokens in `GARMINTOKENS` and writes a fresh wellness snapshot + recent activities into `coach.db`. A cron job runs it at **07:15** (override `COACH_GARMIN_FETCH_CRON`), just before the 07:30 check-in, so morning readiness/sleep are current. Trigger it on demand with `docker compose run --rm coach garmin-fetch`, or from any Claude client via the `garmin_refresh` MCP tool. Hydration + bedtime still work fully offline.

---

## Tier 2 — coach as a remote MCP (with built-in OAuth)

Talk to the coach (`log`, `checkin`, `wellness`, `config`, `garmin_refresh` live Garmin pull, `export_calendar`, `export_garmin`, `notify`) from **any** Claude client — including **mobile** — with no local install.

`coach-mcp` runs its **own** OAuth server and federates the login to **Google**, restricted to your email. Claude auto-registers (no manual Client ID), you sign in with Google, done.

### How it runs

Same image, `mcp` mode (`command: ["mcp"]`): an Express server on `COACH_MCP_PORT` (default 8080), `/health` open. Add it as a **second service** sharing the `/data` volume, behind your reverse proxy terminating TLS for `coach.example.com` → `coach-mcp:8080`.

> **Do not put Cloudflare Access in front of this host** — `coach-mcp` does its own auth, and Access would block the OAuth discovery/callback. Keep DNS **proxied** (TLS/DDoS) but with **no Access policy** on the MCP hostname.

### Step A — create a Google OAuth client (one-time)

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URI** (exactly): `https://coach.example.com/oauth/google/callback` — i.e. your `COACH_OAUTH_ISSUER` + `/oauth/google/callback`.
3. Configure the OAuth **consent screen** if prompted (External; add yourself as a test user).
4. Copy the **Client ID** + **Client Secret**.

### Step B — enable OAuth (env on `coach-mcp`)

Set all of these and OAuth turns on (the static `COACH_AUTH_SECRET` is then ignored):

| Var                                         | What                                                         |
| ------------------------------------------- | ------------------------------------------------------------ |
| `COACH_OAUTH_ISSUER`                        | The MCP's public base URL, e.g. `https://coach.example.com`. |
| `COACH_OAUTH_ALLOWED_EMAILS`                | Comma-separated allowlist (your Google email).               |
| `COACH_OAUTH_SIGNING_SECRET`                | Long random string — signs the access tokens.                |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Step A.                                                 |

### Step C — connect Claude (every client, incl. mobile)

Add a **custom connector** pointing at `https://coach.example.com/mcp` — on Desktop, claude.ai web, **mobile**, or Code. Claude auto-registers (DCR), bounces you to Google, you sign in with the allowed email, and you're connected. No headers, no `mcp-remote`, no service token. Upload the skill zip alongside it — they work together (the skill is MCP-aware).

### How the auth works

- `coach-mcp` advertises itself as the authorization server (`/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource`), supports **dynamic client registration**, runs **authorization-code + PKCE**, and federates login to **Google**.
- On success it issues a short-lived HS256 JWT (signed with `COACH_OAUTH_SIGNING_SECRET`); `/mcp` requires a valid one. Only `COACH_OAUTH_ALLOWED_EMAILS` get through.
- Registered clients persist to `oauth-clients.json` in `/data`; `coach.db` + Garmin tokens stay on your volume. Single-user, personal use.

> Not yet verified end-to-end here (OAuth handshakes are fiddly). If a client errors: check `docker compose logs -f coach-mcp`, confirm the Google redirect URI matches `ISSUER/oauth/google/callback` **exactly**, and that `coach.example.com` is reachable **without** a Cloudflare Access challenge.
