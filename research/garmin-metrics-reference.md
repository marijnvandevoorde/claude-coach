# Garmin Physiological Metrics — Official Reference

Extracted from Garmin Technology pages via rendered DOM (JavaScript-rendered SPAs). All quotes are verbatim from the official pages.

---

## 1. Training Readiness

### Definition

"Training readiness is a top-line insight designed to help you maximize training efficiency." It is "classified from poor to prime with low, moderate, and high in between." Checking the widget shows a current readiness score and how underlying factors contributed.

### Inputs / Data Sources

The page distinguishes two tiers explicitly:

**Primary drivers** (verbatim):

> "The primary drivers behind your training readiness assessment are how well you slept last night and residual recovery demands of recent activities. This information comes from your recovery time and advanced sleep tracking."

**Secondary influences** (verbatim):

> "Beyond that, training load trends, HRV (Heart Rate Variability) status, recent stress levels and how well you have been sleeping prior to last night also influence your results."

The six named factors and their own sub-definitions:

| Factor                  | Description                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sleep Score**         | 0–100; based on sleep duration, sleep stage distribution, and autonomic nervous system recovery evidence (HRV-derived). Compares to expert-organization standards.                                                          |
| **Recovery Time**       | Countdown to full recovery from last activity. Modulated by activity strenuousness, stress, sleep quality, daily physical activity.                                                                                         |
| **Acute Training Load** | EPOC-based; full impact of each activity added immediately, expires gradually over 10 days, normalized to 7-day window.                                                                                                     |
| **HRV Status**          | 7-day average HRV vs. personal baseline. Balanced = within baseline (good recovery signal). Unbalanced may reflect inadequate recovery, excessive workload, alcohol, or illness.                                            |
| **Sleep History**       | How well you slept in nights prior to last night. One good night does not erase a prior sleep deficit. Also: an exceptionally long awake period (e.g., 20 hours) before the most recent night's sleep can reduce readiness. |
| **Stress History**      | "Considers stress levels from the past three days while you are awake." Prolonged high stress reduces resiliency and training benefits.                                                                                     |

No explicit weightings or percentages are stated for any factor.

### Scale & Levels

Five levels named; no numeric bands are given on the official page:

- **Poor**
- **Low**
- **Moderate**
- **High**
- **Prime**

Sleep Score sub-metric: **0–100**.

### How It's Computed / Time Windows

- **Morning update** (biggest adjustment): sleep score, HRV status, sleep history, acute training load, and stress history are all refreshed when you wake up.
- **Throughout the day**: readiness updates as recovery time countdown expires (increases readiness) or after recording an activity (decreases readiness). "Light efforts have minimal impact while hard workouts can significantly reduce your readiness."
- Stress history window: **3 days** (while awake).
- No formula or algorithmic weighting is disclosed.

### Relationships

- **Derives from**: Recovery Time, Sleep Score (advanced sleep tracking), HRV Status, Acute Training Load, Sleep History, Stress History.
- **Does not feed** other listed metrics; it is a top-line output.
- The feature can also surface in the **morning report**.

---

## 2. Recovery Time

### Definition

"Scientifically personalized insight into how long it will be before you are fully recovered." Timer reaches zero when "you are ready to gain the maximum benefit from your next hard fitness-improving (i.e., training effect: 3.0+) type workout."

### Inputs / Data Sources

**Primary basis** (verbatim):

> "The primary basis for recovery time recommendations involves analyzing and interpreting performance data from your recorded activities. The amount of strain resulting from your workouts is interpreted based on a combination of your current fitness level and recent training history. It is measured in terms of excess post-exercise oxygen consumption (EPOC) based training load."

**Behind-the-scenes adjustments** to the primary EPOC estimate:

- Time remaining on recovery timer **at the start of your workout**
- Trends in **VO2 max** fitness level
- **Acute (7-day) to chronic (28-day) training load ratio** (ACWR)

**Lifestyle/health layer** (newer compatible devices):

- All-day **stress tracking** data
- Estimated **sleep tracking** data
- **Daily activity levels** (day-to-day movement)

Effects: stressful day or bad sleep → extends recovery time; good sleep + low stress + light daily activity → shortens recovery time.

### Scale & Levels

A countdown in **hours**. No fixed maximum is stated. Hits zero when fully recovered.

### How It's Computed

1. EPOC-based load from the activity is the starting point.
2. Adjusted for: remaining recovery time at workout start, VO2 max trend, ACWR (acute 7-day / chronic 28-day ratio).
3. Then modulated by stress, sleep quality, and daily activity levels.

ACWR windows stated verbatim: **"acute (7-day) to chronic (28-day) training load ratio"** — the only place in Garmin's official pages where these explicit windows appear for ACWR.

### Relationships

