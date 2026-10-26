"""Verify packaged Node assets and provision only the browser required by the controller."""

import json
import os
from pathlib import Path
import shutil
import subprocess


def check_runtime(package: Path) -> dict:
    """Require a built package and installed Node dependencies without bootstrapping them."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 22.13 or newer is required")
    for relative in ("dist/main.js", "frontend/dist/browser/index.html"):
        if not (package / relative).is_file():
            raise RuntimeError(f"Missing package asset {relative}; source checkouts must run npm install and npm run build")
    script = "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<13))throw Error('Node.js 22.13+ required');for(const m of ['@nestjs/core','express','playwright'])require.resolve(m);console.log(JSON.stringify({node:process.versions.node}));"
    result = subprocess.run([node, "-e", script], cwd=package, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Node runtime/dependency check failed; use npm install in a source checkout or reinstall the npm package: " + result.stderr[-2000:])
    return {"node": json.loads(result.stdout)["node"], "codexAvailable": shutil.which("codex") is not None,
            "authentication": "inherited; login is not changed or verified by installation"}


def ensure_browser(package: Path) -> dict:
    """Verify Chromium and download it through the installed Playwright CLI if needed."""
    if os.environ.get("RUNTIME_CONTROLLER_SKIP_BROWSER_INSTALL") == "1":
        return {"status": "skipped", "message": "Browser readiness not verified: RUNTIME_CONTROLLER_SKIP_BROWSER_INSTALL=1"}
    node = shutil.which("node")
    script = "const fs=require('node:fs'),path=require('node:path');const p=require('playwright').chromium.executablePath();const cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');console.log(JSON.stringify({path:p,exists:fs.existsSync(p),cli}));"
    result = subprocess.run([node, "-e", script], cwd=package, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Unable to inspect installed Playwright Chromium: " + result.stderr[-2000:])
    browser = json.loads(result.stdout)
    if not browser["exists"]:
        cli = browser["cli"]
        installed = subprocess.run([node, str(cli), "install", "chromium"], cwd=package,
                                   capture_output=True, text=True, timeout=600)
        if installed.returncode:
            raise RuntimeError("Chromium download failed; retry when network access is available: " + installed.stderr[-2000:])
        result = subprocess.run([node, "-e", script], cwd=package, capture_output=True, text=True, timeout=30)
        if result.returncode or not json.loads(result.stdout)["exists"]:
            raise RuntimeError("Playwright reported success but Chromium is still unavailable")
    return {"status": "completed", "message": "Playwright Chromium executable is present"}
