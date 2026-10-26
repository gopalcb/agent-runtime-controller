# Python installer architecture

This dependency-free Python 3.10+ package owns installation and controller startup on macOS/Linux. It does not install Python or npm dependencies, change global profiles, copy authentication, or modify Codex native generated memory. Windows locking and privilege handling are not implemented.

## Entry points

Run from the installed package root:

```sh
python3 -m installer.bootstrap --project /absolute/project
python3 -m installer --project /absolute/project --action install
python3 -m installer.ensure --project /absolute/project --port 10101 --no-open
```

`bootstrap` ensures a ready controller and opens `/controller/install` before submitting an authenticated installation request. The controller starts a separate installer worker, avoiding a nested installer-lock wait. A different active project is registered but never silently switched or installed. The UI project selector completes that explicit transition. The Node lifecycle bridge distinguishes consumer installation from explicit source setup.

`install` is idempotent after completion. `reinstall` and `reset` require completed state. `retry` accepts failed or interrupted installing state; a failed reset retries the reset. Reset affects managed installation assets only, preserving all memory, work, and unrelated state. Runtime and browser checks are skipped during reset.

## Modules and flow

- `validation.py`: project canonicalization, manifest/ownership restrictions, action and port validation.
- `storage.py`: descriptor-relative operations with `O_NOFOLLOW`, regular-file checks, atomic state writes and kernel file locks. Locks remain as harmless files; the kernel releases ownership on exit/crash. The startup lock spans package copies using a private per-user temporary directory and port.
- `lifecycle.py`: template hash verification, runtime checks, file reconciliation, project skill/instruction bridges, memory scaffolding, ownership receipts, and progress snapshots.
- `runtime.py`: checks Node 22.13+, built backend/frontend, installed dependencies, and Chromium. Missing Chromium is downloaded through the already-installed Playwright CLI with a 600-second timeout. `RUNTIME_CONTROLLER_SKIP_BROWSER_INSTALL=1` explicitly reports the browser step as skipped; it does not prove browser readiness. Codex authentication remains manual/inherited.
- `ensure.py`: HTTP identity handshake, serialized detached Node startup with private logs, 30-second readiness deadline, and authenticated project registration. It bypasses inherited HTTP proxies for loopback requests. A wrong service/version on the requested port fails instead of being reused. Startup failures terminate only the process started by that invocation.
- `bootstrap.py`: open install UI and submit a worker through authenticated HTTP.
- `wrapper.py`: standalone installed `.codex/runtime-controller/codex.py` entry point. It reads the generated package-location receipt, ensures the controller, and `exec`s the real Codex CLI with original arguments and auth environment. It preserves `CODEX_HOME`, adds `RUNTIME_CONTROLLER_CODEX_HOME` pointing to the project's `.codex`, and marks `RUNTIME_CONTROLLER_CHILD=1` to prevent recursive startup. A moved/uninstalled npm package requires reinstalling the wrapper receipt.
- `host_setup.py`: explicit administrator action for the requested local origin; no automatic host changes, privileged daemon, or persistent privileged user-writable code.

## Template and state contracts

`runtime-template/manifest.json` contains `{version, files: [{path, sha256, ...}]}`; paths are relative to `runtime-template/.codex`. A bare list is also accepted. Every payload is hash-checked before deployment. Credentials/configuration/native memory/session entries and installer metadata are forbidden in the template.

The installer writes `<project>/.codex/runtime-controller/install.json` and emits matching NDJSON snapshots. State includes `status`, `progress`, `version`, `action`, `steps`, optional `error`, and conflict records. `ownerPid` exists only while installing. Step IDs are `validate`, `runtime`, `browser`, `files`, and `complete`; statuses include `pending`, `running`, `completed`, `failed`, and explicit `skipped`. The backend can distinguish interrupted workers and offer retry.

`managed.json` records `files` hashes relative to `.codex` and `bridges` hashes relative to the project. Only matching owned files may be replaced or removed. Existing identical unowned files remain unowned. Edited files survive and receive an incoming copy under `.codex/runtime-controller/conflicts/`. Conflict records are visible in installer state; completion with conflicts means deployment finished with preserved user overrides, not that every offered file was adopted. Ownership is persisted after each mutation so partial failures can retry conservatively. A process crash between a file write and its receipt update may leave an unowned file; it is deliberately preserved rather than guessed safe to delete.

The generated `launcher.json` stores package location, project, version, and controller port. The worker receives the port through `RUNTIME_CONTROLLER_PORT` (default 10101); the wrapper forwards the recorded port to `ensure`, including for custom-port installations. The wrapper starts Codex in its installed project root, so calling the wrapper by absolute path from another directory does not accidentally operate on that directory. Explicit Codex directory arguments are forwarded unchanged.

The installer adds a root `AGENTS.md` bridge only when absent and copies skills to `.agents/skills` for project discovery, tracking their ownership. Existing root instructions/skill files are preserved; incoming copies and manual-integration guidance are reported. Portable role TOMLs are provided as opt-in assets, not claimed as registered native subagents. No native SessionStart hook is fabricated: use the explicit wrapper:

```sh
python3 /absolute/project/.codex/runtime-controller/codex.py [codex arguments]
```

The memory scaffold under `.codex/runtime-controller/memory/{README.md,index.md,notes/}` is plugin-owned durable guidance. Existing scaffold files and notes are never replaced or deleted by reinstall/reset. It is unrelated to native generated Codex memory.

## Controller API contract

`GET /api/identity` returns `service: runtime-controller`, `version: 0.2.0`, `pid`, and `project: {id,name,root}`. `GET /api/bootstrap` returns `token`, `project`, and `installation`. Mutations send `X-Builder-Token` and `X-Project-Id`. `POST /api/projects/register {path}` registers without activation. `POST /api/install {action}` starts the asynchronous worker.

## Requested local origin

First start the controller normally on port 10101. Then, only when explicitly choosing administrator setup:

```sh
sudo python3 -m installer.host_setup
```

The helper verifies controller identity, adds `127.0.0.1 localhost.runtime-controller` to `/etc/hosts` with a timestamped backup, binds loopback port 1001, clears supplementary groups, sets the invoking user's GID/UID, and only then starts listening. The foreground unprivileged proxy forwards to loopback 10101; Ctrl-C stops it. It installs no launch daemon. `--hosts-only` adds only the hostname and leaves port forwarding unresolved. The fallback remains `http://127.0.0.1:10101/controller/install`.

The helper is not automatically invoked during install. Administrator execution, DNS resolution, and port forwarding must be verified on the target machine; mocked privilege-ordering tests do not establish host setup success.

## Verification

`python3 -m unittest discover -s tests -p test_installer.py -v` covers ownership/reset/conflicts, integrity failure/retry, interrupted work, project locks, symlink/traversal boundaries, native discovery bridges, wrapper auth/argument forwarding, concurrent HTTP readiness, one real Node fixture cold start, startup failure cleanup, and privilege-drop ordering. Fixture processes and servers are closed in cleanup paths. Package/browser readiness and full-template install/reset are separate integration checks.
