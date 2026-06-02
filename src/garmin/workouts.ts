/**
 * Build + push structured workouts to Garmin Connect.
 *
 * Takes the high-level workout records the plan exporter produces
 * (`export-garmin`) and turns each into Garmin's workout DTO, then creates it on
 * Garmin and (optionally) schedules it on its date so it syncs to the watch.
 * This is the native-TS replacement for the standalone garmin MCP's
 * workout create + schedule tools.
 *
 * v1 supports a single executable step per workout (whole-session) with a
 * time-or-distance end condition and an optional heart-rate target. Multi-step
 * interval structure + pace/power targets are a follow-up.
 */
import { GarminClient } from "./client.js";
import type {
  StructuredWorkout,
  WorkoutStep,
  IntervalSet,
  IntensityTarget,
  DurationTarget,
  AthleteZones,
} from "../schema/training-plan.js";

export interface WorkoutInput {
  date?: string;
  sport: string;
  name: string;
  durationMinutes?: number;
  distanceMeters?: number;
  targetHR?: { low: number; high: number };
  targetPace?: { low: string; high: string };
  targetPower?: { low: number; high: number };
  structure?: StructuredWorkout;
  zones?: AthleteZones;
}

// Garmin sport-type ids (from the workout-service vocabulary).
const SPORT_TYPE: Record<string, { sportTypeId: number; sportTypeKey: string }> = {
  run: { sportTypeId: 1, sportTypeKey: "running" },
  running: { sportTypeId: 1, sportTypeKey: "running" },
  ride: { sportTypeId: 2, sportTypeKey: "cycling" },
  bike: { sportTypeId: 2, sportTypeKey: "cycling" },
  cycling: { sportTypeId: 2, sportTypeKey: "cycling" },
  walk: { sportTypeId: 3, sportTypeKey: "walking" },
  walking: { sportTypeId: 3, sportTypeKey: "walking" },
  swim: { sportTypeId: 4, sportTypeKey: "swimming" },
  swimming: { sportTypeId: 4, sportTypeKey: "swimming" },
  strength: { sportTypeId: 5, sportTypeKey: "strength_training" },
  strength_training: { sportTypeId: 5, sportTypeKey: "strength_training" },
}; // unknown sports fall back to running

function sportTypeOf(sport: string): { sportTypeId: number; sportTypeKey: string } {
  return SPORT_TYPE[sport.toLowerCase()] ?? SPORT_TYPE.run;
}

// Garmin step-type ids.
const STEP_TYPE: Record<string, { stepTypeId: number; stepTypeKey: string }> = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup" },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown" },
  work: { stepTypeId: 3, stepTypeKey: "interval" },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery" },
  rest: { stepTypeId: 5, stepTypeKey: "rest" },
};
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" };

/** Parse a pace string like "5:30/km" or "8:50/mi" into metres per second. */
export function paceToMps(pace?: string): number | undefined {
  if (!pace) return undefined;
  const m = pace.match(/(\d+):(\d{1,2})\s*\/\s*(km|mi)/i);
  if (!m) return undefined;
  const secs = Number(m[1]) * 60 + Number(m[2]);
  const metres = m[3].toLowerCase() === "mi" ? 1609.34 : 1000;
  return secs > 0 ? metres / secs : undefined;
}

type TargetFields = {
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  targetValueOne?: number;
  targetValueTwo?: number;
};

function hrTarget(low: number, high: number): TargetFields {
  return {
    targetType: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" },
    targetValueOne: Math.min(low, high),
    targetValueTwo: Math.max(low, high),
  };
}
function powerTarget(low: number, high: number): TargetFields {
  return {
    targetType: { workoutTargetTypeId: 2, workoutTargetTypeKey: "power.zone" },
    targetValueOne: Math.round(Math.min(low, high)),
    targetValueTwo: Math.round(Math.max(low, high)),
  };
}
function paceTarget(lowMps: number, highMps: number): TargetFields {
  // Garmin stores pace targets as speed (m/s).
  return {
    targetType: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone" },
    targetValueOne: Math.min(lowMps, highMps),
    targetValueTwo: Math.max(lowMps, highMps),
  };
}

/** Resolve a structured step's intensity to a Garmin target, using the athlete's zones. */
function resolveTarget(
  it: IntensityTarget | undefined,
  zones: AthleteZones | undefined
): TargetFields {
  if (!it) return { targetType: NO_TARGET };
  switch (it.unit) {
    case "hr_zone":
    case "percent_lthr": {
      if (it.valueLow != null && it.valueHigh != null) return hrTarget(it.valueLow, it.valueHigh);
      const hz = zones?.run?.hr ?? zones?.bike?.hr;
      const z = hz?.zones.find((x) => x.zone === it.value);
      if (z) return hrTarget(z.hrLow, z.hrHigh);
      return { targetType: NO_TARGET };
    }
    case "percent_ftp": {
      const ftp = zones?.bike?.power?.ftp;
      if (ftp != null) {
        const lo = it.valueLow ?? it.value;
        const hi = it.valueHigh ?? it.value;
        if (lo != null && hi != null) return powerTarget((ftp * lo) / 100, (ftp * hi) / 100);
      }
      const z = zones?.bike?.power?.zones.find((x) => x.zone === it.value);
      if (z) return powerTarget(z.wattsLow, z.wattsHigh);
      return { targetType: NO_TARGET };
    }
    // pace_zone is encoded ambiguously per-step (letter zones); use workout-level
    // targetPace for whole-workout pace instead. rpe / css_offset have no Garmin target.
    default:
      return { targetType: NO_TARGET };
  }
}

