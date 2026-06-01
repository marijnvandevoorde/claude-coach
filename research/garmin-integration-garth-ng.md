# Garmin Integration: Evaluating `cyberfossa/garth-ng` vs. `Taxuspt/garmin_mcp`

_Research date: 2026-06-01. All claims grounded in repo metadata, source, and PyPI/GitHub API queries cited inline._

## TL;DR

**Stay on `Taxuspt/garmin_mcp`.** `garth-ng` is not a replacement for our current integration — it is a _library_ (a maintained fork of the deprecated `matin/garth` auth/client), not an MCP server. The MCP server it advertises in its docs (`cyberfossa/garth-mcp-server`) **does not exist publicly** (GitHub returns 404), and the only real `garth`-based MCP server (`matin/garth-mcp-server`, ~30 tools) lacks the training-status / load-CTL-ATL-TSB / VO2max / readiness / FTP / lactate-threshold tools that Claude Coach's `skill/reference/garmin.md` depends on. Switching would mean either building and maintaining our own MCP wrapper around `garth-ng` or accepting a large coverage regression — neither outweighs the cost, since `garmin_mcp` is itself actively maintained (last commit 2026-05-27) and already exposes 110+ tools we call as `mcp__garmin__*`. The one genuinely interesting thing in `garth-ng` (a `curl_cffi`-based auth that survived Garmin's auth change) is an _upstream library_ concern, not something that changes our integration model.

---

## What each project is

### `cyberfossa/garth-ng` — a Python library (fork of garth), NOT an MCP server

