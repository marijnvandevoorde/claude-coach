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

export interface WorkoutInput {
  date?: string;
  sport: string;
  name: string;
  durationMinutes?: number;
  distanceMeters?: number;
  targetHR?: { low: number; high: number };
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

function buildStep(input: WorkoutInput): Record<string, unknown> {
  const endCondition = input.distanceMeters
    ? { conditionTypeId: 3, conditionTypeKey: "distance" }
    : { conditionTypeId: 2, conditionTypeKey: "time" };
  const endConditionValue = input.distanceMeters
    ? input.distanceMeters
    : Math.round((input.durationMinutes ?? 0) * 60); // seconds

  const step: Record<string, unknown> = {
    type: "ExecutableStepDTO",
    stepId: 1,
    stepOrder: 1,
    stepType: { stepTypeId: 3, stepTypeKey: "interval" },
    endCondition,
    endConditionValue,
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
  };

  if (input.targetHR) {
    step.targetType = { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" };
    step.targetValueOne = input.targetHR.low;
    step.targetValueTwo = input.targetHR.high;
  }
  return step;
}

/** The Garmin workout-service create DTO for one workout. */
export function buildWorkoutPayload(input: WorkoutInput): Record<string, unknown> {
  const st = sportTypeOf(input.sport);
  return {
    sportType: st,
    workoutName: input.name,
    workoutSegments: [{ segmentOrder: 1, sportType: st, workoutSteps: [buildStep(input)] }],
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
  error?: string;
}

/** Create (and, when dated, schedule) each workout. `dryRun` builds payloads only. */
export async function pushWorkouts(
  inputs: WorkoutInput[],
  opts: { dryRun?: boolean } = {}
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
  const results: PushResult[] = [];
  for (const input of inputs) {
    try {
      const workoutId = await createWorkout(client, input);
      const scheduleId = input.date
        ? await scheduleWorkout(client, workoutId, input.date)
        : undefined;
      results.push({ name: input.name, date: input.date, workoutId, scheduleId });
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
