# Portable controller memory

The controller owns .codex/runtime-controller/memory within each selected project.
The installer creates its initial scaffold and preserves existing notes. The
versioned payload deliberately contains no populated memory directory.

These are ordinary plugin-owned project notes, separate from Codex-generated
native memory. Never copy native memory/session/auth/database state into this
folder. Do not edit generated native memory. There is no imported historical user
knowledge in this template.

Only write durable notes at the user's explicit request to remember or retain
information. Prefer the narrowest authoritative project documentation when it
owns the fact. Before saving, read existing relevant notes, remove duplication,
exclude credentials/personal data and distinguish verified facts from assumptions.
Use small descriptive Markdown notes; include date, scope, source and verification
limits. Confirm the actual saved path. Keep temporary progress in docs/tasks.

At resume, read only relevant plugin-owned notes and task records. Verify facts
that may have drifted against current files. Report stale or unverified recall.
Do not interpret a recorded note as authorization for external side effects.

## Explicit note commands

Read $RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory/README.md for the local
stdlib CLI. Use its `add` command only for text the user explicitly asked to retain;
`list` and `search` retrieve project-owned notes without extracting prompt history.
The CLI stores bounded notes in memory/notes.json using locked atomic updates and
rejects symlinked storage paths. Outside the wrapper, pass an explicit --project
root. Native CODEX_HOME, generated memory and account authentication are untouched.
Installer reset/reinstall preserves this entire memory namespace.
