# Deploying Claude Coach

**One image, two services.** A single image (built by the GitHub Action, published to GHCR) runs as:

- **`coach`** — the always-on reminder cron (Tier 1). Outbound-only → **no ingress**.
- **`coach-mcp`** — the remote MCP (Tier 2), the same image in `mcp` mode, behind **your reverse proxy + Cloudflare Access**.

The compose files just **pull** the image. Tier 1 is built and ready; Tier 2's MCP server is built and runs in `mcp` mode — you wire it to your own proxy (kept out of this repo).

---

## Tier 1 — always-on reminder service

A super-light `node:22-alpine` image runs the CLI on a cron schedule: `checkin --notify` → your push webhook (Home Assistant). Outbound-only, so **no open ports, no proxy**.

### What's where

- `Dockerfile` — multi-stage build (compile TS → run prod-only).
- `scheduling/docker-entrypoint.sh` — builds a crontab from env and runs `crond`. With args it runs the CLI (`docker compose run --rm coach wellness`); with `mcp` it runs the MCP server.
- `docker-compose.yml` + `.env.example` — committed template; **pulls** the published image.
- `.github/workflows/docker-build.yml` — **manually-triggered** (`workflow_dispatch`) multi-arch (amd64 + arm64) build pushing `ghcr.io/<you>/claude-coach:<tag>`.

> Keep your real bundle — `.env` (with secrets), a copy of `coach.db`, Garmin tokens, and any host-specific (reverse-proxy) compose — in a **gitignored** directory; never commit it.

### Step 1 — publish the image (the manual Action)

GitHub → **Actions → "Build Docker image" → Run workflow** (pick a tag). It builds and pushes `ghcr.io/<you>/claude-coach:latest`. Re-run whenever you ship new code.

### Step 2 — run it

```bash
docker login ghcr.io                     # once: GitHub PAT with read:packages (or make the package public)
docker compose pull
docker compose up -d
docker compose run --rm coach config --enable          # enable reminders in the db
docker compose run --rm coach notify "alive ✅"         # test the push to your phone
docker compose logs -f
```

Drop `coach.db` + `garmin_tokens.json` into `./data/` and `cp .env.example .env` first. No registry? Build locally: `docker build -t ghcr.io/<you>/claude-coach:latest .`.

### Config knobs (env)

| Var                                                                  | What                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `TZ`                                                                 | Local timezone — reminders fire in local time (needs `tzdata`, baked in). |
| `COACH_DB_PATH`                                                      | DB path in the container (default `/data/coach.db`).                      |
| `GARMINTOKENS`                                                       | Garmin tokens dir (default `/data/garminconnect`).                        |
| `COACH_NOTIFY_CHANNEL` / `COACH_NOTIFY_WEBHOOK_URL`                  | Push channel + webhook (your HA webhook).                                 |
| `COACH_AUTH_SECRET`                                                  | Bearer secret for the Tier 2 MCP (unused by the cron).                    |
| `COACH_MCP_PORT`                                                     | MCP listen port (default `8080`).                                         |
| `COACH_MORNING_CRON` / `COACH_HYDRATION_CRON` / `COACH_BEDTIME_CRON` | Override the schedules.                                                   |

> **Known limit:** the container's morning check-in reads the **cached** Garmin snapshot in `coach.db`. Hydration + bedtime work fully offline; live overnight readiness needs a Garmin sync into the db.

---

## Tier 2 — coach as a remote MCP

Goal: talk to the coach (`log`, `checkin`, `wellness`, `config`, `export_calendar`, `export_garmin`, `notify`, cached Garmin reads) from **any** Claude client — Desktop, web, phone — with no local install.

### How it runs

The published image runs the MCP in `mcp` mode (`command: ["mcp"]`): an Express server on `COACH_MCP_PORT` (default 8080), `/health` open, optional `Bearer COACH_AUTH_SECRET`. Add it as a **second service** sharing the `/data` volume, and put it behind:

1. **Your reverse proxy** (nginx, Caddy, etc.) terminating TLS for a hostname like `coach.example.com` → `coach-mcp:8080`. Keep this host-specific compose/proxy config in your gitignored bundle.
2. **Cloudflare Access** in front (proxied DNS). Humans get SSO; machines (Claude) authenticate with a **Service Token** — header auth that skips the interactive login.

### Cloudflare Access (do this now)

1. **Access application** — Zero Trust → Access → Applications → _Self-hosted_, your hostname.
2. **Service token** — Zero Trust → Access → Service Auth → _Create Service Token_. Save the **Client ID** + **Client Secret**.
3. **Policy** — Allow, include = that Service Token (the non-interactive path for Claude). Optionally a second Allow for your email (browser). Else deny.

### Connect Claude

**Claude Code** (the reliable client for header-auth MCPs):

```bash
claude mcp add coach --transport http https://coach.example.com/mcp \
  --header "CF-Access-Client-Id: <token-client-id>" \
  --header "CF-Access-Client-Secret: <token-client-secret>"
```

**Claude Desktop / claude.ai:** custom connectors expect OAuth rather than static headers, so use Claude Code for the coach MCP, or front it with an OAuth2 layer if you need Desktop/phone.

### Security model

- Cloudflare proxied + Access = nothing reaches the origin without a valid identity **or** the service token.
- `COACH_AUTH_SECRET` = belt-and-suspenders bearer check in the app.
- Garmin tokens + `coach.db` stay on your host volume; the unofficial Garmin API is personal-use only.
- Single-user: one `coach.db`, your tokens — don't multi-tenant.
