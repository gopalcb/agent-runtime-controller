# Architecture

See [system architecture](README.md#system-architecture) for the application and installation diagrams, [component boundaries](docs/architecture.md), and [Python installer architecture](installer/ARCHITECTURE.md).

The reviewed template exporter (`scripts/export-runtime-template.py`) maintains a fixed allowlist and SHA-256 manifest; it never recursively copies account data from a live Codex home. The portable memory tool has its own [architecture](runtime-template/.codex/tools/project_memory/ARCHITECTURE.md).