function durationToEnd(d?: DurationTarget): {
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  endConditionValue: number;
} {
  const distance = (metres: number) => ({
    endCondition: { conditionTypeId: 3, conditionTypeKey: "distance" },
    endConditionValue: Math.round(metres),
  });
  const time = (secs: number) => ({
    endCondition: { conditionTypeId: 2, conditionTypeKey: "time" },
    endConditionValue: Math.round(secs),
  });
  if (!d) return time(0);
  switch (d.unit) {
    case "meters":
      return distance(d.value);
    case "kilometers":
      return distance(d.value * 1000);
    case "miles":
      return distance(d.value * 1609.34);
    case "yards":
      return distance(d.value * 0.9144);
    case "seconds":
      return time(d.value);
    case "hours":
      return time(d.value * 3600);
    case "laps":
      return {
        endCondition: { conditionTypeId: 1, conditionTypeKey: "lap.button" },
        endConditionValue: 1,
      };
    default: // minutes
      return time(d.value * 60);
  }
}

/** Build the Garmin workoutSteps[] for a structured workout (warmup / main / cooldown). */
function buildStructuredSteps(
  structure: StructuredWorkout,
  zones: AthleteZones | undefined
): Record<string, unknown>[] {
  const steps: Record<string, unknown>[] = [];
  let order = 0; // shared stepId/stepOrder counter across all steps
  let childGroup = 0;

  const exec = (s: WorkoutStep, childStepId?: number): Record<string, unknown> => {
    order++;
    const { endCondition, endConditionValue } = durationToEnd(s.duration);
    return {
      type: "ExecutableStepDTO",
      stepId: order,
      stepOrder: order,
      stepType: STEP_TYPE[s.type] ?? STEP_TYPE.work,
      ...(childStepId != null ? { childStepId } : {}),
      endCondition,
      endConditionValue,
      ...resolveTarget(s.intensity, zones),
    };
  };

  const addStep = (s: WorkoutStep) => steps.push(exec(s));

  const addInterval = (set: IntervalSet) => {
    order++;
    const repeatOrder = order;
    childGroup++;
    const gid = childGroup;
    const children = set.steps.map((s) => exec(s, gid));
    steps.push({
      type: "RepeatGroupDTO",
      stepId: repeatOrder,
      stepOrder: repeatOrder,
      stepType: { stepTypeId: 6, stepTypeKey: "repeat" },
      childStepId: gid,
      numberOfIterations: set.repeats,
      smartRepeat: false,
      workoutSteps: children,
    });
  };

  for (const s of structure.warmup ?? []) addStep(s);
  for (const item of structure.main) {
    if ("repeats" in item) addInterval(item as IntervalSet);
    else addStep(item as WorkoutStep);
  }
  for (const s of structure.cooldown ?? []) addStep(s);
  return steps;
}

/** A single whole-session step (used when the workout has no structured breakdown). */
function buildSimpleStep(input: WorkoutInput): Record<string, unknown> {
  const { endCondition, endConditionValue } = input.distanceMeters
    ? {
        endCondition: { conditionTypeId: 3, conditionTypeKey: "distance" },
        endConditionValue: input.distanceMeters,
      }
    : {
        endCondition: { conditionTypeId: 2, conditionTypeKey: "time" },
        endConditionValue: Math.round((input.durationMinutes ?? 0) * 60),
      };

  // Target priority: HR (most common/validated) → power (watts) → pace (string→m/s).
  let target: TargetFields = { targetType: NO_TARGET };
  if (input.targetHR) target = hrTarget(input.targetHR.low, input.targetHR.high);
  else if (input.targetPower) target = powerTarget(input.targetPower.low, input.targetPower.high);
  else if (input.targetPace) {
    const lo = paceToMps(input.targetPace.low);
    const hi = paceToMps(input.targetPace.high);
    if (lo != null && hi != null) target = paceTarget(lo, hi);
  }

  return {
    type: "ExecutableStepDTO",
    stepId: 1,
    stepOrder: 1,
    stepType: STEP_TYPE.work,
    endCondition,
    endConditionValue,
    ...target,
  };
}

/** The Garmin workout-service create DTO for one workout. */
export function buildWorkoutPayload(input: WorkoutInput): Record<string, unknown> {
  const st = sportTypeOf(input.sport);
  const steps =
    input.structure && (input.structure.main?.length ?? 0) > 0
      ? buildStructuredSteps(input.structure, input.zones)
      : [buildSimpleStep(input)];
  return {
    sportType: st,
    workoutName: input.name,
    workoutSegments: [{ segmentOrder: 1, sportType: st, workoutSteps: steps }],
  };
}

