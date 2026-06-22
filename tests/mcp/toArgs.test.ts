import { describe, it, expect } from "vitest";
import { TOOLS } from "../../src/mcp/tools.js";

// The MCP tool table is pure (Args -> argv + stdin). These assert the exact CLI
// contract each tool produces — a one-character drift here silently empties a
// result with no error, so it's high-value and cheap to pin.

describe("MCP tool table — structural invariants", () => {
  it("every tool has a description, object inputSchema, and a toArgs function", () => {
    for (const [name, def] of Object.entries(TOOLS)) {
      expect(def.description, `${name} description`).toBeTruthy();
      expect(def.inputSchema?.type, `${name} inputSchema.type`).toBe("object");
      expect(typeof def.toArgs, `${name} toArgs`).toBe("function");
    }
  });

  it("no tool's toArgs throws on empty args", () => {
    for (const [name, def] of Object.entries(TOOLS)) {
      expect(() => def.toArgs({}), `${name} toArgs({})`).not.toThrow();
    }
  });
});

describe("plan source selection (inline stdin / file / active)", () => {
  const cases: Array<[string, Record<string, unknown>, string[], string | undefined]> = [
    ["inline plan → --stdin", { plan: "JSON" }, ["garmin-push", "--stdin", "--json"], "JSON"],
    [
      "file → positional path",
      { file: "/p.json" },
      ["garmin-push", "/p.json", "--json"],
      undefined,
    ],
    ["neither → --active", {}, ["garmin-push", "--active", "--json"], undefined],
  ];
  for (const [label, args, argv, stdin] of cases) {
    it(`schedule_workouts ${label}`, () => {
      expect(TOOLS.schedule_workouts.toArgs(args)).toEqual(argv);
      expect(TOOLS.schedule_workouts.stdin?.(args)).toBe(stdin);
    });
  }

  it("schedule_workouts adds --dry-run and --from/--to", () => {
    expect(TOOLS.schedule_workouts.toArgs({ dryRun: true })).toContain("--dry-run");
    const windowed = TOOLS.schedule_workouts.toArgs({ from: "2026-06-08", to: "2026-06-14" });
    expect(windowed).toContain("--from=2026-06-08");
    expect(windowed).toContain("--to=2026-06-14");
  });

  it("export_calendar / export_garmin default to --active", () => {
    expect(TOOLS.export_calendar.toArgs({})).toEqual(["export-calendar", "--active", "--json"]);
    expect(TOOLS.export_garmin.toArgs({})).toEqual(["export-garmin", "--active"]);
    expect(TOOLS.export_garmin.toArgs({ plan: "X" })).toEqual(["export-garmin", "--stdin"]);
    expect(TOOLS.export_garmin.stdin?.({ plan: "X" })).toBe("X");
  });
});

describe("plan CRUD tools map to the right CLI verbs", () => {
  it("save_plan pipes the plan via stdin", () => {
    expect(TOOLS.save_plan.toArgs({ plan: "P" })).toEqual(["plan", "save", "--stdin", "--json"]);
    expect(TOOLS.save_plan.stdin?.({ plan: "P" })).toBe("P");
  });
  it("list_plans / get_plan (with + without id)", () => {
    expect(TOOLS.list_plans.toArgs({})).toEqual(["plan", "list", "--json"]);
    expect(TOOLS.get_plan.toArgs({})).toEqual(["plan", "get", "--json"]);
    expect(TOOLS.get_plan.toArgs({ id: "p1" })).toEqual(["plan", "get", "p1", "--json"]);
  });
  it("activate_plan / delete_plan pass the id", () => {
    expect(TOOLS.activate_plan.toArgs({ id: "p1" })).toEqual(["plan", "activate", "p1", "--json"]);
    expect(TOOLS.delete_plan.toArgs({ id: "p1" })).toEqual(["plan", "delete", "p1", "--json"]);
  });
  it("plan_today / plan_upcoming carry date/days flags", () => {
    expect(TOOLS.plan_today.toArgs({ date: "2026-06-06" })).toEqual([
      "plan",
      "show-today",
      "--json",
      "--date=2026-06-06",
    ]);
    expect(TOOLS.plan_upcoming.toArgs({ days: 14 })).toEqual([
      "plan",
      "upcoming",
      "--json",
      "--days=14",
    ]);
  });
});

