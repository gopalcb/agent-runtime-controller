# Project note CLI architecture

`memory.py` resolves an explicit project root or RUNTIME_CONTROLLER_CODEX_HOME,
validates bounded note records, and lists/searches/appends the project's plaintext
controller notes. It uses only Python's standard library on macOS/Linux.

The command flow is argparse → project resolution → safe namespace traversal →
locked index validation → atomic replacement for add → JSON output. Reads do not
initialize storage. All runtime data belongs to
`.codex/runtime-controller/memory`; native CODEX_HOME and generated memories are
outside this tool's responsibility. Installer lifecycle operations preserve data.

`test_memory.py` covers isolation, reload/search, no-write reads, native-home
preservation, symlink rejection, invalid data, concurrent additions and interrupted
replacement using temporary project fixtures. README.md owns commands, limits and
retention policy; code-map.yaml owns function navigation.
