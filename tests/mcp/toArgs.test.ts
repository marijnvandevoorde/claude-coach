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
