#!/usr/bin/env python3
"""Fetch a day's Garmin Connect snapshot + recent activities and print JSON.

Talks to Garmin Connect read-only using the OAuth2 ("diauth") tokens stored in
$GARMINTOKENS (a garmin_tokens.json with di_token / di_refresh_token /
di_client_id). Garmin access tokens are short-lived, so this refreshes on every
run and persists the rotated refresh token back — the fetcher stays alive for
months without any re-auth or password.

Uses only the Python standard library (urllib) — no third-party deps, so the
image stays tiny. It never touches coach.db: the Node CLI (`garmin-fetch`)
ingests this JSON through the tested upsert path, keeping the schema in one
place.

Usage:  garmin_fetch.py [YYYY-MM-DD]   (default: today, in the container's TZ)
Output: {"date", "wellness": {...}, "activities": [...], "errors": [...]}

Every field is best-effort: a failure on one metric is recorded in `errors` and
the rest still come through, so a Garmin API change never produces no data.
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DIAUTH = "https://diauth.garmin.com/di-oauth2-service/oauth/token"
API = "https://connectapi.garmin.com"
APP_UA = "com.garmin.android.apps.connectmobile"  # for the token refresh
API_UA = "GCM-iOS-5.7.2.1"  # connectapi rejects unknown clients

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


def _http(method, url, headers=None, data=None, timeout=25):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body) if body else None


def token_path():
    store = os.environ.get("GARMINTOKENS") or os.path.expanduser("~/.garminconnect")
    if os.path.isdir(store):
        return os.path.join(store, "garmin_tokens.json")
    return store


def refresh_access(tokens):
    """Exchange the long-lived refresh token for a fresh access token."""
    data = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens["di_refresh_token"],
            "client_id": tokens["di_client_id"],
        }
    ).encode()
    return _http(
        "POST",
        DIAUTH,
        headers={"User-Agent": APP_UA, "Content-Type": "application/x-www-form-urlencoded"},
        data=data,
    )


def persist(path, tokens, refreshed):
    """Cache the latest access token + rotate the refresh token (best effort)."""
    try:
        updated = dict(tokens)
        if refreshed.get("access_token"):
            updated["di_token"] = refreshed["access_token"]
        if refreshed.get("refresh_token"):
            updated["di_refresh_token"] = refreshed["refresh_token"]
        with open(path, "w") as f:
            json.dump(updated, f)
    except Exception:
        pass


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


def main():
    date = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    out = {"date": date, "wellness": {}, "activities": [], "errors": []}

    path = token_path()
    try:
        with open(path) as f:
            tokens = json.load(f)
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"tokens ({path}): {e}")
        print(json.dumps(out))
        return

    for k in ("di_refresh_token", "di_client_id"):
        if not tokens.get(k):
            out["errors"].append(f"tokens: missing {k} (expected garmin_tokens.json)")
            print(json.dumps(out))
            return

    try:
        refreshed = refresh_access(tokens)
        access = refreshed["access_token"]
    except urllib.error.HTTPError as e:  # noqa: BLE001
        out["errors"].append(f"refresh: HTTP {e.code} {e.read()[:120]!r}")
        print(json.dumps(out))
        return
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"refresh: {e}")
        print(json.dumps(out))
        return
    persist(path, tokens, refreshed)

    headers = {"Authorization": "Bearer " + access, "User-Agent": API_UA, "NK": "NT"}

    def api_get(p):
        return _http("GET", API + p, headers=headers)

    w = out["wellness"]
    display_name = [None]

    def attempt(label, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            out["errors"].append(f"{label}: {e}")

    def _profile():
        p = api_get("/userprofile-service/socialProfile") or {}
        display_name[0] = p.get("displayName")

    def _readiness():
        d = api_get("/metrics-service/metrics/trainingreadiness/" + date)
        if isinstance(d, list) and d:
            d = d[0]
        if isinstance(d, dict) and d.get("score") is not None:
            w["readiness_score"] = _int(d["score"])

    def _sleep():
        if not display_name[0]:
            return
        d = (
            api_get(
                f"/wellness-service/wellness/dailySleepData/{display_name[0]}"
                f"?date={date}&nonSleepBufferMinutes=60"
            )
            or {}
        )
        dto = d.get("dailySleepDTO") or {}
        if dto.get("sleepTimeSeconds"):
            w["sleep_hours"] = round(dto["sleepTimeSeconds"] / 3600.0, 2)
        overall = (dto.get("sleepScores") or {}).get("overall") or {}
        if overall.get("value") is not None:
            w["sleep_score"] = _int(overall["value"])

    def _hrv():
        # HRV Status is the 7-day overnight average vs. the personal baseline band.
        summ = (api_get("/hrv-service/hrv/" + date) or {}).get("hrvSummary") or {}
        if summ.get("status"):
            w["hrv_status"] = str(summ["status"]).lower()
        if summ.get("weeklyAvg") is not None:
            w["hrv_weekly_avg"] = summ["weeklyAvg"]
        base = summ.get("baseline") or {}
        if base.get("balancedLow") is not None:
            w["hrv_baseline_low"] = _int(base["balancedLow"])
        if base.get("balancedUpper") is not None:
            w["hrv_baseline_upper"] = _int(base["balancedUpper"])

    def _stats():
        if not display_name[0]:
            return
        d = (
            api_get(f"/usersummary-service/usersummary/daily/{display_name[0]}?calendarDate={date}")
            or {}
        )
        if d.get("restingHeartRate") is not None:
            w["resting_hr"] = _int(d["restingHeartRate"])
        # Body Battery at wake time is the recovery-relevant value (not the daytime peak).
        bb = d.get("bodyBatteryAtWakeTime")
        if bb is None:
            bb = d.get("bodyBatteryMostRecentValue")
        if bb is not None and bb >= 0:
            w["body_battery_morning"] = _int(bb)
        stress = d.get("averageStressLevel")
        if stress is not None and stress >= 0:  # Garmin uses negatives when no data
            w["avg_stress"] = _int(stress)

    def _training():
        # Training Status label + the acute/chronic load and ACWR that drive it.
        d = api_get("/metrics-service/metrics/trainingstatus/aggregated/" + date) or {}
        latest = (
            (d.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData")
            or d.get("latestTrainingStatusData")
            or {}
        )
        for v in latest.values():
            if not isinstance(v, dict):
                continue
            phrase = v.get("trainingStatusFeedbackPhrase") or v.get("trainingStatus")
            if phrase and "training_status" not in w:
                w["training_status"] = str(phrase).replace("_", " ").title()
            acute = v.get("acuteTrainingLoadDTO") or {}
            if acute.get("dailyAcuteChronicWorkloadRatio") is not None:
                w["acwr"] = acute["dailyAcuteChronicWorkloadRatio"]
            if acute.get("dailyTrainingLoadAcute") is not None:
                w["acute_load"] = _int(acute["dailyTrainingLoadAcute"])
            if acute.get("dailyTrainingLoadChronic") is not None:
                w["chronic_load"] = _int(acute["dailyTrainingLoadChronic"])
            if "acwr" in w:
                break

    def _activities():
        d = api_get("/activitylist-service/activities/search/activities?start=0&limit=15") or []
        for a in d:
            try:
                out["activities"].append(map_activity(a))
            except Exception as e:  # noqa: BLE001
                out["errors"].append(f"activity: {e}")

    attempt("profile", _profile)
    attempt("readiness", _readiness)
    attempt("sleep", _sleep)
    attempt("hrv", _hrv)
    attempt("stats", _stats)
    attempt("training", _training)
    attempt("activities", _activities)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
