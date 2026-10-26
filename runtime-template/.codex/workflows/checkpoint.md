# Checkpoint and resume

Read $RUNTIME_CONTROLLER_CODEX_HOME/references/task-records.md for record locations and content.
Resolve RUNTIME_CONTROLLER_CODEX_HOME from the environment.

## Save checkpoint

1. Identify the active project and task. Ask only when the target is ambiguous.
2. Obtain a stable handoff from running agents. Identify anything still running
   or incomplete; do not imply that active work has stopped.
3. Read existing task records and inspect relevant working-tree changes.
   Create a task folder if none exists.
4. Update plan.md for changed requirements, scope, or approach. If missing,
   record the agreed direction without inventing prior decisions.
5. Update summary.md with current status, completed and remaining work, changed
   files, decisions, verification evidence, blockers, and exact next steps.
6. Preserve useful evidence, distinguish assumptions, and flag stale results.
   Do not rerun tests solely to save a checkpoint.
7. Save the records without changing implementation code, creating a Git commit,
   or editing generated native memory. A checkpoint is a written handoff.
8. Log the checkpoint using `write_activity` from
   `$RUNTIME_CONTROLLER_CODEX_HOME/tools/runtime_logger/runtime_logger.py`. Report logging failures
   briefly and continue. Confirm saved paths
   and provide a short resume prompt. Stop unless continued work was requested.

## Resume saved work

1. Read plan.md and summary.md.
2. Inspect current code and working-tree changes for differences since the save.
3. Identify the next incomplete task and choose the appropriate execution approach
   under AGENTS.md.
4. Revalidate affected results when code or environment changes make them stale.
5. Continue without repeating completed work unless uncertainty requires it.