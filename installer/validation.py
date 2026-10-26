"""Validate project paths, template manifests, and lifecycle action boundaries."""

import json
from pathlib import Path, PurePosixPath
import re


def validate_project(value: str) -> Path:
    """Resolve an existing project directory; never create a mistyped project root."""
    project = Path(value).expanduser().resolve(strict=True)
    if not project.is_dir():
        raise ValueError("Project must be an existing directory")
    return project


def validate_relative(value: str) -> str:
    """Accept only normalized relative POSIX paths below a controlled root."""
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Invalid managed path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError(f"Unsafe managed path: {value}")
    return value


def load_manifest(template: Path) -> list:
    """Validate the payload inventory before any managed file is changed."""
    manifest = json.loads((template / "manifest.json").read_text())
    entries = manifest.get("files") if isinstance(manifest, dict) else manifest
    if not isinstance(entries, list) or not entries:
        raise ValueError("Template manifest requires a nonempty files list")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid template entry")
        path = validate_relative(entry.get("path"))
        digest = entry.get("sha256")
        if path in seen or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError(f"Duplicate path or invalid hash: {path}")
        if path in ("config.toml", "auth.json") or path.startswith(("memories/", "sessions/")):
            raise ValueError(f"Template may not manage private Codex state: {path}")
        if path.startswith("runtime-controller/") and path.split("/")[1] in (
            "install.json", "managed.json", "install.lock", "conflicts", "launcher.json", "codex.py"
        ):
            raise ValueError(f"Reserved installer path: {path}")
        seen.add(path)
    return entries


def validate_action(action: str, status: str) -> None:
    """Restrict destructive lifecycle actions to completed installations."""
    if action not in ("install", "retry", "reinstall", "reset"):
        raise ValueError("Unknown installation action")
    if action in ("reinstall", "reset") and status != "completed":
        raise ValueError(f"{action} requires a completed installation; use retry for a failed install")
    if action == "retry" and status not in ("failed", "installing"):
        raise ValueError("retry requires a failed or interrupted installation")
    if action == "install" and status in ("failed", "installing"):
        raise ValueError("Installation was failed or interrupted; use retry")


def validate_receipt(receipt: dict) -> dict:
    """Bound persisted ownership to installer assets and native discovery bridges."""
    receipt.setdefault("bridges", {})
    for key in ("files", "bridges"):
        entries = receipt.get(key)
        if not isinstance(entries, dict):
            raise ValueError("Invalid managed-file receipt")
        for path, digest in entries.items():
            validate_relative(path)
            if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError(f"Invalid managed hash: {path}")
            if key == "bridges":
                if path != "AGENTS.md" and not path.startswith(".agents/skills/"):
                    raise ValueError(f"Invalid project discovery bridge: {path}")
            elif path in ("config.toml", "auth.json", "runtime-controller/install.json", "runtime-controller/install.lock", "runtime-controller/managed.json") or path.startswith(("memories/", "sessions/")):
                raise ValueError(f"Reserved file in ownership receipt: {path}")
    return receipt


def validate_port(port: int) -> int:
    """Require an unprivileged port for the controller process."""
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("Controller port must be between 1024 and 65535")
    return port
