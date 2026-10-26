# RUNTIME CONTROLLER

[System architecture](#system-architecture) · [Installation](#installation)

Runtime Controller turns visual feedback into work that a coding agent can act on. Draw a layout or point to an element in your local app, describe what should change, and choose which items Codex should implement. The controller keeps the instructions, execution history and settings with the project.

It is an npm development package with an Angular interface, a NestJS API and a Python installer. It runs on your machine and connects to your installed Codex CLI.

## System architecture

```mermaid
flowchart LR
  User[Developer] --> UI[Angular controller UI]
  UI --> API[NestJS loopback API]
  API --> Projects[Selected project context]
  Projects --> Store[Work items, runs and settings]
  Projects --> Browser[Playwright drawing or element selection]
  Browser --> Store
  Projects --> Codex[Codex app-server over stdio]
  Codex --> Files[Selected project files]
  Codex --> Store
  API --> Installer[Python installation worker]
  Installer --> Template[Portable runtime template]
  Template --> Runtime[Project .codex and .agents skills]
  Runtime --> Memory[Project-owned memory notes]
```

### From a visual idea to a code change

1. **Capture the change.** Open a blank canvas to describe a new layout, or open a local URL to select an existing element. Save a description alongside the rectangle or element reference.
2. **Choose the work.** Review the saved items, select the ones to implement and confirm execution. The backend takes a snapshot so later edits cannot change a run's original inputs.
3. **Run Codex in the project.** The NestJS API hands the work to a TypeScript runtime. It starts a local Codex app-server, creates a thread with the project's working directory, and submits the saved instructions as a turn.
4. **Review the result.** The runtime records agent messages, status and reported token usage. Angular polls the local API every two seconds. A finished agent turn marks its items complete; review the changed files and checks before accepting the work.

The browser talks to the local API, not directly to a model endpoint. The Codex adapter uses Node's child-process and readline APIs to exchange newline-delimited JSON-RPC with `codex app-server`. There is no separate agent SDK in this implementation.

One controller has one active project at a time. Switching in Settings loads that project's records and closes capture browsers from the previous project. Switching is blocked during execution or installation. Project IDs and a rotating mutation token prevent an old browser tab from writing to a newly selected project.

### What each part does

| Part | Implementation | Responsibility |
| --- | --- | --- |
| Controller UI | Angular, TypeScript, RxJS | Capture forms, work selection, installation progress and run views |
| Local API | NestJS on Express | Validate requests and route them to the active project |
| Agent runtime | TypeScript and Node child processes | Freeze work inputs, start Codex, process notices and handle cancellation |
| Visual capture | Playwright | Open an owned browser for rectangle drawing or local element selection |
| Installation | Python standard library | Check prerequisites, copy the runtime template and track file ownership |
| Work Docs | Markdown formatter, Mermaid and DOMPurify | Read project documents and render diagrams locally |
| Icons | Bootstrap Icons | Locally bundled interface icons |

### Your project after installation

This is a representative layout after installing the package and starting the controller. Existing application folders remain in place. Runtime state and lock files appear as needed; names ending in `/` are directories.

```text
your-project/
├── src/                              Your existing application
├── package.json                      Development dependency and package settings
├── AGENTS.md                         Bridge added only when this file is absent
├── node_modules/@gb-systems/
│   └── visual-agent-builder/         Installed package; CLI name: runtime-controller
│       ├── bin/                      npm lifecycle and command entry points
│       ├── dist/                     Compiled NestJS API and TypeScript runtime
│       ├── frontend/dist/            Compiled Angular UI
│       ├── installer/                Python setup and launcher modules
│       └── runtime-template/         Reviewed, portable runtime files
├── .agents/skills/                   Discoverable copies of packaged skills
└── .codex/
    ├── AGENTS.md                     Project runtime guidance
    ├── agents/                       Optional role definitions
    ├── skills/                       Planning, implementation and testing guidance
    ├── workflows/                    Development, checkpoint and memory procedures
    ├── references/                   Supporting task-record conventions
    ├── assets/templates/            Project configuration template
    ├── tools/                       Logging, UI verification and memory utilities
    ├── visual-builder/
    │   ├── AGENTS.md                 Instructions for controller-owned runs
    │   ├── state.json                Work items, runs, settings and activity
    │   └── owner.lock                Present while a process owns this project
    └── runtime-controller/
        ├── install.json              Installation steps and current status
        ├── managed.json              Hashes of installer-owned files
        ├── launcher.json             Package location and controller port
        ├── codex.py                  Explicit controller-aware Codex launcher
        ├── projects.json             Registry in the controller's initial project
        ├── conflicts/                Incoming files when local edits must be kept
        └── memory/                   Project-owned notes, index and usage guide
```

The package contains the executable application; the project's `.codex` folder contains guidance and local records. This separation lets the same controller work with different projects without mixing their work history.

The installer checks file hashes before replacing anything it owns. Existing instructions and user edits are preserved, with incoming versions offered as conflicts. It does not copy native Codex credentials, private memory or sessions. Project memory is an explicit notes tool: it does not automatically remember every conversation. See [template contents](runtime-template/README.md) and [installer details](installer/ARCHITECTURE.md).

### Find your way around

| Page | Route | Purpose |
| --- | --- | --- |
| Agent Runtime | `/controller/agent-runtime` | Pending work, capture and execution |
| Work Docs | `/controller/work-docs` | Search and read project Markdown plans and documentation |
| Run History | `/controller/history` | Completed work items and agent runs |
| Settings | `/controller/settings` | Selected-project execution settings |
| Observability | `/controller/observability` | Health, logs and recorded token usage |
| Installation | `/controller/install` | Progress, retry, reinstall and reset |
| Drawing canvas | `/controller/canvas` | Rectangle instructions |

Use **Settings** to select a project or open its runtime setup. **Work Docs** reads project Markdown with normal page scrolling and expandable Mermaid diagram source.

**Add interactive work items** opens a choice between a blank drawing canvas and an existing local URL. Draw a rectangle or highlight an element, describe the change, and save. Select pending items and confirm execution. Completed items move to Run History; unresolved work remains visible separately. A completed Codex turn is not a guarantee that its code is correct: review the output and validation.


For a standalone explanation with code excerpts and a demo placeholder, open the [portfolio article](docs/portfolio/runtime-controller.html) in a browser.

## Installation

### Requirements

- macOS or Linux; Python **3.11+**, Node **22.13+** and npm.
- An installed and authenticated `codex` CLI for execution. Installation can finish without authentication; **CLI available** only reports executable availability.
- A desktop session for visible capture browsers. The installer checks Chromium and downloads it through Playwright when missing; first setup may need internet access.
- Windows is not supported by the Python installer in this release.

### Quick installation prompt

Open your target project in your coding agent and paste this prompt. GitHub access
to this repository and the requirements above are needed. The package is installed
from a locally built archive; it is not yet published to npm.

```text
Install Runtime Controller into the project currently open in this workspace.
Record its absolute path before changing directories. Clone
https://github.com/gopalcb/agent-runtime-controller.git from main into a separate
sibling folder, or reuse a clean checkout without overwriting local changes.
Read its README installation instructions and verify Node 22.13+, Python 3.11+
and npm. In the controller checkout, run npm ci, npm --prefix frontend ci,
and npm pack to build the installable archive.

In the original target project, preserve existing package settings and overrides,
add overrides.multer=2.5.0 (report any conflicting override), and install the
generated .tgz with npm install --save-dev using its absolute path. Preserve
existing .codex files, credentials and memory. Let the Python installer complete
project setup; if lifecycle scripts are disabled, run
npx runtime-controller setup --project "<absolute target project path>".

Open http://127.0.0.1:10101/controller/install, ensure the intended project is
selected, and verify Installation complete before reporting success. If another
project is already active, use Settings to select the target before setup.
Report the controller URL and any blockers. Do not start an agent work item.
```

### Clone, build and run

```bash
git clone https://github.com/gopalcb/agent-runtime-controller.git
cd agent-runtime-controller
npm ci
npm --prefix frontend ci
npm run build
npm run setup -- --project "$PWD"
```

The source checkout's npm lifecycle prints setup instructions rather than launching an unbuilt app. `setup` starts the controller, opens `/controller/install`, and submits installation. The page shows actual step status and progress. The unprivileged default is **http://127.0.0.1:10101/controller/install**. For a different port:

```bash
npm run setup -- --project /absolute/path/to/project --port 10102
```

### Install the plugin in another project

Build a distributable from this checkout:

```bash
npm pack
```

Then run from the target project's directory:

```bash
npm pkg set "overrides.multer=2.5.0"
npm install --save-dev /absolute/path/to/gb-systems-visual-agent-builder-0.2.0.tgz
```

The explicit override is currently necessary because NestJS pins an older Multer version and npm does not inherit a dependency package's overrides. Preserve any other existing overrides. Version 2.5.0 fixes the [upstream Multer advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).

The npm postinstall starts the Python bootstrap against the installation directory. It starts or finds the controller, opens the installation page, and begins setup for that active project. If a different project is already active, it registers the new folder without switching it: select the new folder in the controller to install. Installation runs asynchronously; wait for **Installation complete** before executing work.

If your package manager disables lifecycle scripts, or setup reports a prerequisite error, run:

```bash
npx runtime-controller setup --project "$PWD"
```

For unattended installation set `RUNTIME_CONTROLLER_NO_OPEN=1`; set `RUNTIME_CONTROLLER_PORT` to choose the lifecycle bootstrap port. `RUNTIME_CONTROLLER_SKIP_SETUP=1` deliberately skips automatic setup. These flags do not mark an unfinished installation complete.

```mermaid
sequenceDiagram
  participant N as npm install
  participant P as Python bootstrap
  participant C as Controller
  participant W as Installer worker
  N->>P: Target project
  P->>C: Ensure ready, or start on loopback
  P->>C: Open installation page
  P->>C: Authenticated installation request
  C->>W: Validate and install
  loop Installation steps
    W->>W: Check runtime, browser, template and bridges
    C->>W: Read persisted progress
    C-->>P: UI displays progress
  end
  W->>C: Completed receipt
  C->>C: Enable execution and reset/reinstall
```

### Optional local hostname

The default setup URL is **http://127.0.0.1:10101/controller/install**. To use **http://localhost.runtime-controller:1001**, the hostname must resolve to loopback and port 1001 must be available. Systems that restrict low-numbered ports need an administrator-managed forwarder. The helper keeps the controller unprivileged on port 10101:

```bash
# First start setup/controller on 10101 as your normal user.
# From the cloned Runtime Controller repository, in a separate terminal:
sudo python3 -m installer.host_setup
```

For an installed npm plugin, run the helper from `node_modules/@gb-systems/visual-agent-builder`. It checks the running controller, adds the exact loopback alias to `/etc/hosts` with a backup, binds port 1001, then drops privileges before accepting connections. Keep the helper running in that terminal. It is not a persistent system service; stopping it stops forwarding. Never run the Node controller or Codex as root.

The resulting address is **http://localhost.runtime-controller:1001/controller/agent-runtime**. Without administrator setup, use **http://127.0.0.1:10101**. A plain `npm start` tries 1001 and falls back to 10101 on permission failure; an explicit `--port 1001` reports failure instead of silently changing ports.

### Start the controller when starting Codex

After setup, launch Codex through the installed project entry point:

```bash
python3 /absolute/path/to/project/.codex/runtime-controller/codex.py
```

This checks controller identity and readiness, starts it only when needed, then launches Codex in that project and forwards CLI arguments. It preserves the existing native `CODEX_HOME` and authentication environment. Portable project tools use `RUNTIME_CONTROLLER_CODEX_HOME` instead. An already-active different project is registered, never silently switched.

This is an explicit project launcher, not an automatically registered IDE/native Codex startup hook. Direct `codex` or IDE launches do not invoke it. Use this wrapper in your terminal/project launch configuration. The privileged port-forward helper must still be running if you want port 1001.

### Existing files, memory and maintenance

Installation creates `.codex` runtime files and discoverable `.agents/skills` copies. An existing root `AGENTS.md` is preserved; when installation reports a bridge conflict, add a reference to the project's `.codex/AGENTS.md` manually. Role definitions are portable templates, not a promise that a Codex client auto-registers them or supports every model.

After successful installation, **Reinstall** updates unchanged managed files and preserves user edits as conflicts for review. **Reset managed runtime** removes only unchanged managed files; work items, history, settings, user-edited files and memory remain. Retry is available after failure. Interrupted installs are reported instead of being treated as successful. Review conflict details under `.codex/runtime-controller/conflicts/`.

Memory is explicit, project-owned retention rather than a copy of private native Codex memory:

```bash
python3 .codex/tools/project_memory/memory.py --project "$PWD" add 'Run npm test before submitting changes.'
python3 .codex/tools/project_memory/memory.py --project "$PWD" search "npm test"
python3 .codex/tools/project_memory/memory.py --project "$PWD" list
```

Only add information the user asked to retain; do not store secrets. The CLI stores notes atomically under `.codex/runtime-controller/memory/` and does not alter native memory databases. See [memory tool usage](runtime-template/.codex/tools/project_memory/README.md).

## Local boundaries

This is a trusted local development tool, not a hosted multi-user service. The API binds loopback, checks Host/Origin, and requires a rotating token for mutations. Defaults are workspace-write, network disabled for commands and approval policy `never`. Settings can grant broader access; full access can modify files outside the project. Command/file approvals supported by the adapter appear in the UI; unsupported interaction requests are rejected. Authentication remains environment-owned. The adapter disables inherited MCP/plugin/browser/hook integrations for controller-owned agent execution and verifies effective settings before starting a thread.

Capture browsers use separate profiles, do not import browser logins, allow only local URLs and same-origin navigation, and omit form values and URL query/hash from captured evidence. Ordinary visible page text is included. Closed shadow roots and cross-origin frames cannot be selected. Close capture windows when finished; server shutdown and project switching close its owned browsers. Test automation uses `finally` cleanup and must preserve regular user browsers.

One process owns a project at a time. Interrupted runs are not replayed automatically. If a crash leaves `.codex/visual-builder/owner.lock`, verify the recorded process is dead before removing that project's lock. Cancellation does not undo partial code edits.

Recorded tokens persist per run/thread and deduplicate cumulative reports. Missing reports show **Unreported**; totals are recorded plugin usage, not account billing.

## Development and release checks

Backend source uses consistent formatting and separated workflow steps. Run `npm run format:backend` to format it and `npm run format:backend:check` to verify it. See [backend responsibilities](docs/architecture.md) before structural changes.

```bash
npm test
npm run test:installer
npm run build
npm run test:ui
python3 scripts/export-runtime-template.py --check
npm audit --omit=dev
npm --prefix frontend audit
npm pack --dry-run
```

Backend tests use disposable projects, real installer workers and synthetic Codex transports. Browser checks cover desktop/mobile layouts, drawing, history, settings, URL validation and real installation/project switching. They do not prove a real model turn or native Computer Use stability. Production builds use locally bundled [Bootstrap Icons](https://icons.getbootstrap.com/); no icon CDN is needed.

For frontend development, start the API explicitly on port 4310 (`npm start -- --port 4310 --no-open`) and run `npm --prefix frontend start` on 4311. Production serves Angular assets from NestJS.

The Git ignore file excludes dependencies, build output, archives, local `.codex`/`.agents` state, secrets and test artifacts. The portable `runtime-template/.codex` is intentionally tracked. Inspect staged files before the first commit. This repository is marked **UNLICENSED**; choose distribution terms before publishing. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Work Docs lists Markdown at the project root and under `docs/`, `plans/`, `.codex/tasks/`, and `.codex/plans/`, newest first. Refresh to discover files created during a run. Files have no agent-author attribution. The reader formats common Markdown and treats embedded HTML as text. Fenced `mermaid` diagrams render locally with an expandable source view. Invalid diagrams, HTML labels, and diagrams over 50,000 characters retain their source with an error message. Discovery excludes symlinks, dependency folders and other hidden directories, caps traversal at 5,000 entries/depth 8 and the list at 500 documents; files over 512 KiB are excluded.

Active execution appears above Work Items in a fixed-height terminal. New output arrives at the bottom and auto-scrolls; pause auto-scroll to read earlier output. Finished output remains in Run History. Project selection and runtime setup are available only in Settings.
