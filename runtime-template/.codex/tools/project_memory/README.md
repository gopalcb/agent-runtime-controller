# Explicit project notes

This Python 3.11+ macOS/Linux CLI stores only text the user explicitly asks to
retain. It performs no prompt extraction, background collection, credential
scanning, account lookup or native generated-memory writes. Do not store secrets
or sensitive personal data. These are local plaintext notes, not encrypted storage.

The controller wrapper supplies `RUNTIME_CONTROLLER_CODEX_HOME` as the selected
project `.codex`; native `CODEX_HOME` remains untouched. From any directory:

```bash
python3 "$RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory/memory.py" list
python3 "$RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory/memory.py" add 'Remember the verified project test command: npm test.'
python3 "$RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory/memory.py" search 'test command'
```

Without the wrapper, use the installed script path and an existing project root:

```bash
python3 path/to/.codex/tools/project_memory/memory.py --project path/to/project list
```

`--project` takes precedence over the project environment variable. Results are
JSON arrays. `add` returns the new note; `list` returns all notes; `search` matches
case-insensitive text substrings. Empty/oversized text and malformed indexes fail
without replacing existing notes. Each note has UUID, UTC creation time and text.
Limits: 8000 characters per text/query, 1000 notes, and 4 MiB for the full index.

Storage is `.codex/runtime-controller/memory/notes.json`. Missing storage is created
only on add; listing/searching an uninitialized project writes nothing. Updates
use a process lock, private temporary file, fsync and atomic replacement. Final
index and lock files use mode 0600; newly created directories use mode 0700.
Symlinked project roots, namespace components, index and lock files are rejected;
directory handles constrain descendant access during the operation. Select a
trusted local project directory; this is not a sandbox against other privileged
processes editing the project concurrently.

Installer reset/reinstall preserves the entire memory namespace, including notes
and scaffold documentation. The CLI has no delete/reset command; explicit editing
or deletion of notes is separate project-data work. Do not edit notes.json while
another writer is active. Corrupt/unsupported indexes fail with an actionable
error instead of being silently reset. Native generated memory is never read or
written.

Run focused tests (temporary project fixtures only):

```bash
python3 -B -m unittest discover -s "$RUNTIME_CONTROLLER_CODEX_HOME/tools/project_memory" -p 'test_*.py' -v
```