describe("goal / availability / athlete_info tools map to the right CLI verbs", () => {
  it("athlete_info is the consolidated read (no args)", () => {
    expect(TOOLS.athlete_info.toArgs({})).toEqual(["athlete-info"]);
  });
  it("get_goal defaults to the primary, or fetches by id", () => {
    expect(TOOLS.get_goal.toArgs({})).toEqual(["goal", "get", "--json"]);
    expect(TOOLS.get_goal.toArgs({ id: "g1" })).toEqual(["goal", "get", "g1", "--json"]);
  });
  it("list_goals carries an optional status filter", () => {
    expect(TOOLS.list_goals.toArgs({})).toEqual(["goal", "list", "--json"]);
    expect(TOOLS.list_goals.toArgs({ status: "active" })).toEqual([
      "goal",
      "list",
      "--json",
      "--status=active",
    ]);
  });
  it("set_goal maps camelCase args to the CLI's kebab flags", () => {
    expect(
      TOOLS.set_goal.toArgs({
        name: "Trail des Hautes Fagnes",
        date: "2026-09-13",
        type: "trail",
        distanceKm: 45,
        vertM: 1450,
        priority: "A",
        goalType: "finish-strong",
      })
    ).toEqual([
      "goal",
      "set",
      "--json",
      "--name=Trail des Hautes Fagnes",
      "--date=2026-09-13",
      "--type=trail",
      "--distance-km=45",
      "--vert-m=1450",
      "--priority=A",
      "--goal-type=finish-strong",
    ]);
  });
  it("delete_goal passes the id", () => {
    expect(TOOLS.delete_goal.toArgs({ id: "g1" })).toEqual(["goal", "delete", "g1", "--json"]);
  });
  it("get_availability / set_availability map days + numeric + bool flags", () => {
    expect(TOOLS.get_availability.toArgs({})).toEqual(["availability", "get", "--json"]);
    expect(
      TOOLS.set_availability.toArgs({ days: "tue,thu,sat,sun", weeklyHours: 7, longDay: "sat" })
    ).toEqual([
      "availability",
      "set",
      "--json",
      "--days=tue,thu,sat,sun",
      "--weekly-hours=7",
      "--long-day=sat",
    ]);
    expect(TOOLS.set_availability.toArgs({ days: ["tue", "sat"], doubles: true })).toEqual([
      "availability",
      "set",
      "--json",
      "--days=tue,sat",
      "--doubles=true",
    ]);
  });
});

describe("periodizer / adaptive tools map to the right CLI verbs", () => {
  it("generate_plan + re-periodize via from", () => {
    expect(TOOLS.generate_plan.toArgs({})).toEqual(["plan", "generate", "--json"]);
    expect(TOOLS.generate_plan.toArgs({ from: "2026-07-01" })).toEqual([
      "plan",
      "generate",
      "--json",
      "--from=2026-07-01",
    ]);
  });
  it("goal_anchor / audit_plan default to the active plan or take an id", () => {
    expect(TOOLS.goal_anchor.toArgs({})).toEqual(["plan", "anchor"]);
    expect(TOOLS.goal_anchor.toArgs({ id: "p1", date: "2026-07-01" })).toEqual([
      "plan",
      "anchor",
      "p1",
      "--date=2026-07-01",
    ]);
    expect(TOOLS.audit_plan.toArgs({})).toEqual(["plan", "audit", "--json"]);
  });
  it("reconcile + plan_drift carry the window flags", () => {
    expect(TOOLS.reconcile.toArgs({ days: 14 })).toEqual(["reconcile", "--days=14"]);
    expect(TOOLS.plan_drift.toArgs({ days: 14 })).toEqual(["plan", "drift", "--json", "--days=14"]);
  });
  it("note_activity passes id + note positionally and an optional class", () => {
    expect(TOOLS.note_activity.toArgs({ id: 123, note: "felt great" })).toEqual([
      "activity",
      "note",
      "123",
      "felt great",
      "--json",
    ]);
    expect(
      TOOLS.note_activity.toArgs({ id: 123, note: "nailed it", classify: "legit-hard" })
    ).toEqual(["activity", "note", "123", "nailed it", "--json", "--classify=legit-hard"]);
  });
});

describe("checkin and config flag mapping", () => {
  it("checkin uses --plan-stdin for inline, --plan= for a path", () => {
    const inline = TOOLS.checkin.toArgs({ plan: "P" });
    expect(inline).toContain("--plan-stdin");
    expect(TOOLS.checkin.stdin?.({ plan: "P" })).toBe("P");
    expect(TOOLS.checkin.toArgs({ planFile: "/p.json" })).toContain("--plan=/p.json");
  });
  it("config enabled:true → --enable, false → --disable", () => {
    expect(TOOLS.config.toArgs({ enabled: true })).toContain("--enable");
    expect(TOOLS.config.toArgs({ enabled: false })).toContain("--disable");
  });
});
