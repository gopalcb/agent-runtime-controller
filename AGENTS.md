# Runtime Controller development

## Project identity and quick start

This project is Runtime Controller; the local folder may be named
`visual-agent-builder` and the npm package is `@gb-systems/visual-agent-builder`.
Its canonical GitHub repository is
`https://github.com/gopalcb/agent-runtime-controller`, with default branch `main`.
Do not confuse it with the older `custom-workflow-runtime-codex` publication or
other sibling checkouts. Verify `git remote -v`, `git status --short --branch`,
and the working directory before editing or publishing.

Start with `docs/architecture.md` for source responsibilities and `package.json`
for current commands. Frontend code is under `frontend/src/`, API code under
`backend/`, installation code under `installer/`, and portable setup files under
`runtime-template/`. Existing checks are under `tests/`.

For an existing installation, build with `npm run build`; run the controller with
`npm start -- --project "$PWD" --port 10101 --no-open`. Check the current port owner
and checkout before starting another server or testing a running instance.
Build before the full test suite, since HTTP tests need compiled frontend assets.
Use README installation steps when dependencies or project setup are missing.

## Development boundaries

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

After application changes, rebuild and restart the local controller serving
http://localhost.runtime-controller:10101/ before reporting completion. Verify
that the URL responds and serves the updated build; source edits alone are not
enough because start:local does not rebuild or hot-reload. Check for active runs
or installation work before restarting, preserve project state, and use graceful
shutdown. If active work prevents a safe restart, report the pending restart
explicitly rather than claiming the changes are live. Documentation-only changes
do not require a restart.

When starting or restarting, inspect `.codex/visual-builder/owner.lock` and verify
the recorded PID's identity, project and listening port. Only one controller may
own a project. If the existing controller is running, reuse it or, when a restart
is needed and no work is active, gracefully stop that specific process. Wait for
it to exit and release its lock and port before starting the replacement. Never
delete a live process's lock or kill unrelated processes. If a stale lock remains,
confirm its recorded process is dead and no controller owns the project before
removing only that stale `owner.lock`. Preserve `state.json` and all user files.
If ownership cannot be established or graceful shutdown fails, report the blocker
rather than forcing a restart or removing the lock.
