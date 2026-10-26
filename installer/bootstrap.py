"""Start the install UI before asking its authenticated API to run the installer."""

import argparse
import json
import os
import sys
from urllib.error import URLError
import webbrowser

from installer.ensure import ensure_controller, request_json


def bootstrap_install(project: str, port: int = 10101, open_browser: bool = True) -> dict:
    """Ensure the UI, then submit installation without waiting on its worker lock."""
    result = ensure_controller(project, port)
    if open_browser:
        webbrowser.open(result["url"])
    if not result["active"]:
        result["message"] = "Project registered. Select it in the controller to install; the active project was preserved."
        return result
    bootstrap = request_json(port, "/bootstrap")
    installation = bootstrap.get("installation", {})
    status = installation.get("status", "not-installed")
    if status in ("not-installed", "failed"):
        result["installation"] = request_json(port, "/install", {"action": "retry" if status == "failed" else "install"}, bootstrap)
    else:
        result["message"] = f"Installation is {status}; view progress in the controller."
    return result


def main() -> int:
    """Run the npm lifecycle bridge with an explicit project destination."""
    parser = argparse.ArgumentParser(description="Open Runtime Controller installation")
    parser.add_argument("--project", required=True)
    parser.add_argument("--port", type=int, default=10101)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    if os.environ.get("RUNTIME_CONTROLLER_CHILD") == "1":
        return 0
    try:
        print(json.dumps(bootstrap_install(args.project, args.port, not args.no_open)), flush=True)
        return 0
    except (OSError, ValueError, RuntimeError, URLError) as error:
        print(f"Runtime Controller setup: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
