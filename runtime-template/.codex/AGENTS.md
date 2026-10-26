# Portable GB Systems development instructions

## Project context and skills

Identify the target project and read applicable AGENTS.md files. Inspect relevant
code, tests, configuration, documentation and architecture before changes. Follow
established conventions and preserve unrelated and concurrent work. Verify recalled
information against current files and resolve material conflicts.

Apply relevant available skills. For Python use skills/python-development/SKILL.md.
Resolve procedure paths below relative to RUNTIME_CONTROLLER_CODEX_HOME from the environment. The
controller wrapper exports RUNTIME_CONTROLLER_CODEX_HOME as the selected project's
.codex directory. Native CODEX_HOME remains unchanged for account authentication
and settings. Outside the wrapper, set only RUNTIME_CONTROLLER_CODEX_HOME to the
project's .codex directory; do not redirect native CODEX_HOME. This template does
not change account settings, permissions, models, or client configuration.

## Execution approach

Answer questions directly. For clear, localized, low-risk changes, inspect,
implement and verify directly; do not create task records unless requested.
For complex or consequential work, read workflows/development.md and run
skills/plan-development/SKILL.md then skills/implement-development/SKILL.md in the
main conversation. Planning-only requests stop after the plan. Judge by impact
and uncertainty rather than file count. Escalate unexpected complexity.

Delegate only when explicitly requested or when a bounded independent task clearly
benefits. Use only roles exposed by the active client. The installer adds a root
AGENTS.md bridge and copies bundled skills to .agents/skills for native discovery,
preserving existing files. The agents/*.toml files are portable role templates:
registration is optional and client-specific. They inherit the selected model; no model entitlement or role availability is assumed. State the
selected available role and purpose before delegation. Assign context, constraints,
explicit file ownership, acceptance criteria and verification. Preserve others'
work. Use read-only assignments for research/review, no recursive delegation, and
at most three concurrent subagents. Keep dependent work sequential. Main owns
planning, integration, task records and shared indexes. If roles are unavailable,
continue in the main thread when suitable and report the limitation.

Always inspect final changes and verify observable acceptance criteria. Use
inspection for documentation, focused checks for configuration, relevant tests for
behavior, and browser verification for UI behavior. Report deferred, unavailable,
blocked and unexecuted checks honestly. Never claim an unexecuted check passed.

## Supporting procedures

Read only the needed files under RUNTIME_CONTROLLER_CODEX_HOME:

- workflows/development.md for planned development.
- references/task-records.md before creating/updating task records.
- workflows/checkpoint.md for a clear checkpoint request or saved-task resume.
- workflows/ui-testing.md for browser verification.
- workflows/memory.md for plugin-owned durable notes.

Report missing procedures and continue unaffected work without claiming compliance.
A checkpoint saves a concise handoff; it does not imply a commit or stopped work.

## Context, durable feedback and memory

Keep task progress in project docs/tasks records, architecture and procedures in
project documentation, and persistent instructions in AGENTS.md. Search relevant
records when useful and verify against current source. Keep secrets and sensitive
runtime output out of records, notes and logs.

Use .codex/runtime-controller/memory for plugin-owned durable notes, following
workflows/memory.md. The installer initializes the scaffold independently of the
versioned template. Never copy, inspect for export, overwrite, or manually edit
Codex-generated native memories, sessions, databases or account state. The portable
runtime does not include prior user/project memory. Update durable notes only when
the user explicitly asks to remember or retain guidance. Store feedback in the
narrowest appropriate authoritative project instruction or document after checking
conflicts and duplication; confirm the saved path. Ordinary corrections apply to
the current task and are not automatically permanent instructions.

An optional knowledge base is consulted only when the user uses kb: as a clear
lookup instruction. If $RUNTIME_CONTROLLER_CODEX_HOME/kb/index.md exists, read it and follow its path
rules; otherwise report that no knowledge base is configured. Do not create or
modify it unless requested. Quoted examples of the prefix do not trigger lookup.

## Activity and communication

Use write_activity(agent, event_message, project="") from
$RUNTIME_CONTROLLER_CODEX_HOME/tools/runtime_logger/runtime_logger.py at meaningful planned-work
milestones. One completion event suffices for a small direct change; do not log
routine questions. Normalize names: remove leading slashes; replace non-ASCII
letters/numbers/hyphens/underscores with underscores; prefix agent_ if the result
does not begin with a letter or number; truncate to 120 characters; use agent for
an empty result. Use a brief factual message without secrets, full prompts or
output. Main logs delegated milestones on behalf of read-only agents. Report
logging failure briefly and continue.

Keep updates concise and focused on outcomes, findings and blockers. Explain
material plan changes; ask only for information necessary to proceed. Respect
scope and existing authorization; avoid routine confirmation. Report incomplete
and unverified work clearly.

## Browser verification and cleanup

Read $RUNTIME_CONTROLLER_CODEX_HOME/tools/ui-testing-and-debugging/README.md and pass its requirements
gate. Computer Use is the primary browser driver; inspect DevTools network
payload/response and console where needed. Fix/retest until agreed scoped stability
or a concrete blocker. Keep shared UI procedures and run records under that tool
directory. Label supplemental automation separately. Do not claim native stability
without two complete clean native cycles on final source.

After every UI testing session, including failed or blocked runs, close all
controlled browser windows, contexts and processes opened for testing. Put cleanup
in finally blocks and verify no owned test browser processes remain. Preserve
regular user sessions and unrelated tabs; never use a blanket browser kill.
Identify existing controlled browsers by automation profile/process ownership when
cleanup is requested. Leave a controlled browser open only at explicit user request.

## Optional messaging

This template does not install or enable multi-agent messaging. Ordinary prompts
must not start or register messaging. Only an explicit /multi-agent request may
activate a separately installed messaging integration; read its installed
instructions first and report missing prerequisites. Native spawning alone does
not establish messaging delivery. Preserve inherited account settings and auth.
