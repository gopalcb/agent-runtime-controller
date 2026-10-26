# Runtime Controller development

Read README.md and docs/architecture.md before structural changes. If project setup
has installed .codex/AGENTS.md, also read that project's runtime guidance. Native
CODEX_HOME authentication remains environment-owned; project runtime procedures use
RUNTIME_CONTROLLER_CODEX_HOME when launched through the installed Codex wrapper.

Keep frontend Angular, API NestJS, and installer Python responsibilities distinct.
Preserve project state and user files. Installer changes require filesystem safety,
conflict, reset, and repeat-install tests. Project switching must reject stale
mutations and keep each project's settings, work and memory isolated.

Use temporary projects and synthetic dispatch for tests. Never run a real coding
agent against a user's workspace merely to verify the interface. Close all owned
controlled browsers and fixture servers after UI tests, including blocked runs.
Never close regular user browser sessions. Report native and supplemental evidence
separately and never call unexecuted checks passed.

Run npm test, npm run test:installer, npm run build and npm run test:ui as relevant.
Validate portable template changes with python3 scripts/export-runtime-template.py
--check. Keep native credentials, session history, private memories and local paths
out of Git and package artifacts. No commits or pushes unless requested.
