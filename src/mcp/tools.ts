/**
 * The coach MCP tool table — pure data + arg-mapping. Kept free of side effects
 * (no server, no spawn) so the contract can be unit-tested. server.ts execs the
 * CLI args these produce; this module only decides argv + stdin per tool.
 */

export type Args = Record<string, unknown>;
export interface ToolDef {
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  toArgs: (a: Args) => string[];
  /** Optional: content to pipe to the CLI's stdin (e.g. large file bodies). */
  stdin?: (a: Args) => string | undefined;
}

/** Append `--key=value` for each present key. */
function flags(a: Args, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) if (a[k] !== undefined && a[k] !== null) out.push(`--${k}=${a[k]}`);
  return out;
}

/** Plan source args for the plan-consuming CLI commands: inline `plan` via stdin,
 *  a `file` path, or — the default — `--active` (the stored active plan). */
function planSource(a: Args): string[] {
  if (typeof a.plan === "string") return ["--stdin"];
  if (typeof a.file === "string") return [String(a.file)];
  return ["--active"];
}

export const TOOLS: Record<string, ToolDef> = {
  wellness: {
    description: "Today's hydration + wellness snapshot (water vs goal, sleep, readiness, energy).",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
    },
    toArgs: (a) => ["wellness", "--json", ...flags(a, ["date"])],
  },
  log: {
    description:
      "Log a wellness/intake value: water (ml), sleep (hours), energy|soreness|mood (1-5), weight (kg).",
    inputSchema: {
      type: "object",
      required: ["type", "value"],
      properties: {
        type: { type: "string", enum: ["water", "sleep", "energy", "soreness", "mood", "weight"] },
        value: { type: "number" },
        date: { type: "string" },
        score: { type: "number", description: "sleep score (optional)" },
        note: { type: "string" },
      },
    },
    toArgs: (a) => ["log", String(a.type), String(a.value), ...flags(a, ["date", "score", "note"])],
  },
  config: {
    description:
      "Show or update reminder preferences. Pass fields to update; omit all to just read.",
    inputSchema: {
      type: "object",
      properties: {
        bedtime: { type: "string", description: "HH:MM" },
        wake: { type: "string", description: "HH:MM" },
        "water-goal": { type: "number" },
        "quiet-start": { type: "string" },
        "quiet-end": { type: "string" },
        cadence: { type: "number" },
        "move-cadence": { type: "number", description: "min between move nudges (0 = off)" },
        "hydration-per-hour": { type: "number" },
        "notify-webhook": { type: "string" },
        "notify-channel": { type: "string", enum: ["auto", "webhook", "macos", "stdout"] },
        enabled: { type: "boolean", description: "enable/disable reminders" },
      },
    },
    toArgs: (a) => {
      const f = [
        "config",
        "--json",
        ...flags(a, [
          "bedtime",
          "wake",
          "water-goal",
          "quiet-start",
          "quiet-end",
          "cadence",
          "move-cadence",
          "hydration-per-hour",
          "notify-webhook",
          "notify-channel",
        ]),
      ];
      if (a.enabled === true) f.push("--enable");
      if (a.enabled === false) f.push("--disable");
      return f;
    },
  },
  checkin: {
    description:
      "Assemble today's coaching/reminder payload (plan day + Garmin signals + hydration/recovery). Pass Garmin signals you fetched.",
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "inline training plan JSON content (preferred for plans built in chat)",
        },
        planFile: { type: "string", description: "path to a plan JSON file (alternative to plan)" },
        readiness: { type: "number" },
        "sleep-hours": { type: "number" },
        "sleep-score": { type: "number" },
        "body-battery": { type: "number" },
        "resting-hr": { type: "number" },
        "hrv-status": { type: "string" },
        "training-status": { type: "string" },
        "training-minutes": { type: "number" },
        date: { type: "string" },
      },
    },
    toArgs: (a) => {
      const f = [
        "checkin",
        "--json",
        ...flags(a, [
          "readiness",
          "sleep-hours",
          "sleep-score",
          "body-battery",
          "resting-hr",
          "hrv-status",
          "training-status",
          "training-minutes",
          "date",
        ]),
      ];
      // Inline plan goes via stdin (--plan-stdin); a path is passed as --plan=.
      if (typeof a.plan === "string") f.push("--plan-stdin");
      else if (typeof a.planFile === "string") f.push(`--plan=${a.planFile}`);
      return f;
    },
    stdin: (a) => (typeof a.plan === "string" ? a.plan : undefined),
  },
  garmin_refresh: {
    description:
      "Pull live data directly FROM Garmin Connect and store it in coach.db: readiness, sleep (+score), HRV (status, weekly avg, baseline + nightly readings), body battery (wake + charged), resting HR (+ 7-day avg), VO2max, daily steps/distance/floors, moderate/vigorous intensity minutes, active/total calories, SpO2, waking respiration, training status + acute/chronic load + ACWR, and recent activities. Also stores a full raw JSON blob (garmin_raw: sleep stages, HRV readings, load focus, heat/altitude acclimation) for deeper reasoning. This is the real 'sync with Garmin' — it fetches on the server using the saved Garmin tokens. (Contrast garmin_sync, which only caches numbers you pass in.)",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
    },
    toArgs: (a) => ["garmin-fetch", "--json", ...flags(a, ["date"])],
  },
  garmin_sync: {
    description:
      "Cache Garmin metrics you ALREADY have (readiness, sleep, HRV, body battery, …) into coach.db. Does NOT contact Garmin — pass the values in. To fetch live from Garmin, use garmin_refresh.",
    inputSchema: {
      type: "object",
      properties: {
        readiness: { type: "number" },
        "sleep-hours": { type: "number" },
        "sleep-score": { type: "number" },
        "body-battery": { type: "number" },
        "resting-hr": { type: "number" },
        "hrv-status": { type: "string" },
        "training-status": { type: "string" },
        "training-minutes": { type: "number" },
        date: { type: "string" },
      },
    },
    toArgs: (a) => [
      "garmin-sync",
      ...flags(a, [
        "readiness",
        "sleep-hours",
        "sleep-score",
        "body-battery",
        "resting-hr",
        "hrv-status",
        "training-status",
        "training-minutes",
        "date",
      ]),
    ],
  },
  export_calendar: {
    description:
      "Turn a training plan into a calendar event list (JSON) for pushing to Google Calendar. Defaults to the stored ACTIVE plan (no args needed); or pass the plan inline as `plan`, or a server-readable `file` path.",
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "inline training plan JSON (omit to use the active plan)",
        },
        file: { type: "string", description: "path to a plan JSON file (alternative to plan)" },
      },
    },
    toArgs: (a) => ["export-calendar", ...planSource(a), "--json"],
    stdin: (a) => (typeof a.plan === "string" ? a.plan : undefined),
  },
  export_garmin: {
    description:
      "Turn a training plan into structured Garmin workout records (to create + schedule on the watch). Defaults to the stored ACTIVE plan; or pass `plan` inline or a `file` path.",
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "inline training plan JSON (omit to use the active plan)",
        },
        file: { type: "string", description: "path to a plan JSON file (alternative to plan)" },
      },
    },
    toArgs: (a) => ["export-garmin", ...planSource(a)],
    stdin: (a) => (typeof a.plan === "string" ? a.plan : undefined),
  },
  schedule_workouts: {
    description:
      "Create + schedule a training plan's workouts directly on Garmin Connect (they sync to the athlete's watch). Defaults to the stored ACTIVE plan, so 'push the plan to Garmin' needs no arguments; or pass `plan` inline / a `file` path. Re-pushing OVERRIDES in place (updates each workout) and prunes any it no longer contains; a workout deleted by hand on Garmin is recreated automatically. Optional from/to limit the date window. replace:true forces a clean rebuild (delete each + create fresh). dryRun:true previews payloads without pushing. Returns an explicit {pushed,failed,pruned,...} summary.",
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "inline training plan JSON (omit to use the active plan)",
        },
        file: { type: "string", description: "path to a plan JSON file (alternative to plan)" },
        from: { type: "string", description: "only push workouts on/after this date (YYYY-MM-DD)" },
        to: { type: "string", description: "only push workouts on/before this date (YYYY-MM-DD)" },
        replace: {
          type: "boolean",
          description: "delete each existing workout and create it fresh (clean rebuild)",
        },
        dryRun: { type: "boolean", description: "build payloads only; push nothing" },
      },
    },
    toArgs: (a) => {
      const f = ["garmin-push", ...planSource(a), "--json"];
      if (a.dryRun === true) f.push("--dry-run");
      if (a.replace === true) f.push("--replace");
      if (typeof a.from === "string") f.push(`--from=${a.from}`);
      if (typeof a.to === "string") f.push(`--to=${a.to}`);
      return f;
    },
    stdin: (a) => (typeof a.plan === "string" ? a.plan : undefined),
  },
  generate_plan: {
    description:
      "Generate a ramp-safe, goal-anchored plan SKELETON from the stored A-race goal + availability + the athlete's measured fitness. Returns dated weeks each carrying a load ENVELOPE (target/low/high EFD + D+, long-run EFD, easy/quality split, day slots, phase, deloads, taper) — code owns these numbers. You then FILL each day's actual workout to hit the week's envelope and call save_plan. Requires a goal (distance+vert+date) and availability set first (see athlete_info). Pass from:'YYYY-MM-DD' to re-periodize the remaining weeks from that date with current fitness.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "re-periodize from this date (YYYY-MM-DD); omit to plan from today",
        },
      },
    },
    toArgs: (a) => ["plan", "generate", "--json", ...flags(a, ["from"])],
  },
  save_plan: {
    description:
      "Save (create or update) a training plan and make it the ACTIVE plan — the one the app shows and Garmin/calendar push use. Pass the full TrainingPlan JSON inline as `plan`; it's keyed by meta.id, so re-saving the same id updates it in place.",
    inputSchema: {
      type: "object",
      required: ["plan"],
      properties: { plan: { type: "string", description: "the full TrainingPlan JSON" } },
    },
    toArgs: () => ["plan", "save", "--stdin", "--json"],
    stdin: (a) => (typeof a.plan === "string" ? a.plan : undefined),
  },
  list_plans: {
    description: "List saved training plans (id, event, dates, and which is active).",
    inputSchema: { type: "object", properties: {} },
    toArgs: () => ["plan", "list", "--json"],
  },
  get_plan: {
    description: "Fetch a saved plan's full JSON. Omit `id` to get the active plan.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "plan id (default: the active plan)" } },
    },
    toArgs: (a) =>
      typeof a.id === "string"
        ? ["plan", "get", String(a.id), "--json"]
        : ["plan", "get", "--json"],
  },
  activate_plan: {
    description: "Make a saved plan the active one (the app + Garmin/calendar push target).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    toArgs: (a) => ["plan", "activate", String(a.id), "--json"],
  },
  delete_plan: {
    description: "Delete a saved training plan by id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    toArgs: (a) => ["plan", "delete", String(a.id), "--json"],
  },
  plan_today: {
    description:
      "The active plan's session(s) for a date (default today) — what's scheduled, rest days dropped.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default today)" } },
    },
    toArgs: (a) => ["plan", "show-today", "--json", ...flags(a, ["date"])],
  },
  plan_upcoming: {
    description:
      "Upcoming planned sessions from the active plan over the next N days (default 14).",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "window size in days (default 14)" },
        date: { type: "string", description: "start date (default today)" },
      },
    },
    toArgs: (a) => ["plan", "upcoming", "--json", ...flags(a, ["days", "date"])],
  },
  upload_route: {
    description:
      "Upload a GPX route to Garmin as a course, kept EXACTLY as-is (no point reduction, no snap-to-roads). Pass the GPX either as inline `gpx` content (e.g. a file dropped into the conversation) or as a server-readable `file` path, plus an optional name (defaults to the GPX track name) and course type. dryRun parses + builds the payload without uploading.",
    inputSchema: {
      type: "object",
      properties: {
        gpx: {
          type: "string",
          description: "inline GPX file content (preferred for files in chat)",
        },
        file: {
          type: "string",
          description: "path to a .gpx file readable by the coach server (alternative to gpx)",
        },
        name: { type: "string", description: "course name (defaults to the GPX track name)" },
        type: {
          type: "string",
          description: "course type: run, trail, road, mtb, gravel, cycling, hike, walk",
        },
        dryRun: { type: "boolean", description: "parse + build payload only; upload nothing" },
      },
    },
    toArgs: (a) => {
      // Inline content goes via stdin (--stdin); a path is passed positionally.
      const f =
        typeof a.gpx === "string"
          ? ["garmin-route", "--stdin", "--json", ...flags(a, ["name", "type"])]
          : ["garmin-route", String(a.file), "--json", ...flags(a, ["name", "type"])];
      if (a.dryRun === true) f.push("--dry-run");
      return f;
    },
    stdin: (a) => (typeof a.gpx === "string" ? a.gpx : undefined),
  },
  backfill: {
    description:
      "Backfill historical Garmin data into coach.db over a date range. Default uses the cheap multi-day range endpoints (steps/distance/floors/stress/resting HR/intensity/body-battery/HRV). full=true fetches a per-day COMPLETE snapshot (adds sleep, training load, VO2max, calories, SpO2, respiration, garmin_raw) — heavier but resumable (skips days already backfilled unless force=true). Rate-limited with 429 backoff; safe to run repeatedly / a chunk at a time.",
    inputSchema: {
      type: "object",
      required: ["from"],
      properties: {
        from: { type: "string", description: "start date YYYY-MM-DD" },
        to: { type: "string", description: "end date YYYY-MM-DD (default today)" },
        full: {
          type: "boolean",
          description: "per-day complete snapshot instead of the range fast-path",
        },
        force: { type: "boolean", description: "re-fetch days that already have a full snapshot" },
      },
    },
    toArgs: (a) => {
      const f = ["garmin-backfill", "--json", ...flags(a, ["from", "to"])];
      if (a.full === true) f.push("--full");
      if (a.force === true) f.push("--force");
      return f;
    },
  },
  journal: {
    description:
      "Add a free-text journal entry in the athlete's own words (e.g. 'legs heavy, slept badly, stressful week'). Complements the structured mood/energy/soreness log; read back via summary.",
    inputSchema: {
      type: "object",
      required: ["entry"],
      properties: {
        entry: { type: "string", description: "the free-text note" },
        tag: { type: "string", description: "optional label, e.g. 'race' or 'niggle'" },
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
      },
    },
    toArgs: (a) => ["journal", "add", String(a.entry), ...flags(a, ["tag", "date"])],
  },
  journal_list: {
    description: "List journal entries (most recent first). Filter with since/until.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number" },
      },
    },
    toArgs: (a) => ["journal", "list", "--json", ...flags(a, ["since", "until", "limit"])],
  },
  summary: {
    description:
      "Bundle a period's journal entries + daily wellness/training metrics as JSON so you can compose an end-of-week summary for the athlete. Defaults to the last 7 days.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "YYYY-MM-DD (default 7 days ago)" },
        to: { type: "string", description: "YYYY-MM-DD (default today)" },
      },
    },
    toArgs: (a) => ["summary", ...flags(a, ["since", "to"])],
  },
  notify: {
    description:
      "Send a push notification via the configured channel (webhook/Home Assistant, macOS, stdout).",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" }, title: { type: "string" } },
    },
    toArgs: (a) => ["notify", String(a.message), ...flags(a, ["title"])],
  },
  athlete_info: {
    description:
      "READ THIS FIRST before building or adjusting any training plan. One call returns everything the coach knows about the athlete: the primary A-race goal (enriched with weeksToGoal, raceEFD, trailMode), all goals, training availability (days/weekly hours/long day), an explicit `missing[]` of facts still needed (e.g. 'goal', 'availability.days', 'goal.elevation_gain_m'), a `ready` flag (true once a goal-anchored plan can be built), and `hints` on what to ask. NOTHING about a race is hardcoded — if a goal or availability is missing, ask the athlete and persist via set_goal / set_availability.",
    inputSchema: { type: "object", properties: {} },
    toArgs: () => ["athlete-info"],
  },
  get_goal: {
    description:
      "Get a training goal as JSON (enriched with weeksToGoal, raceEFD, trailMode). Omit `id` to get the primary A-race (the active priority-A goal with the nearest event date). Returns null if none is set.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "goal id (default: the primary A-race)" } },
    },
    toArgs: (a) =>
      typeof a.id === "string"
        ? ["goal", "get", String(a.id), "--json"]
        : ["goal", "get", "--json"],
  },
  list_goals: {
    description:
      "List all training goals (★ marks the primary A-race). Optional status filter (active|completed|abandoned).",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["active", "completed", "abandoned"] } },
    },
    toArgs: (a) => ["goal", "list", "--json", ...flags(a, ["status"])],
  },
  set_goal: {
    description:
      "Create or update a durable training goal in the coach backend (the system reads it from here — no race is hardcoded). Keyed by `id`; omit `id` and it's derived from name + event month. priority A = the race the plan peaks for (one A-race at a time). target_time is optional and never blocks plan generation. Required to be useful: name, date, distance_km; add vert_m for trail/ultra.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "stable id (default: slug of name + event month)" },
        name: { type: "string", description: "event name, e.g. 'Trail des Hautes Fagnes'" },
        date: { type: "string", description: "event date YYYY-MM-DD" },
        type: { type: "string", description: "trail | ultra | marathon | road | triathlon | …" },
        distanceKm: { type: "number", description: "race distance in km" },
        vertM: { type: "number", description: "total ascent (D+) in metres" },
        terrain: { type: "string", description: "technical | runnable | mixed | road | …" },
        priority: {
          type: "string",
          enum: ["A", "B", "C"],
          description: "A = the goal the block peaks for",
        },
        goalType: {
          type: "string",
          enum: ["finish", "finish-strong", "target-time", "place"],
          description: "what success means (drives plan aggressiveness/taper)",
        },
        target: { type: "string", description: "optional target time 'H:MM:SS'" },
        targetNotes: { type: "string", description: "optional free target, e.g. 'top 20%'" },
        status: { type: "string", enum: ["active", "completed", "abandoned"] },
        terrainNotes: { type: "string", description: "course notes (cutoffs, surface, climbs)" },
        notes: { type: "string" },
      },
    },
    toArgs: (a) => {
      const out = ["goal", "set", "--json"];
      if (typeof a.id === "string") out.push(`--id=${a.id}`);
      if (typeof a.name === "string") out.push(`--name=${a.name}`);
      if (typeof a.date === "string") out.push(`--date=${a.date}`);
      if (typeof a.type === "string") out.push(`--type=${a.type}`);
      if (a.distanceKm !== undefined && a.distanceKm !== null)
        out.push(`--distance-km=${a.distanceKm}`);
      if (a.vertM !== undefined && a.vertM !== null) out.push(`--vert-m=${a.vertM}`);
      if (typeof a.terrain === "string") out.push(`--terrain=${a.terrain}`);
      if (typeof a.priority === "string") out.push(`--priority=${a.priority}`);
      if (typeof a.goalType === "string") out.push(`--goal-type=${a.goalType}`);
      if (typeof a.target === "string") out.push(`--target=${a.target}`);
      if (typeof a.targetNotes === "string") out.push(`--target-notes=${a.targetNotes}`);
      if (typeof a.status === "string") out.push(`--status=${a.status}`);
      if (typeof a.terrainNotes === "string") out.push(`--terrain-notes=${a.terrainNotes}`);
      if (typeof a.notes === "string") out.push(`--notes=${a.notes}`);
      return out;
    },
  },
  delete_goal: {
    description: "Delete a training goal by id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    toArgs: (a) => ["goal", "delete", String(a.id), "--json"],
  },
  get_availability: {
    description:
      "Get the athlete's durable training availability: days of week, weekly-hours budget, long-run day, doubles. The periodizer builds the schedule around this.",
    inputSchema: { type: "object", properties: {} },
    toArgs: () => ["availability", "get", "--json"],
  },
  set_availability: {
    description:
      "Set the athlete's durable training availability (asked once, remembered). Pass any subset. `days` is a list/CSV like 'tue,thu,sat,sun'. Build it from what the athlete confirms — don't assume.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "string",
          description: "available training days, CSV or JSON array, e.g. 'tue,thu,sat,sun'",
        },
        weeklyHours: { type: "number", description: "target training hours per week" },
        longDay: { type: "string", description: "day the long run anchors, e.g. 'sat'" },
        doubles: { type: "boolean", description: "can do AM/PM split sessions" },
        notes: { type: "string", description: "e.g. 'pool only weekdays', 'no Wed evenings'" },
      },
    },
    toArgs: (a) => {
      const out = ["availability", "set", "--json"];
      if (typeof a.days === "string") out.push(`--days=${a.days}`);
      else if (Array.isArray(a.days)) out.push(`--days=${(a.days as unknown[]).join(",")}`);
      if (a.weeklyHours !== undefined && a.weeklyHours !== null)
        out.push(`--weekly-hours=${a.weeklyHours}`);
      if (typeof a.longDay === "string") out.push(`--long-day=${a.longDay}`);
      if (a.doubles === true) out.push(`--doubles=true`);
      if (a.doubles === false) out.push(`--doubles=false`);
      if (typeof a.notes === "string") out.push(`--notes=${a.notes}`);
      return out;
    },
  },
};
