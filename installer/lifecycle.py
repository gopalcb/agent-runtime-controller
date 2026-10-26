"""Apply and reset hash-owned template files, recording atomic observable progress."""

import hashlib
import json
import os
from pathlib import Path

from installer import VERSION
from installer.storage import SafeRoot
from installer.runtime import check_runtime, ensure_browser
from installer.validation import load_manifest, validate_action, validate_port, validate_project, validate_receipt, validate_relative

STATE = ".codex/runtime-controller/install.json"
MANAGED = ".codex/runtime-controller/managed.json"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def emit_state(root: SafeRoot, state: dict) -> None:
    """Persist state before emitting a newline-delimited progress snapshot."""
    root.write_json(STATE, state)
    print(json.dumps(state), flush=True)


def load_payload(template: Path, project: Path) -> dict:
    """Verify all template hashes and add the generated package-location receipt."""
    entries = load_manifest(template)
    source = SafeRoot(template / ".codex")
    payload = {}
    try:
        for entry in entries:
            content = source.read(entry["path"])
            if content is None or hashlib.sha256(content).hexdigest() != entry["sha256"]:
                raise ValueError(f"Template integrity mismatch: {entry['path']}")
            payload[entry["path"]] = content
    finally:
        source.close()
    payload["runtime-controller/codex.py"] = (PACKAGE_ROOT / "installer" / "wrapper.py").read_bytes()
    payload["runtime-controller/launcher.json"] = (json.dumps({
        "packageRoot": str(PACKAGE_ROOT), "project": str(project), "version": VERSION,
        "port": validate_port(int(os.environ.get("RUNTIME_CONTROLLER_PORT", "10101"))),
    }, indent=2) + "\n").encode()
    payload["runtime-controller/memory/README.md"] = (
        "# Runtime Controller project notes\n\n"
        "Store explicit, reviewed project guidance in `notes/` and link it from `index.md`.\n"
        "This is plugin-owned memory, not Codex native generated memory. Installation and reset preserve existing notes.\n"
    ).encode()
    payload["runtime-controller/memory/index.md"] = b"# Project note index\n\nAdd links to reviewed notes here.\n"
    payload["runtime-controller/memory/notes/.gitkeep"] = b""
    return payload


def reconcile_files(root: SafeRoot, payload: dict, receipt: dict, bridges: bool = False) -> list:
    """Replace only unchanged owned files, preserving conflicts and memory notes."""
    conflicts = []
    managed = receipt["bridges" if bridges else "files"]
    for path in sorted(set(managed) | set(payload)):
        validate_relative(path)
        destination = path if bridges else ".codex/" + path
        current = root.read(destination)
        current_hash = hashlib.sha256(current).hexdigest() if current is not None else None
        previous_hash = managed.get(path)
        content = payload.get(path)
        # The scaffold is durable user memory, including after a reset.
        if path.startswith("runtime-controller/memory/") and current is not None:
            continue
        if content is None:
            if current is not None and previous_hash == current_hash:
                root.remove(destination)
                del managed[path]
                root.write_json(MANAGED, receipt)
            elif current is None:
                managed.pop(path, None)
            else:
                conflicts.append({"path": path, "reason": "edited managed file preserved"})
            continue
        digest = hashlib.sha256(content).hexdigest()
        if current is None or previous_hash == current_hash:
            root.write(destination, content, 0o700 if path.endswith(".py") else 0o600)
            managed[path] = digest
            # Persist ownership after every file so an interrupted operation can retry safely.
            root.write_json(MANAGED, receipt)
        elif current_hash == digest and previous_hash:
            managed[path] = digest
        elif current_hash != digest:
            copy = f"runtime-controller/conflicts/{'project/' if bridges else ''}{path}.{digest[:12]}.incoming"
            existing_copy = root.read(".codex/" + copy)
            if existing_copy is None:
                root.write(".codex/" + copy, content)
            elif existing_copy != content:
                raise ValueError(f"Conflict copy was edited; preserve it and move it before retry: {copy}")
            conflicts.append({"path": path, "incoming": copy, "reason": "existing file preserved"})
    root.write_json(MANAGED, receipt)
    return conflicts


