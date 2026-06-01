#!/usr/bin/env python3
"""Fetch a day's Garmin Connect snapshot + recent activities and print JSON.

This is the *real* Garmin sync: it logs in to Garmin Connect (read-only) using
the OAuth tokens in $GARMINTOKENS (a directory written by `garmin-mcp-auth` /
garth) and prints everything it found as a single JSON object on stdout.

It deliberately does NOT touch coach.db — the Node CLI (`garmin-fetch`) ingests
this JSON through the tested upsert path, so the DB schema lives in one place.

Usage:  garmin_fetch.py [YYYY-MM-DD]   (default: today, in the container's TZ)
Output: {"date", "wellness": {...}, "activities": [...], "errors": [...]}

Every field is best-effort: a failure on one metric is recorded in `errors` and
the rest still come through, so a Garmin API change never produces no data.
"""
import datetime
import json
import os
import sys

# Garmin activityType.typeKey -> the sport vocabulary used in the activities table.
SPORT = {
    "running": "Run",
    "trail_running": "Run",
    "treadmill_running": "Run",
    "track_running": "Run",
    "cycling": "Ride",
    "road_biking": "Ride",
    "mountain_biking": "Ride",
    "gravel_cycling": "Ride",
    "indoor_cycling": "Ride",
    "virtual_ride": "Ride",
    "lap_swimming": "Swim",
    "open_water_swimming": "Swim",
    "swimming": "Swim",
    "walking": "Walk",
    "hiking": "Hike",
    "strength_training": "Workout",
}


def _int(value):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def map_activity(a):
    type_key = ((a.get("activityType") or {}).get("typeKey") or "").lower()
    sport = SPORT.get(type_key) or (type_key.replace("_", " ").title() if type_key else "Workout")
    aid = a.get("activityId")
    dur = a.get("duration")
    moving = a.get("movingDuration") or dur
    return {
        "id": int(aid) if aid is not None else None,
        "name": a.get("activityName"),
        "sport_type": sport,
        "start_date": a.get("startTimeGMT"),
        "elapsed_time": _int(dur),
        "moving_time": _int(moving),
        "distance": a.get("distance"),
        "total_elevation_gain": a.get("elevationGain"),
        "average_speed": a.get("averageSpeed"),
        "max_speed": a.get("maxSpeed"),
        "average_heartrate": a.get("averageHR"),
        "max_heartrate": a.get("maxHR"),
        "average_cadence": (
            a.get("averageRunningCadenceInStepsPerMinute")
            or a.get("averageBikingCadenceInRevPerMinute")
        ),
        "calories": a.get("calories"),
        "raw": a,
    }


def do_login(Garmin, tokenstore):
    """Resume a session from saved tokens; try the two known API shapes."""
    last = None
    try:
        api = Garmin()
        api.login(tokenstore)
        return api
    except Exception as e:  # noqa: BLE001 - record and try the next form
        last = e
    try:
        api = Garmin(tokenstore=tokenstore)
        api.login()
        return api
    except Exception as e:  # noqa: BLE001
        last = e
    raise last


def main():
    date = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    out = {"date": date, "wellness": {}, "activities": [], "errors": []}

    try:
        from garminconnect import Garmin
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"import garminconnect: {e}")
        print(json.dumps(out))
        return

    tokenstore = os.environ.get("GARMINTOKENS") or os.path.expanduser("~/.garminconnect")
    try:
        api = do_login(Garmin, tokenstore)
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"login ({tokenstore}): {e}")
        print(json.dumps(out))
        return

    w = out["wellness"]

    def attempt(label, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            out["errors"].append(f"{label}: {e}")

    def _readiness():
        d = api.get_training_readiness(date)
        if isinstance(d, list) and d:
            d = d[0]
        if isinstance(d, dict) and d.get("score") is not None:
            w["readiness_score"] = _int(d["score"])

    def _sleep():
        d = api.get_sleep_data(date) or {}
        dto = d.get("dailySleepDTO") or {}
        secs = dto.get("sleepTimeSeconds")
        if secs:
            w["sleep_hours"] = round(secs / 3600.0, 2)
        overall = (dto.get("sleepScores") or {}).get("overall") or {}
        if overall.get("value") is not None:
            w["sleep_score"] = _int(overall["value"])

    def _hrv():
        d = api.get_hrv_data(date) or {}
        status = (d.get("hrvSummary") or {}).get("status")
        if status:
            w["hrv_status"] = str(status).lower()

    def _stats():
        d = api.get_stats(date) or {}
        if d.get("restingHeartRate") is not None:
            w["resting_hr"] = _int(d["restingHeartRate"])
        bb = d.get("bodyBatteryMostRecentValue")
        if bb is None:
            bb = d.get("bodyBatteryHighestValue")
        if bb is not None:
            w["body_battery_morning"] = _int(bb)

    def _training_status():
        d = api.get_training_status(date) or {}
        latest = d.get("latestTrainingStatusData") or {}
        for v in latest.values():
            if not isinstance(v, dict):
                continue
            phrase = v.get("trainingStatusFeedbackPhrase") or v.get("trainingStatus")
            if phrase:
                w["training_status"] = str(phrase).replace("_", " ").title()
                return

    def _activities():
        for a in api.get_activities(0, 15) or []:
            try:
                out["activities"].append(map_activity(a))
            except Exception as e:  # noqa: BLE001
                out["errors"].append(f"activity: {e}")

    attempt("readiness", _readiness)
    attempt("sleep", _sleep)
    attempt("hrv", _hrv)
    attempt("stats", _stats)
    attempt("training_status", _training_status)
    attempt("activities", _activities)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
