/* ============================================================
   COACH — mock data engine (deterministic)
   Precomputes a wellness series 2021-01-01 → today with realistic
   training load (EWMA acute/chronic → ACWR), recovery signals that
   respond to load, gaps where the watch wasn't worn, and a
   hand-tuned trailing arc (build → race → recovery) for the demo.
   Exposes window.COACH.
   ============================================================ */
(function () {
  "use strict";

  const TODAY = new Date(2026, 5, 3); // Wed Jun 3 2026 (demo "today")
  const START = new Date(2021, 0, 1);
  const DAY = 86400000;

  // ---- helpers ----
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => {
    const [y, m, dd] = s.split("-").map(Number);
    return new Date(y, m - 1, dd);
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = Math.round;

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const r1 = (s) => rng(hash(s))();

  // ---- training plan by weekday (typical week) ----
  // 0 Sun, 1 Mon ... 6 Sat
  const PLAN = {
    0: { sport: "run", kind: "Long run", base: 132 },
    1: { sport: null, kind: "Rest", base: 0 },
    2: { sport: "run", kind: "Intervals", base: 92 },
    3: { sport: "ride", kind: "Endurance ride", base: 70 },
    4: { sport: "run", kind: "Tempo", base: 78 },
    5: { sport: null, kind: "Rest", base: 0 },
    6: { sport: "ride", kind: "Long ride", base: 150 },
  };

  // ---- build the full series ----
  const list = []; // chronological array of ISO strings
  for (let t = START.getTime(); t <= TODAY.getTime(); t += DAY) list.push(iso(new Date(t)));

  // seasonal + multiyear fitness curve (drives chronic load target & vo2max)
  function fitnessAt(d) {
    const yrs = (d - START) / (365.25 * DAY);
    const season = Math.sin(((d.getMonth() + d.getDate() / 30) / 12) * 2 * Math.PI - 1.4); // peaks ~late summer
    return 1 + 0.16 * yrs + 0.18 * season; // multiplier ~0.8..1.7
  }

  // is the watch missing this day? (training still logged)
  function isGap(s, d) {
    const yr = d.getFullYear();
    // long vacation gap: 2024-07-15 .. 2024-07-28
    if (s >= "2024-07-15" && s <= "2024-07-28") return true;
    // sparse early adoption in 2021
    const base = yr === 2021 ? 0.22 : yr === 2022 ? 0.09 : 0.055;
    return r1("gap" + s) < base;
  }

  const days = {}; // iso -> state (or {gap:true})
  let acute = 35,
    chronic = 35; // EWMA seeds

  for (const s of list) {
    const d = parse(s);
    const dow = d.getDay();
    const plan = PLAN[dow];
    const fit = fitnessAt(d);
    const rr = (k) => r1(k + s);

    // ---- training stress (known from log even on gap days) ----
    let ts = plan.base * (0.8 + 0.4 * rr("ts")) * (0.85 + (0.3 * fit) / 1.3);
    // skip some planned sessions (life happens)
    if (plan.base > 0 && rr("skip") < 0.14) ts = 0;
    ts = round(ts);

    // EWMA load
    acute = acute + (ts - acute) * (2 / (7 + 1));
    chronic = chronic + (ts - chronic) * (2 / (28 + 1));
    const acwr = chronic > 5 ? acute / chronic : 1;

    const gap = isGap(s, d);

    // base activity record (even gap days can have a logged workout)
    let activity = null;
    if (plan.sport && ts > 0) {
      activity = makeActivity(s, d, plan, ts, fit, rr);
    }

    if (gap) {
      days[s] = {
        date: s,
        gap: true,
        ts,
        acwr,
        load_acute: round(acute),
        load_chronic: round(chronic),
        activity,
      };
      continue;
    }

    // ---- recovery signals (respond to load) ----
    const loadStrain = clamp((acwr - 1) * 1.2 + (acute - chronic) / 80, -0.6, 1.1);
    const hrvBase = round(58 + fit * 6);
    const hrvLow = round(hrvBase * 0.86),
      hrvHigh = round(hrvBase * 1.12);
    const hrv = clamp(round(hrvBase + (rr("hrv") - 0.5) * 14 - loadStrain * 12), 28, 105);
    const rhr = clamp(round(45 + loadStrain * 6 + (rr("rhr") - 0.5) * 3), 40, 62);

    let sleepH = 7.2 + (rr("slp") - 0.5) * 1.8 - (plan.base > 120 ? 0.2 : 0);
    sleepH = clamp(round(sleepH * 10) / 10, 4.8, 9.3);
    const sleepScore = clamp(round(62 + (sleepH - 7) * 12 + (rr("sls") - 0.5) * 16), 30, 98);
    const deep = round(sleepH * 60 * (0.16 + rr("dp") * 0.05));
    const rem = round(sleepH * 60 * (0.21 + rr("rm") * 0.05));
    const awake = round(sleepH * 60 * (0.04 + rr("aw") * 0.05));
    const lightS = round(sleepH * 60) - deep - rem - awake;

    const stress = clamp(round(38 + loadStrain * 20 + (rr("st") - 0.5) * 16), 12, 86);
    const bodyBattery = clamp(
      round(sleepScore * 0.7 + 30 - loadStrain * 14 + (rr("bb") - 0.5) * 8),
      8,
      100
    );
    const steps = round(plan.base > 0 ? 8000 + rr("sp") * 9000 : 4000 + rr("sp") * 4000);
    const weight = round((70.4 - fit * 0.6 + (rr("wt") - 0.5) * 0.8) * 10) / 10;
    const vo2 = round(50 + fit * 3.4);

    // subjective check-in (athlete logs ~55% of recent days, rarer in past)
    const recent = (TODAY - d) / DAY < 70;
    let subj = null;
    if (recent ? rr("sj") < 0.55 : rr("sj") < 0.12) {
      subj = {
        energy: clamp(
          round(3 + (sleepScore - 70) / 16 - loadStrain + (rr("se") - 0.5) * 1.5),
          1,
          5
        ),
        soreness: clamp(round(2 + loadStrain * 1.5 + (rr("so") - 0.5) * 1.4), 1, 5),
        mood: clamp(round(3 + (rr("mo") - 0.4) * 2), 1, 5),
      };
    }

    // ---- readiness from signed factors ----
    const f_sleep = clamp((sleepScore - 74) / 2.6, -10, 10);
    const f_hrv = clamp(((hrv - hrvBase) / hrvBase) * 70, -15, 11);
    const f_load = clamp(-(acwr - 1.0) * 24, -17, 8);
    const f_stress = clamp(-(stress - 44) / 4.2, -9, 7);
    const f_subj = subj
      ? clamp((subj.energy - 3 + (3 - subj.soreness) + (subj.mood - 3)) * 1.7, -8, 8)
      : 0;
    const factors = [
      { key: "sleep", label: "Sleep", v: round(f_sleep) },
      { key: "hrv", label: "HRV vs baseline", v: round(f_hrv) },
      { key: "load", label: "Training load", v: round(f_load) },
      { key: "stress", label: "Stress", v: round(f_stress) },
      { key: "subjective", label: "How you felt", v: round(f_subj) },
    ];
    const readiness = clamp(round(68 + f_sleep + f_hrv + f_load + f_stress + f_subj), 5, 99);

    // data coverage: which inputs present
    const coverage = { sleep: true, hrv: true, load: true, stress: true, subjective: !!subj };

    days[s] = {
      date: s,
      gap: false,
      readiness,
      factors,
      sleep_hours: sleepH,
      sleep_score: sleepScore,
      sleep_stages: { deep, light: lightS, rem, awake },
      hrv,
      hrv_base_low: hrvLow,
      hrv_base_high: hrvHigh,
      hrv_base: hrvBase,
      resting_hr: rhr,
      body_battery: bodyBattery,
      acwr: round(acwr * 100) / 100,
      load_acute: round(acute),
      load_chronic: round(chronic),
      vo2max: vo2,
      stress,
      steps,
      weight,
      subjective: subj,
      coverage,
      activity,
    };
  }

  function makeActivity(s, d, plan, ts, fit, rr) {
    const sport = plan.sport;
    const isLong = /Long/.test(plan.kind);
    const isInt = /Interval|Tempo/.test(plan.kind);
    let dist, dur, elev;
    if (sport === "run") {
      dist = isLong ? 16 + rr("d") * 8 : isInt ? 8 + rr("d") * 4 : 6 + rr("d") * 3;
      dur = dist * (4.6 + rr("p") * 0.8); // min, ~4:36-5:24/km
      elev = round(dist * (6 + rr("e") * 20));
    } else {
      dist = isLong ? 55 + rr("d") * 45 : 28 + rr("d") * 22;
      dur = dist * (1.9 + rr("p") * 0.5);
      elev = round(dist * (8 + rr("e") * 14));
    }
    const avgHr = round(132 + (isInt ? 22 : isLong ? 6 : 0) + (rr("hr") - 0.5) * 8);
    return {
      date: s,
      sport,
      name: plan.kind,
      distance: round(dist * 10) / 10,
      duration: round(dur),
      elevation: elev,
      avg_hr: avgHr,
      max_hr: round(avgHr + 10 + rr("mx") * 14),
      suffer: round(ts * (0.5 + rr("sf") * 0.3)),
    };
  }

  // ============================================================
  //  HAND-TUNED TRAILING ARC (last 14 days) — the demo story:
  //  a half-marathon PB on May 24, recovery, then Tue intervals
  //  that left today's readiness suppressed → "Modify".
  // ============================================================
  const tuned = {
    "2026-05-21": r(72, [3, 4, -3, 1, 3], {
      sleep: 7.4,
      sls: 81,
      hrv: 64,
      base: 61,
      rhr: 45,
      bb: 74,
      acwr: 1.04,
      stress: 34,
      energy: 4,
      sore: 2,
      mood: 4,
      act: ["run", "Race shakeout", 5.2, 27, 28, 138, 152, 22],
    }),
    "2026-05-22": r(76, [4, 5, -1, 2, 4], {
      sleep: 7.8,
      sls: 86,
      hrv: 66,
      base: 61,
      rhr: 44,
      bb: 80,
      acwr: 0.96,
      stress: 30,
      energy: 4,
      sore: 1,
      mood: 5,
    }),
    "2026-05-23": r(79, [4, 6, 1, 2, 4], {
      sleep: 8.1,
      sls: 89,
      hrv: 68,
      base: 61,
      rhr: 43,
      bb: 86,
      acwr: 0.9,
      stress: 26,
      energy: 5,
      sore: 1,
      mood: 5,
      note: "taper",
    }),
    "2026-05-24": r(45, [2, -2, -10, -4, 1], {
      sleep: 6.6,
      sls: 70,
      hrv: 55,
      base: 61,
      rhr: 49,
      bb: 58,
      acwr: 1.32,
      stress: 58,
      energy: 4,
      sore: 4,
      mood: 5,
      race: true,
      act: ["run", "Half Marathon — PB", 21.1, 97, 88, 168, 182, 198],
    }),
    "2026-05-25": r(38, [-1, -6, -12, -5, -1], {
      sleep: 6.1,
      sls: 61,
      hrv: 49,
      base: 61,
      rhr: 52,
      bb: 41,
      acwr: 1.28,
      stress: 64,
      energy: 2,
      sore: 5,
      mood: 3,
    }),
    "2026-05-26": r(52, [1, -3, -7, -2, 1], {
      sleep: 7.0,
      sls: 76,
      hrv: 56,
      base: 61,
      rhr: 49,
      bb: 60,
      acwr: 1.18,
      stress: 48,
      energy: 3,
      sore: 4,
      mood: 4,
      act: ["run", "Recovery jog", 4.0, 26, 12, 128, 140, 18],
    }),
    "2026-05-27": r(64, [2, 0, -4, 0, 2], {
      sleep: 7.5,
      sls: 82,
      hrv: 60,
      base: 61,
      rhr: 47,
      bb: 72,
      acwr: 1.1,
      stress: 40,
      energy: 3,
      sore: 3,
      mood: 4,
    }),
    "2026-05-28": r(71, [3, 2, -2, 1, 2], {
      sleep: 7.7,
      sls: 85,
      hrv: 63,
      base: 61,
      rhr: 46,
      bb: 78,
      acwr: 1.02,
      stress: 35,
      energy: 4,
      sore: 2,
      mood: 4,
      act: ["ride", "Endurance ride", 42, 88, 410, 134, 148, 64],
    }),
    "2026-05-29": r(77, [4, 4, -1, 1, 3], {
      sleep: 7.9,
      sls: 88,
      hrv: 66,
      base: 61,
      rhr: 45,
      bb: 84,
      acwr: 0.97,
      stress: 31,
      energy: 4,
      sore: 2,
      mood: 5,
    }),
    "2026-05-30": r(73, [3, 3, -3, 0, 2], {
      sleep: 7.3,
      sls: 80,
      hrv: 64,
      base: 61,
      rhr: 46,
      bb: 70,
      acwr: 1.08,
      stress: 38,
      energy: 4,
      sore: 2,
      mood: 4,
      act: ["ride", "Long ride", 86, 182, 920, 138, 156, 132],
    }),
    "2026-05-31": r(66, [2, 1, -5, -1, 1], {
      sleep: 7.1,
      sls: 77,
      hrv: 61,
      base: 61,
      rhr: 47,
      bb: 64,
      acwr: 1.16,
      stress: 43,
      energy: 3,
      sore: 3,
      mood: 4,
      act: ["run", "Long run", 18.5, 96, 165, 142, 158, 142],
    }),
    "2026-06-01": r(70, [3, 2, -3, 0, 1], {
      sleep: 7.6,
      sls: 84,
      hrv: 62,
      base: 61,
      rhr: 46,
      bb: 75,
      acwr: 1.05,
      stress: 37,
      energy: 3,
      sore: 2,
      mood: 4,
    }),
    "2026-06-02": r(58, [1, -4, -6, -2, -1], {
      sleep: 6.7,
      sls: 69,
      hrv: 54,
      base: 61,
      rhr: 49,
      bb: 55,
      acwr: 1.22,
      stress: 52,
      energy: 2,
      sore: 3,
      mood: 3,
      act: ["run", "Intervals — 6×800m", 9.2, 52, 64, 156, 178, 96],
    }),
    "2026-06-03": r(64, [2, -5, -5, -1, 2], {
      sleep: 7.4,
      sls: 81,
      hrv: 56,
      base: 61,
      rhr: 48,
      bb: 68,
      acwr: 1.19,
      stress: 46,
      energy: 3,
      sore: 3,
      mood: 4,
      today: true,
    }),
  };

  // tuned-state factory
  function r(readiness, fv, o) {
    const factors = [
      { key: "sleep", label: "Sleep", v: fv[0] },
      { key: "hrv", label: "HRV vs baseline", v: fv[1] },
      { key: "load", label: "Training load", v: fv[2] },
      { key: "stress", label: "Stress", v: fv[3] },
      { key: "subjective", label: "How you felt", v: fv[4] },
    ];
    const sh = o.sleep,
      total = round(sh * 60);
    const deep = round(total * 0.18),
      rem = round(total * 0.22),
      awake = round(total * 0.05);
    const subj = o.energy ? { energy: o.energy, soreness: o.sore, mood: o.mood } : null;
    return {
      _tuned: true,
      readiness,
      factors,
      sleep_hours: sh,
      sleep_score: o.sls,
      sleep_stages: { deep, light: total - deep - rem - awake, rem, awake },
      hrv: o.hrv,
      hrv_base: o.base,
      hrv_base_low: round(o.base * 0.86),
      hrv_base_high: round(o.base * 1.12),
      resting_hr: o.rhr,
      body_battery: o.bb,
      acwr: o.acwr,
      stress: o.stress,
      vo2max: 61,
      steps: o.act ? 11000 : 6500,
      weight: 68.9,
      subjective: subj,
      coverage: { sleep: true, hrv: true, load: true, stress: true, subjective: !!subj },
      _act: o.act,
      _race: o.race,
      _note: o.note,
      _today: o.today,
    };
  }

  // splice tuned days in (compute load_acute/chronic to continue the curve)
  for (const s of Object.keys(tuned)) {
    const prev = days[s] || {};
    const t = tuned[s];
    days[s] = Object.assign({}, t, {
      date: s,
      gap: false,
      load_acute: prev.load_acute || round(t.acwr * 52),
      load_chronic: prev.load_chronic || 50,
    });
    if (t._act) {
      const [sport, name, distance, duration, elevation, avg_hr, max_hr, suffer] = t._act;
      days[s].activity = {
        date: s,
        sport,
        name,
        distance,
        duration,
        elevation,
        avg_hr,
        max_hr,
        suffer,
        race: !!t._race,
      };
    } else {
      days[s].activity = null;
    }
    delete days[s]._act;
  }

  // ---- derive activities list (most recent first) ----
  const activities = [];
  for (const s of list) {
    const dd = days[s];
    if (dd && dd.activity) activities.push(dd.activity);
  }
  activities.reverse();

  // ---- journal entries (woven across calendar/trends) ----
  const journal = [
    {
      date: "2026-06-02",
      tag: "niggle",
      text: "Left achilles a touch tight after intervals. Iced it, foam rolled. Not alarming — watching it.",
    },
    {
      date: "2026-05-31",
      tag: "note",
      text: "Legs came around on the long run. Felt smooth by km 12. Fueling dialed.",
    },
    {
      date: "2026-05-24",
      tag: "race",
      text: "Half PB — 1:37:42! Negative split, held form on the climb at 16k. Best I've paced a race.",
    },
    {
      date: "2026-05-20",
      tag: "note",
      text: "Race week. Sleep priority. Legs feel springy off the taper.",
    },
    {
      date: "2026-05-12",
      tag: "travel",
      text: "Two days in Lisbon for work — packed easy runs, kept it loose with the time zone.",
    },
    {
      date: "2026-04-28",
      tag: "illness",
      text: "Head cold. Took 3 days fully off. Better to lose a few sessions than dig a hole.",
    },
    {
      date: "2026-04-14",
      tag: "note",
      text: "Threshold session felt like a breakthrough. VO2 trend finally ticking up again.",
    },
  ];

  // ---- public API ----
  const COACH = {
    TODAY,
    todayISO: iso(TODAY),
    iso,
    parse,
    clamp,
    days,
    get: (s) => days[s] || null,
    range(fromISO, toISO) {
      const out = [];
      const a = parse(fromISO).getTime(),
        b = parse(toISO).getTime();
      for (let t = a; t <= b; t += DAY) {
        const s = iso(new Date(t));
        out.push(days[s] || { date: s, missing: true });
      }
      return out;
    },
    lastN(n, endISO) {
      const end = endISO ? parse(endISO) : TODAY;
      return this.range(iso(new Date(end.getTime() - (n - 1) * DAY)), iso(end));
    },
    activities,
    journal,
    today: () => days[iso(TODAY)],
    // readiness band + plain-language verdict
    band(v) {
      if (v == null) return { key: "none", label: "No score", color: "var(--text-3)" };
      if (v >= 67) return { key: "go", label: "Go", color: "var(--go)" };
      if (v >= 40) return { key: "modify", label: "Modify", color: "var(--modify)" };
      return { key: "back", label: "Back off", color: "var(--back)" };
    },
    verdict(v) {
      if (v == null)
        return { head: "Not enough data", sub: "No recovery signals synced for today yet." };
      if (v >= 80)
        return {
          head: "Train as planned",
          sub: "You're primed. Green light for the hard session.",
        };
      if (v >= 67)
        return { head: "Train as planned", sub: "Recovered and ready. Hit the plan as written." };
      if (v >= 53)
        return {
          head: "Modify — keep it aerobic",
          sub: "Some fatigue lingering. Hold intensity, keep it easy.",
        };
      if (v >= 40)
        return {
          head: "Modify — ease off",
          sub: "Recovery's incomplete. Trim volume or drop the intervals.",
        };
      if (v >= 25)
        return { head: "Back off today", sub: "Your body's asking for recovery. Easy or rest." };
      return { head: "Rest", sub: "Deep fatigue. Prioritize sleep and an easy day off." };
    },
    sportIcon(s) {
      return { run: "run", ride: "bike", swim: "swim", hike: "hike" }[s] || "run";
    },
    fmtDur(min) {
      const h = Math.floor(min / 60),
        m = round(min % 60);
      return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
    },
    fmtDate(s, opts) {
      return COACH.parse(s).toLocaleDateString(
        "en-US",
        opts || { weekday: "short", month: "short", day: "numeric" }
      );
    },
  };

  window.COACH = COACH;
})();