- **Primary input to**: Training Readiness (listed as "Recovery Time" factor).
- **Modified by**: Training Load (EPOC), VO2 Max, Stress, Sleep.
- **Feeds into**: Running Tolerance — "how your acute impact load accumulates may extend the duration of your recovery time recommendation."

---

## 3. Training Load

### Definition

"Training load is an excess post-exercise oxygen consumption (EPOC) based metric designed to help you understand the physiological impact and resulting recovery demands of your activities."

Two views:

- **Exercise load**: strenuousness of a single activity.
- **Acute load**: combined physiological impact of recent activities.

### Inputs / Data Sources

- **Heart rate data** during any activity — used to estimate EPOC in real time via "advanced mathematical modeling and machine learning" (Garmin Human Performance Lab engine).
- For **Training Load Focus**: intensity-category breakdown analyzed over the past **4 weeks**.

No running dynamics, GPS, or power data explicitly cited here as EPOC inputs (heart rate is the stated basis).

### Scale & Levels

**Exercise / Acute Load**: EPOC units — no explicit numeric range published on this page.

**Training Load Focus** — three categories (verbatim names and colors):

| Category     | Color      | Description                                                                                                                  |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Anaerobic    | Purple     | High-intensity bursts (seconds to ~2 minutes); heart rate rises quickly (e.g., sprint intervals)                             |
| High aerobic | Orange     | Sustained moderately high- to high-intensity; heart rate significantly elevated for minutes up to 30+ min (e.g., tempo runs) |
| Low aerobic  | Light blue | Sustained low-intensity "conversational pace" (e.g., long slow runs)                                                         |

Time window for Focus: **past 4 weeks**.

Qualitative feedback labels:

- **Shortage**: lacking in a category
- **Balanced**: well distributed across intensities
- **Focus**: reasonably structured but particularly focused in one area
- **Below Targets**: overall load too low
- **Over Targets**: overall load too high

### How It's Computed

- **EPOC estimated in real time** from heartbeat data using mathematical modeling + machine learning.
- **Acute load** = weighted moving average. Full impact of each activity added immediately; influence expires gradually, "disappearing completely after ten days"; total normalized to reflect a **7-day window**.
- **Older devices**: simple sum of all activities in the past **7 days** (not weighted).
- Training Load Focus looks at intensity-category composition over **4 weeks**.
- Post-activity, a color-coded label on the Training Effect summary screen shows primary benefit category (anaerobic / high aerobic / low aerobic / gray = no meaningful impact).

### Relationships

- **Primary input to**: Recovery Time (EPOC-based load is the foundation).
- **Input to**: Training Readiness (as "Acute Training Load"), Training Status (as "Acute Training Load"), and implicitly Running Tolerance (as chronic running history baseline).
- **Derives from**: heart rate data during recorded activities.

---

## 4. Training Status

### Definition

"The training status widget on compatible Garmin devices is where you can see how your training is going. This longer-term perspective helps you look beyond normal day-to-day changes to reveal the big picture."

Core mechanism: "interpret changes in your fitness relative to trends in your training volume and composition."

### Inputs / Data Sources

Three core inputs (verbatim):

> "Your training status relies on three critical perspectives: fitness estimated in terms of VO2 max, load data from your activities and heart rate variability."

| Input                   | Detail                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **VO2 max**             | Estimated automatically during outdoor runs and cycling with power meter. Tracked separately for running and cycling. Training status based on most often recorded activity type. Needs >1 estimate in recent history; at least one run/ride per week recommended. |
| **Acute Training Load** | From all activities recorded with heart rate. Expires after 10 days. Optimal range based on current fitness level + activity history ("insight from your activity history is used to dial in your personal load tolerance").                                       |
| **HRV Status**          | 7-day average overnight HRV vs. personal baseline (set over first 3 weeks). Balanced = within baseline. Unbalanced (low) = struggling to recover or fighting illness/infection. Note: overloading can sometimes cause unusually _high_ HRV.                        |
| **Load Focus**          | Used "in specific scenarios" — intensity distribution (low/high aerobic + anaerobic) for additional situational understanding.                                                                                                                                     |

Sleep is **not** listed as a direct input to Training Status. HRV status serves as the recovery/lifestyle proxy.

### Scale & Levels

Ten states, with official interpretations (verbatim from the table on the page):

