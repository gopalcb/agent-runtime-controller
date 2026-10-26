# Portable GB Systems runtime template 0.2.0

This reviewed payload installs generic development guidance and tools into a
selected project's `.codex`. It includes no account configuration or prior user
knowledge. `manifest.json` inventories every deployable file relative to `.codex`,
with SHA-256, byte count and project-relative provenance. The Python installer
validates those hashes and owns deployment, conflict preservation and reset.

## Inventory and provenance

- `AGENTS.md`: adapted GB Systems instructions; portable project context,
  development stages, delegation ownership, checkpoint, activity, UI cleanup,
  explicit memory retention and optional messaging rules.
- `agents/*.toml`: five generic role templates (builder, planner, extraction,
  implementation, architecture/review). Account-specific model pins removed.
  The active client must register roles explicitly if desired; copying a TOML
  does not register a role or establish model availability.
- `skills/{plan-development,implement-development,python-development,
  ui-testing-and-debugging,computer-use}/SKILL.md`: canonical generic skills.
  The installer copies bundled skills into project `.agents/skills` for native
  discovery and adds a root `AGENTS.md` bridge, preserving existing files. Agent
  roles still require explicit client registration when desired.
- `workflows/{development,checkpoint,ui-testing}.md`, `references/task-records.md`
  and `assets/templates/project.toml`: reusable development procedures and project
  navigation scaffold. The TOML is a commented example, not account config.
- `workflows/memory.md`: newly authored controller note boundary; the installer
  separately creates `.codex/runtime-controller/memory`. This template exports
  no populated notes and never edits native generated memory.
- `tools/project_memory`: authored standard-library CLI for explicit note add,
  list and case-insensitive search; locked atomic notes.json index, bounded text,
  safe directory traversal and temporary-project tests. Installer reset/reinstall
  preserves notes. See its README for commands; no native generated memory access.
- `tools/runtime_logger`: Python source and usage instructions, adapted to UTC.
  Uses local yearly files, process/thread locks and standard-library dependencies.
- `tools/ui-testing-and-debugging`: requirements/stability CLI, validation,
  procedures, empty templates and source tests; optional pointer Swift/Node source
  and tests. Historic runs, screenshots and portfolio smoke checks excluded.

Original generic sources came from the GB Systems workspace `.codex` tree. Each
manifest `provenance.source` is relative to that workspace, never a user home path.
`audited-copy` means bytes copied from that source; `adapted` means portable edits;
`authored` identifies new template-only guidance. The manifest hashes the shipped
bytes, not an unmodified upstream version. Provenance records attribution, not a
new license grant. No external context skills were imported from `~/.agents`:
their redistribution provenance was not established. Review applicable source
rights before redistributing beyond the authorized project.

## Safe generation and inspection

From the package root:

```bash
python3 scripts/export-runtime-template.py --check
python3 scripts/export-runtime-template.py
python3 scripts/export-runtime-template.py --output /path/to/new/export
```

The exporter indexes only the committed, reviewed allowlist under this directory.
It never crawls the live runtime or reads CODEX_HOME. It rejects unknown/missing
payload files, symlinks and machine-specific home paths. Output must be a new
directory. Default generation writes only `manifest.json`, deterministically.
To refresh sources, explicitly review changes in the original generic files,
apply portable edits in this payload, regenerate, inspect the diff, and run checks.
This manual review boundary prevents accidentally exporting new private runtime
files. Source workspace `.codex` remains untouched.

## Prerequisites and boundaries

Python 3.11+ is required; runtime_logger uses `fcntl` on macOS/Linux. The exporter
uses only Python's standard library. The UI journal needs Node 22 and no npm
packages. Run `node --test tests/*.test.mjs pointer/pointer.test.mjs` from its tool
directory for structural/unit checks; these do not establish native UI stability.

Computer Use requires a separately installed compatible native MCP and OS
permissions. No native plugin or launcher is bundled. The optional pointer needs
macOS and Swift Command Line Tools; its MCP proxy expects the existing launcher
at `$CODEX_HOME/local-plugins/computer-use/bin/computer-use-client-launcher`.
See `docs/pointer.md`; no config editing or automatic MCP hookup is performed.
A missing GUI tool blocks native verification, while the journal remains usable.

The wrapper exports `RUNTIME_CONTROLLER_CODEX_HOME` as the selected project
`.codex` for portable procedure and skill references. Native `CODEX_HOME` remains
unchanged for authentication and account settings. For retained notes, run `python3 "$RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory/memory.py" list`,
`add 'explicitly requested note'` or `search 'query'`; add only at the user's
explicit retention request. Outside the wrapper, the memory CLI accepts --project.
For portable procedures outside the wrapper, set only
`RUNTIME_CONTROLLER_CODEX_HOME` to the project `.codex`; do not redirect native
`CODEX_HOME`. The logger derives its project runtime from its own installed file
location. The installer supplies the root instruction bridge and `.agents/skills`
copies; role registration remains optional and client-specific. Existing files
and account configuration are preserved.
Optional knowledge base and messaging integrations are not included or activated.
No shell/profile change, account model change or permission change is implied.

Excluded: actual `config.toml`, `auth.json`, `hooks.json`, environment/secrets,
private generated memories, sessions/history/databases, logs/caches/plugins,
account-specific commands, duplicate registrations, domain Glue/AWS/portfolio
content, browser profiles, captures, binaries, dependencies and generated artifacts.
Installer-owned memory and controller state are separate from versioned payload
files so reinstall/reset cannot replace user notes with a template snapshot.
