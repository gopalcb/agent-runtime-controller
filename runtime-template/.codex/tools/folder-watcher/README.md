# Folder reconciliation watcher

`watcher.cjs` exports `watchFolder(processor, onError, interval=2000)` for Node.
The processor supplies bounded, symlink-safe folder discovery and compares metadata/content;
the watcher serializes periodic and explicit refreshes. `close()` stops polling and drains
pending work. Errors reach the owner; the next tick retries. Timers do not keep Node alive.

Runtime Controller's document search service uses this bundled tool to refresh the selected
project's `.codex/runtime-controller/documents-index.json`. It shares Work Docs discovery
limits, includes headings and bounded excerpts, and only rewrites changed indexes. Polling
covers new directories, edits and deletions without platform-specific recursive watch APIs.
The service is lazy-started on first document listing/search and closed on project switching.
