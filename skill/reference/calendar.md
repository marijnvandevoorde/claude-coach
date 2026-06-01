# Exporting the Plan to Google Calendar

When the athlete wants their plan in their calendar, **push the workouts straight into their linked Google Calendar** (via the Google Calendar MCP), or hand them an `.ics` to import.

## Live push (preferred — Google Calendar MCP)

Use this when the `mcp__claude_ai_Google_Calendar__*` tools are available.

1. **Get the event list** from the plan (rest days already removed):

   ```bash
   npx claude-coach export-calendar <plan>.json --json
   ```

   → an array of `{ date, title, sport, durationMinutes, description }`. (You can also read the plan JSON directly, but this is the reliable, de-duped source.)

2. **Pick the calendar.** Call `list_calendars`; default to the primary calendar, or ask if they keep a separate "Training" calendar.

3. **All-day vs timed.** Default to **all-day** events (just the date) — matches the `.ics` and avoids guessing workout times. If the athlete trains at a set time, offer **timed** events: start = date at their time, end = start + `durationMinutes`.

4. **Create each event** with `create_event`: `summary` = `title`, `description` = `description`, the chosen date/time, on the chosen calendar. Optionally set a per-sport `colorId`.

5. **Stay idempotent — don't duplicate.** Before a bulk add, `list_events` over the plan's date range and skip events that already exist with the same title + date (the `title` starts with a sport emoji, so prior imports are easy to spot). If the plan changed, offer to update/replace the previous import rather than stacking a second copy.

6. **Confirm:** "Added N sessions to your <calendar> calendar, <start> → <end>."

## Offline (.ics import)

If the MCP isn't available or they prefer manual import:

```bash
npx claude-coach export-calendar <plan>.json -o my-plan.ics
```

They import the `.ics` into Google/Apple/Outlook (all-day events).

> The same workouts can also be pushed to a Garmin watch as structured workouts — see `skill/reference/garmin-workouts.md`.