- **Identity:** `fork: true`, `parent: matin/garth`. Description: "Garmin SSO auth + Connect Python client" (GitHub API `repos/cyberfossa/garth-ng`). The README states it plainly: _"a maintained continuation of the original `garth` library… The original project was deprecated after Garmin changed their auth flow. This fork restores compatibility."_
- **Parent is deprecated:** `matin/garth`'s own description is now `[DEPRECATED] Garmin SSO auth + Connect Python client` (GitHub API `repos/matin/garth`). So `garth-ng` exists specifically to keep the library alive.
- **Package:** published to PyPI as `garth-ng`, version `2.0.0-alpha` (`pyproject.toml`), but the import name stays `import garth` (drop-in, like Pillow's `PIL`). Build is `src/garth`.
- **License:** MIT (`repos/cyberfossa/garth-ng`).
- **Recency / activity:** very active. Last push `2026-05-26`; recent commits include `feat(sso): add stateless MFA API` (2026-05-25), `feat!: replace save/resume API with TokenStorage protocol` (2026-05-25). Created `2026-04-06`.
- **Popularity:** **2 stars**, 0 forks, `has_issues: false` (the 3 "open issues" are actually open PRs, e.g. #42 SSRF/token-storage hardening). This is a very young, low-adoption fork.
- **Auth approach (the fork's whole reason to exist):** changelog #3 — _"replace requests+OAuth1 with curl_cffi+DI-OAuth2, Strategy pattern."_ It uses `curl_cffi` (browser-TLS impersonation) to get past Garmin's updated SSO, OAuth2 token storage via a `TokenStorage` protocol (`FileTokenStorage`, `EnvTokenStorage`, base64 `GARTH_TOKEN`), and automatic MFA prompting with a new stateless `MFAChallenge` serialization for serverless flows. Note v2.0.0-alpha **broke** the old `garth.save()/resume()/dumps()/loads()` API (CHANGELOG breaking change).
- **Data coverage (as a library):** structured Pydantic classes exported from `src/garth/__init__.py` cover sleep (`SleepData`, `DailySleep`, `DailySleepData`), HRV (`HRVData`, `DailyHRV`), body battery (`BodyBatteryData`, `DailyBodyBatteryStress`), stress (`DailyStress`/`WeeklyStress`), steps, hydration, intensity minutes, heart rate, weight/body-composition, **training status** (`Daily/Weekly/MonthlyTrainingStatus`), **training readiness** (`TrainingReadinessData`, `MorningTrainingReadinessData`), Garmin scores, activities (`Activity`, `FitnessActivity`). Anything beyond those classes requires raw `garth.connectapi(endpoint)` calls.
- **Coverage GAPS vs. what Claude Coach uses:** no first-class wrappers for **training-load trend (CTL/ATL/TSB)**, **VO2max trend**, **cycling FTP**, **lactate threshold**, **endurance score / hill score**, **per-activity training effect**, activity splits/HR-zone/power-zone, FIT-file power-duration-curve. These exist in `garmin_mcp` as tools but would have to be hand-built on `garth-ng` via `connectapi()`.
- **The advertised MCP server is missing:** `docs/mcp.md` points users to `https://github.com/cyberfossa/garth-mcp-server`. That repo **404s** (`gh api repos/cyberfossa/garth-mcp-server` → `Not Found`), and `cyberfossa` only has two public repos: `garth-ng` and `garth-relay` (a "relay health metrics to Garmin" tool). The tool list in `docs/mcp.md` is identical to `matin/garth-mcp-server`'s — it appears copied from upstream and points at a fork that was never published. **So there is no ready-made garth-ng MCP server to adopt.**

### `Taxuspt/garmin_mcp` — a ready-made MCP server (our current integration)

- **Identity:** a real MCP server. Description: "MCP server to access Garmin data" (`repos/Taxuspt/garmin_mcp`). Not a fork.
- **Underlying library:** built on `cyberjunky/python-garminconnect` (README line 7), **not** garth directly. A recent commit even removed residual garth usage: _"replace garth references in courses.py with garminconnect 0.3.x client API"_ (2026-05-25).
- **License:** MIT.
- **Recency / activity:** actively maintained — last push `2026-05-27`, recent commits add pagination and activity event-type fields (2026-05-27).
- **Popularity:** **563 stars**, 155 forks, 3 open issues — far more adopted/battle-tested than garth-ng.
- **Auth & tokens:** dedicated `garmin-mcp-auth` pre-auth CLI; OAuth tokens saved to `~/.garminconnect` (our `.mcp.json` sets `GARMINTOKENS=${HOME}/.garminconnect`). Handles MFA interactively at pre-auth time; tokens last ~6 months. Supports China region (`GARMIN_IS_CN`) and file-based secrets.
- **Data coverage:** **110+ tools (~90% of python-garminconnect v0.3.2)**: Activity Management (15), Health & Wellness (31), Training & Performance (13 — explicitly CTL/ATL/TSB, HRV, VO2max, respiration trends), Workouts (8) + high-level workout builders, Devices (7), Gear (5), Weight (5), Challenges (10), Nutrition (8), Women's Health (3), User Profile (3), Courses (3), Activity Analysis (2 — FIT parsing, power-duration-curve). `src/garmin_mcp/training.py` confirms tools like `get_training_status`, `get_training_load_trend`, `get_vo2max_trend` (via status), `get_cycling_ftp`, `get_lactate_threshold`, `get_hrv_trend`, `get_endurance_score`, `get_hill_score`, `get_training_effect`, `get_fitnessage_data`.
- **Tool filtering:** `GARMIN_ENABLED_TOOLS` / `GARMIN_DISABLED_TOOLS` env vars to trim context.

### `matin/garth-mcp-server` — the only real garth-based MCP server (for completeness)

- The original author's MCP server, "based on garth," published to PyPI as `garth-mcp-server`. **62 stars**, last push `2026-02-01` (less active than garmin_mcp), MIT.
- **~30 tools** (README): sleep, stress, intensity minutes, body battery, hydration, steps, HRV, activities + splits/weather, body composition, respiration, SpO2, blood pressure, devices/gear, plus a generic `get_connectapi_endpoint`.
- **Critically lacks** training status, load (CTL/ATL/TSB), VO2max, training readiness, FTP, lactate threshold, endurance/hill score, training effect — i.e. most of Claude Coach's Section 1–3 "readiness & load" signals. It is built on the _deprecated_ `matin/garth`, **not** `garth-ng`.

---

## Comparison

| Dimension                 | `Taxuspt/garmin_mcp` (current)                                                                            | `cyberfossa/garth-ng` (candidate)                                     | `matin/garth-mcp-server` (garth's MCP)                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **What it is**            | Ready-made MCP server                                                                                     | **Library only** (garth fork)                                         | Ready-made MCP server                                                 |
| **Integration model**     | Drop-in `mcp__garmin__*` (already wired in `.mcp.json`)                                                   | Would need us to **build/maintain an MCP wrapper**                    | Drop-in MCP, but small toolset                                        |
| **Underlying lib**        | `python-garminconnect` (cyberjunky), actively maintained                                                  | self (garth fork)                                                     | deprecated `matin/garth`                                              |
| **Auth**                  | `garmin-mcp-auth` CLI → `~/.garminconnect` tokens, MFA, CN region                                         | curl_cffi OAuth2, `TokenStorage`/`GARTH_TOKEN`, stateless MFA         | garth OAuth2, `GARTH_TOKEN`                                           |
| **Health/recovery data**  | sleep, HRV, body battery, stress, RHR, hydration, steps (31 wellness tools)                               | structured classes for all of these                                   | ~same set as garth-ng                                                 |
| **Training/load data**    | **CTL/ATL/TSB, VO2max trend, FTP, lactate threshold, endurance/hill score, training effect, fitness age** | training status + readiness classes only; **rest via raw connectapi** | **none of these**                                                     |
| **Activity analysis**     | splits, HR/power zones, FIT parse, power-duration-curve                                                   | none (raw connectapi)                                                 | basic splits/weather only                                             |
| **Write-back**            | hydration, body comp, workout create/schedule                                                             | weight/body-comp upload (lib)                                         | none                                                                  |
| **Maintenance**           | last push 2026-05-27, 563★, 155 forks                                                                     | last push 2026-05-26, **2★**, very young                              | last push 2026-02-01, 62★                                             |
| **License**               | MIT                                                                                                       | MIT                                                                   | MIT                                                                   |
| **Maturity/risk**         | Mature, widely used                                                                                       | Pre-1.0-feel `2.0.0-alpha`, breaking-change churn, tiny adoption      | Modest                                                                |
| **Migration cost for us** | **zero (status quo)**                                                                                     | **high** (rebuild MCP layer + re-map ~all tools, or lose coverage)    | medium-high (rewrite reference doc to ~30 tools, lose load/readiness) |

### Migration cost for THIS project

Claude Coach calls Garmin purely as `mcp__garmin__*` tools, with `skill/reference/garmin.md` mapping ~40 named tools to coaching decisions (training readiness, body battery, sleep, HRV, RHR, stress, **training status, load CTL/ATL/TSB, VO2max trend, FTP, lactate threshold, endurance/hill score, training effect**, activity splits/zones, daily stats, hydration write-back). The `.mcp.json` is one `uvx` stanza.

- **Switching to garth-ng (library):** there is no MCP server to point at, so we'd have to author a new MCP server (or a CLI bridge) wrapping garth-ng, implement and name-match every tool the skill references, re-write `skill/reference/garmin.md`, update `.mcp.json`, and own the maintenance + the auth/token UX (which just changed in a breaking 2.0.0-alpha). The load/readiness tools we rely on aren't first-class in garth-ng, so we'd be writing raw `connectapi()` endpoint code ourselves. This is effectively rebuilding what `garmin_mcp` already gives us for free. **High cost, negative ROI.**
- **Switching to matin/garth-mcp-server (real garth MCP):** lower effort (it's a drop-in MCP), but it exposes ~30 tools and is missing the entire training-status/load/readiness/threshold layer the coach is built around — a major capability regression — and it rides on the _deprecated_ garth (not even garth-ng). **Not viable for our use case.**

### Risks (common to all — unofficial Garmin API)

- All three use **unofficial, reverse-engineered Garmin endpoints**; Garmin can break auth at any time (it already did once — that's why garth was deprecated and garth-ng exists). This risk is shared and is not a differentiator that favors switching.
- `garth-ng`'s value is precisely _resilience to that auth breakage_ via `curl_cffi` impersonation. But that benefit lives in the **library layer**, and `garmin_mcp` depends on `python-garminconnect`, which is separately and actively maintained for the same auth changes. We are not currently blocked by auth, so this is not an acute problem to solve.
- `garth-ng` specifics: tiny adoption (2★), `2.0.0-alpha` with breaking API churn, `has_issues` disabled (no public bug intake), and its own docs advertise a non-existent MCP server — signs of an early-stage project not yet ready to depend on for a coaching workflow.

---

## Recommendation

**Stay on `Taxuspt/garmin_mcp`. Do not switch to `garth-ng`.**

Reasoning:

1. **Category mismatch.** `garth-ng` is a library, not an MCP server; our integration consumes `mcp__garmin__*` tools. The advertised `cyberfossa/garth-mcp-server` is a 404 — there is nothing ready-made to adopt.
2. **Coverage regression.** The only real garth-based MCP (`matin/garth-mcp-server`, ~30 tools) drops the training-status / load (CTL-ATL-TSB) / VO2max / readiness / FTP / lactate-threshold tools that are the core of Claude Coach's recovery-and-load model. `garmin_mcp` covers all of them (110+ tools).
3. **Maintenance & maturity favor the status quo.** `garmin_mcp` is actively maintained (2026-05-27), widely used (563★), and already wired into `.mcp.json`. `garth-ng` is a 2★ pre-release fork.
4. **No advantage worth the rebuild.** `garth-ng`'s real edge (curl_cffi auth resilience) is an upstream-library matter; `garmin_mcp` gets equivalent auth maintenance from `python-garminconnect`. We are not currently auth-blocked, so there's no problem to migrate toward.

**When to revisit:**

- If `garmin_mcp` / `python-garminconnect` breaks on a future Garmin auth change and is slow to fix, while `garth-ng` (curl_cffi) keeps working — re-evaluate the auth layer then.
- If a real, well-covered `garth-ng`-based MCP server appears (i.e. `cyberfossa/garth-mcp-server` actually ships with training-load/readiness tools), reassess; today it does not exist.
- A low-cost **hybrid hedge** (optional, not now): keep `garmin_mcp` as primary, and if/when auth breakage hits, consider `garth-ng` purely as the auth/token-minting layer feeding tokens to a client — but only if `garmin_mcp` can't be repaired faster upstream.

### Unknowns / not verified

- Could not query PyPI directly (network/WebFetch blocked in this environment) to confirm `garth-ng`'s exact latest upload timestamp or the `garth-mcp-server` PyPI entry; GitHub data and `garth-ng`'s own `pyproject.toml` (`version = "2.0.0-alpha"`) are the basis for version claims. The GitHub 404 for `cyberfossa/garth-mcp-server` and the repo listing (only `garth-ng` + `garth-relay`) are confirmed via `gh api`.
