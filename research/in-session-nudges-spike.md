# Spike: in-session nudge mechanism (ID20)

> **Decision: a `SessionStart` hook (Claude Code) as the primary mechanism, with a skill instruction as the portable fallback. No daemon, no new MCP.**

## The question

Sprint 2 made reminders _proactive_ (cron → push). Sprint 3 wants them _ambient_: when you're already chatting with Claude, it should gently surface anything overdue (water behind goal, past bedtime, low readiness) without you asking — and adapt today's plan to your recovery. How should "check wellness state when a conversation is happening" be wired?

## Options considered

| Option                                        | How                                                                                                                                                                      | Verdict                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `SessionStart` hook**                    | A Claude Code hook runs `claude-coach checkin --greeting` at session start; its stdout is injected as additional context, so Claude can mention overdue items naturally. | ✅ **Chosen (primary).** Deterministic, local, reuses the existing `checkin` logic, zero new processes. Fires exactly when a conversation begins.                                                    |
| **B. Skill instruction**                      | When the `coach` skill is active, it reads wellness state (via the CLI) and surfaces nudges.                                                                             | ✅ **Chosen (fallback).** Works on claude.ai (no hooks/CLI host) and inside coaching chats. Limitation: only fires when the skill is actually invoked, so it can't be the _primary_ ambient trigger. |
| C. `UserPromptSubmit` hook (every N messages) | Re-check on each prompt, nudge every 3–5 messages (coach-claude style).                                                                                                  | ❌ Too chatty for a training coach; risks nagging. SessionStart once-per-conversation is the non-intrusive choice. We already dedup pushes; we don't want a second nag channel.                      |
| D. Local nudge daemon / new MCP               | Long-running service surfaces nudges.                                                                                                                                    | ❌ Rejected up front in the architecture decision — we deliberately avoided a daemon. The cron backbone + a hook cover it.                                                                           |

## Chosen design

1. **CLI:** add `claude-coach checkin --greeting` — prints **one concise line** of context aimed at Claude when something is overdue (hydration behind, near/past bedtime, low readiness), or **nothing** when all is well (so the hook adds zero noise). Reuses the `checkin` reminder/recovery computation; reads cached Garmin/wellness from `coach.db`.
2. **Claude Code hook (ID21):** a `SessionStart` hook runs that command and feeds its output into context. Documented in `REMINDERS.md`; opt-in (the user adds it to `.claude/settings.json`, or asks the skill/`update-config` to add it).
3. **Skill instruction (ID21 fallback + ID22):** SKILL.md tells the coach, at the start of a coaching chat, to run `checkin --greeting` and weave in anything overdue; and to recognize natural-language logging ("logged 500 ml", "did my run") → `coach log …`.
4. **Readiness-driven adjustment (ID23):** a reference doc + SKILL.md rule: before prescribing/confirming today's session, read Garmin readiness/sleep/HRV and ease, swap, or green-light accordingly.

## Non-goals

- No always-on process. No per-message nagging. No new MCP server.
