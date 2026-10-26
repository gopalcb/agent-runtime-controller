"""Run the real Codex CLI after ensuring the controller, preserving auth and arguments.

The installer copies this standalone wrapper beside its generated launcher.json.
No native SessionStart hook or global shell-profile modification is assumed.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    """Ensure the project controller, then replace this process with the Codex CLI."""
    location = Path(__file__).resolve().parent
    executable = shutil.which("codex")
    if not executable:
        print("Codex CLI is not on PATH; install and authenticate it before using this wrapper", file=sys.stderr)
        return 1
    if Path(executable).resolve() == Path(__file__).resolve():
        print("Codex wrapper resolves to itself; restore the real Codex CLI on PATH", file=sys.stderr)
        return 1
    if os.environ.get("RUNTIME_CONTROLLER_CHILD") != "1":
        try:
            receipt = json.loads((location / "launcher.json").read_text())
            package = Path(receipt["packageRoot"])
            port = int(receipt.get("port", 10101))
            if not 1024 <= port <= 65535:
                raise ValueError("Invalid controller port in launcher receipt")
            project = location.parent.parent
            if not (package / "installer" / "ensure.py").is_file():
                raise ValueError("Controller package moved or was removed; reinstall it to update the project wrapper")
            result = subprocess.run([sys.executable, "-m", "installer.ensure", "--project", str(project), "--port", str(port), "--no-open"],
                                    cwd=package, stdout=sys.stderr, check=False)
            if result.returncode:
                return result.returncode
        except (OSError, ValueError, KeyError) as error:
            print(f"Runtime Controller wrapper: {error}", file=sys.stderr)
            return 1
    environment = dict(os.environ)
    environment["RUNTIME_CONTROLLER_CHILD"] = "1"
    environment["RUNTIME_CONTROLLER_CODEX_HOME"] = str(location.parent)
    os.chdir(location.parent.parent)
    os.execvpe(executable, [executable, *sys.argv[1:]], environment)
    return 1


if __name__ == "__main__":
    sys.exit(main())