def build_bridges(root: SafeRoot, payload: dict) -> dict:
    """Expose portable instructions and skills through project discovery locations."""
    bridges = {"AGENTS.md": b"# Runtime Controller project instructions\n\nRead and follow `.codex/AGENTS.md` for this project's portable runtime guidance.\n"}
    for path in payload:
        if path.startswith("skills/"):
            content = root.read(".codex/" + path)
            if content is not None:
                bridges[".agents/" + path] = content
    return bridges


def run_install(project_path: str, action: str = "install", template: Path | None = None) -> dict:
    """Execute one locked lifecycle action and retain actionable failed state."""
    project = validate_project(project_path)
    root = SafeRoot(project)
    state = None
    try:
        with root.lock(".codex/runtime-controller/install.lock"):
            previous = root.read_json(STATE, {"status": "not-installed"})
            validate_action(action, previous.get("status", "not-installed"))
            if action == "retry" and previous.get("action") == "reset":
                action = "reset"
            if action == "install" and previous.get("status") == "completed":
                print(json.dumps(previous), flush=True)
                return previous
            state = {"status": "installing", "progress": 0, "version": VERSION, "ownerPid": os.getpid(), "action": action, "steps": [
                {"id": "validate", "label": "Validate template and project", "status": "running"},
                {"id": "runtime", "label": "Check packaged Node runtime", "status": "pending"},
                {"id": "browser", "label": "Ensure Playwright Chromium", "status": "pending"},
                {"id": "files", "label": "Reset managed files" if action == "reset" else "Install runtime files", "status": "pending"},
                {"id": "complete", "label": "Record installation", "status": "pending"},
            ]}
            try:
                emit_state(root, state)
                receipt = validate_receipt(root.read_json(MANAGED, {"version": VERSION, "files": {}, "bridges": {}}))
                payload = {} if action == "reset" else load_payload(template or PACKAGE_ROOT / "runtime-template", project)
                state["steps"][0]["status"] = "completed"
                state["progress"] = 10
                if action != "reset":
                    state["steps"][1]["status"] = "running"
                    emit_state(root, state)
                    state["runtime"] = check_runtime(PACKAGE_ROOT)
                    state["steps"][1]["status"] = "completed"
                    state["steps"][2]["status"] = "running"
                    state["progress"] = 20
                    emit_state(root, state)
                    state["steps"][2].update(ensure_browser(PACKAGE_ROOT))
                else:
                    state["steps"][1]["status"] = "skipped"
                    state["steps"][2]["status"] = "skipped"
                state["steps"][3]["status"] = "running"
                state["progress"] = 50
                emit_state(root, state)
                conflicts = reconcile_files(root, payload, receipt)
                bridges = {} if action == "reset" else build_bridges(root, payload)
                conflicts.extend(reconcile_files(root, bridges, receipt, True))
                state["conflicts"] = conflicts
                state["steps"][3]["status"] = "completed"
                message = f"{len(conflicts)} existing or edited files preserved" if conflicts else "Managed files updated"
                if action != "reset" and any(item["path"] == "AGENTS.md" for item in conflicts):
                    message += "; review incoming instructions and add a reference to .codex/AGENTS.md in root AGENTS.md if needed"
                state["steps"][3]["message"] = message
                state["steps"][4]["status"] = "running"
                state["progress"] = 90
                emit_state(root, state)
                state["steps"][4]["status"] = "completed"
                state["status"] = "not-installed" if action == "reset" else "completed"
                state.pop("ownerPid", None)
                state["progress"] = 0 if action == "reset" else 100
                emit_state(root, state)
                return state
            except Exception as error:
                state["status"] = "failed"
                state.pop("ownerPid", None)
                state["error"] = str(error)
                for step in state["steps"]:
                    if step["status"] == "running":
                        step["status"] = "failed"
                        step["message"] = str(error)
                emit_state(root, state)
                raise
    finally:
        root.close()
