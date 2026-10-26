"""Expose the installer lifecycle as a dependency-free NDJSON command line."""

import argparse
import json
import subprocess
import sys

from installer.lifecycle import run_install


def main() -> int:
    """Parse one installation action and report failures without a traceback."""
    parser = argparse.ArgumentParser(description="Install project-local Runtime Controller files")
    parser.add_argument("--project", required=True)
    parser.add_argument("--action", choices=("install", "retry", "reinstall", "reset"), default="install")
    args = parser.parse_args()
    try:
        run_install(args.project, args.action)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"event": "error", "error": str(error)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
