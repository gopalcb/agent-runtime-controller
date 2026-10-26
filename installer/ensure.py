"""Ensure a loopback controller by identity and readiness, without switching projects."""

import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
import webbrowser

from installer import VERSION
from installer.storage import SafeRoot
from installer.validation import validate_port, validate_project

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def request_json(port: int, path: str, payload: dict | None = None, bootstrap: dict | None = None) -> dict:
    """Make a direct loopback request, bypassing inherited network proxy settings."""
    headers = {"Content-Type": "application/json"}
    if bootstrap:
        headers["X-Builder-Token"] = bootstrap["token"]
        headers["X-Project-Id"] = bootstrap["project"]["id"]
    request = Request(f"http://127.0.0.1:{port}/api{path}",
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers)
    with build_opener(ProxyHandler({})).open(request, timeout=2) as response:
        result = json.load(response)
    if not isinstance(result, dict):
        raise RuntimeError("Controller returned an invalid response")
    return result


def get_identity(port: int) -> dict | None:
    """Distinguish unavailable service from a listener with the wrong identity."""
    try:
        identity = request_json(port, "/identity")
    except HTTPError as error:
        raise RuntimeError(f"Port {port} belongs to a service without a controller identity") from error
    except (URLError, TimeoutError, ConnectionError):
        return None
    if identity.get("service") != "runtime-controller" or identity.get("version") != VERSION:
        raise RuntimeError(f"Port {port} is occupied by an incompatible service; choose another port")
    project = identity.get("project")
    if not isinstance(project, dict) or not isinstance(project.get("root"), str):
        raise RuntimeError("Controller identity has no valid project")
    return identity


def startup_directory() -> Path:
    """Create a private per-user lock and log directory shared across package copies."""
    directory = Path(tempfile.gettempdir()) / f"runtime-controller-{os.getuid()}"
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError(f"Startup directory must be an owned private directory: {directory}")
    return directory


def ensure_controller(project_path: str, port: int = 10101, timeout: float = 30) -> dict:
    """Serialize startup, wait for HTTP identity, and register without activating a project."""
    project = validate_project(project_path)
    validate_port(port)
    directory = startup_directory()
    root = SafeRoot(directory)
    child = None
    try:
        with root.lock(f"startup-{port}.lock", True):
            identity = get_identity(port)
            if identity is None:
                if os.geteuid() == 0:
                    raise RuntimeError("Refusing to run the controller as root; run setup as your normal user")
                node = shutil.which("node")
                if not node:
                    raise RuntimeError("Node.js is required; install Node.js 22.13 or newer")
                entry = PACKAGE_ROOT / "bin" / "visual-agent-builder.cjs"
                if not entry.is_file():
                    raise RuntimeError("Controller package is missing its Node entry point")
                with root.parent(f"controller-{port}.log") as (parent, name):
                    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                with os.fdopen(descriptor, "ab") as log:
                    child = subprocess.Popen([node, str(entry), "--project", str(project), "--port", str(port), "--no-open"],
                                             cwd=PACKAGE_ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                             start_new_session=True, close_fds=True)
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    identity = get_identity(port)
                    if identity is not None:
                        break
                    if child.poll() is not None:
                        raise RuntimeError(f"Controller exited before readiness; inspect {directory / name}")
                    time.sleep(0.1)
                if identity is None:
                    raise RuntimeError(f"Controller readiness timed out; inspect {directory / name}")
            same_project = Path(identity["project"]["root"]).resolve() == project
            if not same_project:
                bootstrap = request_json(port, "/bootstrap")
                request_json(port, "/projects/register", {"path": str(project)}, bootstrap)
            return {"identity": identity, "project": str(project), "active": same_project,
                    "url": f"http://127.0.0.1:{port}/controller/install"}
    except Exception:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        raise
    finally:
        root.close()


def main() -> int:
    """Ensure readiness and optionally open the controller install page."""
    parser = argparse.ArgumentParser(description="Ensure a project-local Runtime Controller")
    parser.add_argument("--project", required=True)
    parser.add_argument("--port", type=int, default=10101)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    if os.environ.get("RUNTIME_CONTROLLER_CHILD") == "1":
        return 0
    try:
        result = ensure_controller(args.project, args.port)
        print(json.dumps(result), flush=True)
        if not args.no_open:
            webbrowser.open(result["url"])
        return 0
    except (OSError, ValueError, RuntimeError, URLError) as error:
        print(f"Runtime Controller: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
