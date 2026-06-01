# Claude Coach

Claude Coach allows you to use Claude to create custom-tailored training programs for triathlons, marathons, and other endurance activities. Using a data-driven approach and principles from top training plans, Claude will create a training plan that's uniquely fit for you, your personal fitness, and the constraints you have in the next couple of weeks. Maybe you're recovering from an injury, maybe you're traveling and don't have access to a pool or track in a certain week - tell Claude about it and it'll create a plan that works for you.

The output is a beautiful training plan app that allows you to add, edit, or move workouts, mark them as complete, and update key training data like heart rate zones, LTHR, threshold paces, FTP, and others. Your data is kept locally in your browser.

Workouts can be exported as simple calendar events (.ics), Zwift (.zwo), Garmin (.fit), or TrainerRoad/ERG (.mrc) workouts.

## Examples

See example training plans at [felixrieseberg.github.io/claude-coach](https://felixrieseberg.github.io/claude-coach/#demos).

## Installation & Creating a training plan

I happen to work at Anthropic, so this tool is optimized for Claude. To use this tool, you need access to Claude.ai or Claude Code with network access for Skills. Depending on user/admin settings, Skills may have full, partial, or no network access.

Syncing all your Strava activities and creating a tailored training plan takes ca. 15 minutes.

### Installing the Skill

First, [download the latest skill from GitHub Releases](https://github.com/felixrieseberg/claude-coach/releases/latest/download/coach-skill.zip).

**Claude.ai:**

1. Open [Claude.ai Settings](https://claude.ai/settings/capabilities)
2. Enable "Code execution and file creation"
3. In the allowed domains list, add `*.strava.com`
4. Scroll down to "Skills" and click "Add skill", then upload the `coach-skill.zip` file

**Claude Code:**

1. Run `/install-skill` and provide the path to the `coach-skill.zip` file you downloaded.

### Creating a plan

Use the most capable model available to you (as I'm writing this, that's Opus 4.5). Prompt Claude with something like this:

> Help me create a training plan for the Ironman 70.3 Oceanside on March 29th 2026 using the "coach" skill.

Claude will ask how you'd like to provide your fitness data. You have a few options: you can tell Claude about your fitness history manually, give it access to your **Strava** activities, or connect **Garmin Connect** for recovery and readiness data. I recommend connecting your data - it doesn't lie, and more data allows Claude to make a training plan that really fits you.

**Strava vs. Garmin — which should I connect?**

- **Garmin Connect** is the best source for _recovery and readiness_ signals: sleep, HRV, body battery, stress, resting heart rate, training readiness, and Garmin's own training status (CTL/ATL/TSB) and VO₂max. Claude uses these as the primary signal for how hard to push on any given day.
- **Strava** is great for _activity history_: a long, portable record of your workouts across devices and apps. Claude uses it as the supporting record of what you've actually done.

They're complementary — connect both if you can. Garmin alone is enough for recovery-aware coaching; Strava alone is enough for a history-based plan.

#### Option 1: Connect Garmin Connect (Recommended for recovery & readiness)

Garmin access is provided through the [`garmin_mcp`](https://github.com/Taxuspt/garmin_mcp) MCP server (by Alexandre Domingues), which talks to Garmin Connect via the `garminconnect` library. You authenticate **once** in a terminal; tokens are saved locally (`~/.garminconnect`) and stay valid for ~6 months. Your Garmin credentials are only ever used to mint those tokens — they're not shared with anyone.

You need [`uv`](https://docs.astral.sh/uv/) installed (`brew install uv` on macOS, or see the uv docs).

**Step 1 — Authenticate with Garmin once:**

```bash
# Generates and stores OAuth tokens in ~/.garminconnect
GARMIN_EMAIL="you@example.com" GARMIN_PASSWORD="your-password" \
  uvx --python 3.12 --from git+https://github.com/Taxuspt/garmin_mcp garmin-mcp-auth
```

If your account has MFA enabled, you'll be prompted for the code. Once this succeeds you won't need your password again until the tokens expire.

**Step 2 — Register the MCP server.**

**Claude Code:**

```bash
claude mcp add garmin -s project \
  --env 'GARMINTOKENS=${HOME}/.garminconnect' \
  -- uvx --python 3.12 --from git+https://github.com/Taxuspt/garmin_mcp garmin-mcp
```

`-s project` writes a `.mcp.json` to the repo so the server is available whenever you work in this project (you'll be asked to approve it the first time you launch `claude`). Use `-s user` instead to make it available in every project. Run `claude mcp list` to confirm it shows up.

**Claude Desktop:**

Install the **Garmin Connect** desktop extension (`.dxt`/`.mcpb`) and enable it in **Settings → Extensions**. Leave the email/password fields blank if you already ran Step 1 — it will reuse the saved tokens. (Desktop extensions are managed separately from the "add MCP" / connectors list, so the Garmin server won't appear there to add manually — that's expected.)

> First run will take a moment while `uvx` downloads and resolves the package from GitHub.

#### Option 2: Connect to Strava (Recommended for activity history)

The easiest way to get a personalized plan is to let Claude analyze your Strava training history. This gives Claude real data about your current fitness, training patterns, and progress.

Claude needs a `Client ID` and `Client Secret` to access your Strava activities. You're only giving Claude access to your data - nobody else gets to see it.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and log in with your Strava account
2. You'll see a form titled "My API Application" - fill it out:
   - **Application Name**: Enter anything you like (e.g., "Claude Coach")
   - **Category**: Select "Data Importer"
   - **Club**: Leave this blank
   - **Website**: Enter any URL (e.g., `https://claude.ai`)
   - **Application Description**: Enter anything (e.g., "Training plan generation")
   - **Authorization Callback Domain**: Enter `localhost`
3. Check the box to agree to Strava's API Agreement and click **Create**
4. Copy your **Client ID** and **Client Secret** and give them to Claude when prompted

#### Option 3: Manual Entry

Don't use Strava or Garmin, or prefer not to connect them? No problem. You can tell Claude about your fitness directly. Be prepared to share:

**Current Training (recent 4-8 weeks):**

- Weekly training hours by sport (swim/bike/run)
- Typical long session distances (longest ride, longest run, etc.)
- Training consistency (how many weeks have you been training regularly?)

**Performance Benchmarks (any you know):**

- Bike FTP (Functional Threshold Power) in watts
- Run threshold pace or recent race times (5K, 10K, half marathon, etc.)
- Swim CSS (Critical Swim Speed) or recent time trial (e.g., 1000m time)
- Max heart rate and/or lactate threshold heart rate

### Telling Claude about your event & constraints

In the next step, Claude will ask you about yourself, the event you're training for, and any constraints it should keep in mind. Examples of information you'd tell any coach:

- Years in the sport
- Previous races completed (distances and approximate times)
- Any recent breaks from training
- Injuries or health issues
- Schedule limitations (work travel, family, etc.)
- Equipment access (pool availability, trainer, etc.)

Claude will use this information to create a plan tailored to your current fitness level. The more detail you provide, the better your plan will be.

# About

Claude Coach is an independent, open-source project and is not made by, endorsed by, or affiliated with Anthropic, PBC. "Claude" is a trademark of Anthropic. This tool is a skill/plugin that works with Claude products but is developed and maintained independently. License: MIT.