| Status           | Interpretation                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Peaking**      | Fitness increasing despite recent reduction in load; can occur during tapering.                                                                                         |
| **Productive**   | Fitness generally increasing from effective training. If not running/cycling regularly, may still be Productive if HRV status remains balanced during heavier training. |
| **Maintaining**  | Challenging enough to support current fitness without clear evidence of increasing it. Load Focus may suggest how to jumpstart progress.                                |
| **Strained**     | Performance ability limited; inadequate recovery probable cause (unusually high load, or health/lifestyle factors interfering with bounce-back).                        |
| **Unproductive** | Fitness declining but not necessarily from excessive load. Check nutrition, daily stress, sleep quality.                                                                |
| **Overreaching** | Acute load significantly higher than normal; body struggling. May show decreasing performance or low/unbalanced HRV status.                                             |
| **Recovery**     | Activities less challenging than normal; fitness holding steady or slightly decreasing.                                                                                 |
| **Detraining**   | Fitness decreasing from extended break from regularly challenging activities.                                                                                           |
| **No Status**    | Not enough information.                                                                                                                                                 |
| **Paused**       | Paused in device settings.                                                                                                                                              |

No numeric thresholds are published for any status boundary.

### How It's Computed

- A "unique multidimensional analysis" — no formula disclosed.
- Connects direction of **VO2 max trend** with **training load level** and **HRV status**.
- HRV status enables assessment "even when you are not getting regular fitness updates by running outdoors or cycling with a power meter."
- Optimal load range: personalized from fitness level + activity history.
- Status can be paused manually.

### Relationships

- **Derives from**: VO2 Max, Acute Training Load, HRV Status, Load Focus.
- **Does not directly feed** other metrics (top-level output for training phase assessment).

---

## 5. Running Tolerance

### Definition

"Running tolerance is a unique feature designed to help you recognize potentially hazardous training patterns and avoid them. It offers you the insight you need to intelligently manage the impact of running on your body as you work to build and maintain mileage."

### Inputs / Data Sources

**Impact load inputs** (to estimate ground reaction forces in real time via neural network):

- **Weight**
- **Speed and intensity**
- **Running dynamics**: cadence, ground contact time, "and more"
- **Gradient**: uphill and downhill efforts receive "special consideration according to the steepness of the climb or descent"

**Tolerance inputs**:

- **Recent and long-term running history** (personalized; adjusted at start of each training week)

Stress, HRV, and sleep are **not** mentioned as inputs anywhere on this page.

### Scale & Levels

- Impact load is expressed as **equivalent mileage** (not raw units).
- Comparative load benchmarks (verbatim):
  - Walking detected during a run: **"half the impact of basic endurance running"**
  - Speedy downhill: **"as much as three times harder than an easy run on level ground"**
- Two states:
  - **Normal**: acute impact load within tolerance
  - **Cautionary**: acute impact load exceeds tolerance — "an encouragement to evaluate your situation and proceed with special care"; "consistently pushing beyond this limit should be interpreted as a potentially hazardous training pattern"
- **Tolerance** = personalized maximum, adjusted at start of each training week. Increases with consistently challenging training; decreases with reduced volume.

No numeric thresholds are published.

### How It's Computed

- Ground reaction forces estimated in real time by a **neural network** trained for that purpose.
- **Acute impact load** = weighted sum; full impact of each run added immediately, influence diminishes gradually over time (no specific expiry window stated, but structure mirrors the general training load model).
- **Tolerance** = "science-based interpretation of your recent and long-term running history," updated weekly.
- Weekly cumulative loads (training week screen) may vary slightly from current acute load because acute load uses a weighted calculation.

### Relationships

- **Feeds into**: Recovery Time — extended acute impact load (e.g., long run or heavy downhill) "may extend the duration of your recovery time recommendation."
- **Uses**: running dynamics data (cadence, GCT, etc.), gradient, speed, weight.
- **Does not use**: HRV, sleep, stress, VO2 max (purely biomechanical).

---

## 6. Body Battery

### Definition

"The Body Battery feature on your Garmin watch is designed to help you monitor your personal energy resources around the clock. Powered by the Garmin Human Performance Lab, Body Battery energy monitoring makes the combined influences of physical activity, stress, rest and the restorative power of sleep visible in a powerful way."

### Inputs / Data Sources

Continuous inputs (verbatim):

> "The Body Battery feature works by continuously analyzing combinations of heart rate, heart rate variability (HRV) and movement data while you wear your device."

Additional inputs:

- **All-day stress levels** (0–100 scale, explicitly stated)
- **Sleep tracking** (including sleep quality and timing)
- **Sleep pressure / homeostatic sleep drive** (accumulates while awake, dissipates during sleep)
- **VO2 max / fitness level** (modulates how much exercise and stress affect Body Battery relative to baseline)

### Scale & Levels

**Stress scale**: explicitly **0–100**. Two regimes with direct Body Battery effects:

| Stress Level    | Body Battery Effect | ANS Dominance   | HR     | HRV    |
| --------------- | ------------------- | --------------- | ------ | ------ |
| **0–25 (rest)** | Charging            | Parasympathetic | Lower  | Higher |
| **25–100**      | Draining            | Sympathetic     | Higher | Lower  |