export async function createWorkout(client: GarminClient, input: WorkoutInput): Promise<number> {
  const res = await client.post<{ workoutId: number }>(
    "/workout-service/workout",
    buildWorkoutPayload(input)
  );
  if (!res?.workoutId) throw new Error("create: no workoutId in response");
  return res.workoutId;
}

/** Update an existing workout in place (keeps its id + any schedules). */
export async function updateWorkout(
  client: GarminClient,
  workoutId: number,
  input: WorkoutInput
): Promise<void> {
  await client.put(`/workout-service/workout/${workoutId}`, {
    ...buildWorkoutPayload(input),
    workoutId,
  });
}

export async function scheduleWorkout(
  client: GarminClient,
  workoutId: number,
  date: string
): Promise<number | undefined> {
  const res = await client.post<{ workoutScheduleId?: number }>(
    `/workout-service/schedule/${workoutId}`,
    { date }
  );
  return res?.workoutScheduleId;
}

export interface WorkoutSummary {
  workoutId: number;
  workoutName: string;
}

/** List the athlete's own workouts (used for name-based dedup). */
export async function listWorkouts(client: GarminClient): Promise<WorkoutSummary[]> {
  const d = await client.get<unknown>(
    "/workout-service/workouts?start=1&limit=100&myWorkoutsOnly=true&sharedWorkoutsOnly=false&orderBy=WORKOUT_NAME&orderSeq=ASC"
  );
  const arr: any[] = Array.isArray(d) ? d : ((d as any)?.workoutList ?? (d as any)?.workouts ?? []);
  return arr.map((w) => ({ workoutId: w.workoutId, workoutName: w.workoutName }));
}

/** Stable per plan day-workout key for dedup. */
export function pushKey(date: string | undefined, name: string): string {
  return `${date ?? ""}|${name}`;
}

/** Persistence the CLI injects so re-pushes update in place instead of duplicating. */
type PushRecord = {
  push_key: string;
  workout_id: number;
  schedule_id: number | null;
  name: string;
  date: string | null;
};
type StoredWorkout = { workout_id: number; schedule_id: number | null; date: string | null };

/** The store can be sync (test fake) or async (the real coach.db-backed store). */
export interface PushStore {
  lookup(key: string): StoredWorkout | undefined | Promise<StoredWorkout | undefined>;
  save(rec: PushRecord): void | Promise<void>;
}

export async function deleteWorkout(client: GarminClient, workoutId: number): Promise<void> {
  await client.del(`/workout-service/workout/${workoutId}`);
}

export interface PushResult {
  name: string;
  date?: string;
  dryRun?: boolean;
  payload?: Record<string, unknown>;
  workoutId?: number;
  scheduleId?: number;
  replaced?: boolean; // updated an existing workout in place rather than creating one
  error?: string;
}

/**
 * Create (and, when dated, schedule) each workout. `dryRun` builds payloads only.
 * When a `store` is provided, re-pushes UPDATE the existing workout in place (by
 * stored id, or by matching name as a fallback) instead of creating duplicates.
 */
export async function pushWorkouts(
  inputs: WorkoutInput[],
  opts: { dryRun?: boolean; store?: PushStore } = {}
): Promise<PushResult[]> {
  if (opts.dryRun) {
    return inputs.map((i) => ({
      name: i.name,
      date: i.date,
      dryRun: true,
      payload: buildWorkoutPayload(i),
    }));
  }

  const client = await GarminClient.create();

  // Name-fallback dedup: adopt workouts created before the push store existed.
  const byName = new Map<string, number>();
  if (opts.store) {
    try {
      for (const w of await listWorkouts(client)) {
        if (w.workoutName) byName.set(w.workoutName, w.workoutId);
      }
    } catch {
      /* listing is best-effort — fall back to create */
    }
  }

  const results: PushResult[] = [];
  for (const input of inputs) {
    try {
      const key = pushKey(input.date, input.name);
      const stored = opts.store ? await opts.store.lookup(key) : undefined;
      const existingId = stored?.workout_id ?? byName.get(input.name);

      let workoutId: number;
      let replaced = false;
      if (existingId) {
        await updateWorkout(client, existingId, input);
        workoutId = existingId;
        replaced = true;
      } else {
        workoutId = await createWorkout(client, input);
      }

      // Schedule on the date unless it's already scheduled there.
      let scheduleId = stored?.schedule_id ?? undefined;
      if (input.date && !(scheduleId && stored?.date === input.date)) {
        scheduleId = await scheduleWorkout(client, workoutId, input.date);
      }

      await opts.store?.save({
        push_key: key,
        workout_id: workoutId,
        schedule_id: scheduleId ?? null,
        name: input.name,
        date: input.date ?? null,
      });
      results.push({ name: input.name, date: input.date, workoutId, scheduleId, replaced });
    } catch (e) {
      results.push({
        name: input.name,
        date: input.date,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