Verbatim: "Stress levels below 25 are classified as rest, a state associated with parasympathetic dominance... Stress levels above 25 reflect sympathetic dominance... with the degree of dominance increasing as your stress levels rise."

**Body Battery scale**: the page refers to it charging and draining but does not explicitly state the 0–100 range in the article text (though it's widely reported elsewhere). Described as "fullest in the morning."

Charging/draining hierarchy:

- Vigorous exercise drains faster than light effort; duration also matters.
- Stress above 25 → draining; higher stress → faster drain.
- Rest below 25 → charging; lower heart rate and higher HRV relative to personal baseline = stronger charge effect.
- Sleep = primary recharge opportunity (special role separate from rest).
- Sleep pressure can **outweigh** the charging effect of lighter resting moments.

### How It's Computed

1. Continuous HR + HRV + movement analysis to classify state (awake/asleep, active, resting, stressed).
2. **Exercise drain**: proportional to intensity + duration.
3. **Stress drain/charge**: stress 0–25 → charge (strength varies with how relaxed you are); stress 25–100 → drain (rate increases with stress level).
4. **Sleep pressure** (homeostatic sleep drive): accumulates steadily from wake-up; "consistent draining force" that can outweigh resting charge; fully restored by a complete night of good sleep. Short sleep after a long day = lingering sleep pressure deficit.
5. **Fitness modifier**: higher VO2 max → exercise and stress have smaller relative impact → better resiliency (built into the feedback engine).

### Relationships

- **Derives from**: Heart rate, HRV (continuous), movement, all-day stress (0–100), sleep tracking, sleep pressure, VO2 max.
- **Connects to**: Training Readiness (stress and sleep — both Body Battery inputs — are also Training Readiness inputs; HRV is shared).
- **Connected features mentioned**: Pulse Ox (listed in health science nav), Respiration Rate, Sleep Tracking, HRV Status, Stress Tracking — all listed as related health science features.
- Body Battery is a **consumer-facing energy metaphor** that combines all physiological signals into a single draining/charging value; it does not directly feed other analytical metrics as a data input.

---

## Notes: Where Official Text Contradicts Common Third-Party Descriptions

**1. Training Readiness numeric bands — not published officially.**
Many third-party sources (forum posts, coaching apps) circulate specific bands such as "Prime: 73–100, High: 56–72, Moderate: 40–55, Low: 26–39, Poor: 0–25." The official Garmin page names only five levels (Poor, Low, Moderate, High, Prime) without any numeric boundaries. If those bands are real, Garmin has not published them here.

**2. Sleep is NOT a direct input to Training Status.**
Some third-party write-ups list sleep quality or sleep score as a direct Training Status input. The official page lists three core inputs — VO2 max, Acute Training Load, HRV Status — and mentions Load Focus as a situational supplement. Sleep influences HRV status indirectly, making it a second-order input at most. The page is explicit: "Your training status relies on three critical perspectives: fitness estimated in terms of VO2 max, load data from your activities and heart rate variability."

**3. Recovery Time ACWR windows are 7-day acute / 28-day chronic.**
This is stated verbatim on the Recovery Time page and is not widely cited in third-party Garmin summaries. Many summaries describe Recovery Time as purely EPOC-based without mentioning the ACWR adjustment layer.

**4. Acute Training Load uses a 10-day weighted expiry, not a simple 7-day window.**
Older Garmin devices used a simple 7-day sum. Current devices use a weighted moving average where each activity's influence expires over 10 days, then normalize to a 7-day equivalent. Third-party sources often still describe this as "a 7-day rolling sum" without the weighting nuance.

**5. Training Load Focus uses a 4-week window, not 7 days.**
The anaerobic / high aerobic / low aerobic intensity breakdown covers the past **4 weeks**, distinct from the 7-day-normalized acute load. These are often conflated.

**6. Running Tolerance is purely biomechanical — no HRV, sleep, or stress.**
Given how heavily Garmin integrates HRV and sleep across other metrics, it is common to assume Running Tolerance also factors them in. The official page lists only biomechanical inputs: weight, speed, running dynamics (cadence, GCT), and gradient, estimated via a neural network for ground reaction forces. Lifestyle signals are absent.

**7. Body Battery charging threshold is exactly stress ≤ 25, not a vague "low stress."**
The official page states explicitly: "Stress levels below 25 are classified as rest... Stress levels above 25 reflect sympathetic dominance." The 25-point threshold is a hard published cutoff; third-party descriptions often use qualitative language ("low stress charges the battery") without naming the threshold.

**8. Body Battery's explicit 0–100 range is not stated in the article.**
While the 0–100 range is universally reported and visible on device screenshots, the Body Battery article text itself does not state this range. The stress scale 0–100 is explicitly stated; the Body Battery scale boundary is implied but not published in this page's copy.
