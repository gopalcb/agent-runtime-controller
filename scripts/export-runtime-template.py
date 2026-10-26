"""Export the reviewed portable runtime payload and its deterministic manifest.

The committed runtime-template/.codex tree is the audited source, not the live
account runtime. This script never reads CODEX_HOME, native memories or secrets.
It validates the explicit allowlist before generating hashes or exporting a copy.
"""

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


VERSION = "0.2.0"
TEMPLATE = Path(__file__).resolve().parents[1] / "runtime-template"
ALLOWLIST = {
    "AGENTS.md",
    "workflows/development.md", "workflows/checkpoint.md",
    "workflows/ui-testing.md", "workflows/memory.md",
    "references/task-records.md", "assets/templates/project.toml",
    "tools/runtime_logger/runtime_logger.py", "tools/runtime_logger/__init__.py",
    "tools/runtime_logger/README.md",
}
ALLOWLIST.update(f"agents/{name}.toml" for name in (
    "builder-agent", "planner-agent", "low-effort", "medium-effort", "high-effort",
))
ALLOWLIST.update(f"skills/{name}/SKILL.md" for name in (
    "plan-development", "implement-development", "python-development",
    "ui-testing-and-debugging", "computer-use",
))
ALLOWLIST.update(f"tools/ui-testing-and-debugging/{name}" for name in (
    "cli.mjs", "validation.mjs", "README.md", "docs/requirements.md",
    "docs/testing.md", "docs/debugging.md", "docs/pointer.md",
    "templates/requirements.json", "templates/cycle.json", "tests/tool.test.mjs",
    "pointer/PointerOverlay.swift", "pointer/pointer.mjs",
    "pointer/mcp-proxy.mjs", "pointer/pointer.test.mjs",
))
AUTHORED = {"workflows/memory.md"}
AUTHORED.update(f"tools/project_memory/{name}" for name in (
    "memory.py", "test_memory.py", "README.md", "ARCHITECTURE.md", "code-map.yaml",
))
ALLOWLIST.update(AUTHORED)
ADAPTED = {
    "AGENTS.md", "workflows/development.md", "tools/runtime_logger/runtime_logger.py",
    "tools/runtime_logger/README.md", "tools/ui-testing-and-debugging/README.md",
    "tools/ui-testing-and-debugging/docs/pointer.md",
}
ADAPTED.update(path for path in ALLOWLIST if path.startswith("agents/"))
ADAPTED.update({
    "skills/implement-development/SKILL.md", "skills/plan-development/SKILL.md",
    "skills/ui-testing-and-debugging/SKILL.md", "workflows/checkpoint.md",
    "workflows/ui-testing.md",
})
EXCLUSIONS = [
    "Account config.toml, auth.json, hooks.json, credentials, environment and secrets",
    "Native memories, sessions, history, databases, logs, caches and plugin installs",
    "Private task records, screenshots, browser profiles and generated artifacts",
    "Domain-specific Glue/AWS/portfolio workflows, tools and skills",
    "Duplicate hashed agent/skill registrations and account-specific model routing",
    "Native Computer Use binaries, MCP configuration and historical hook commands",
    "External ~/.agents context skills: redistribution provenance not established",
    "Existing memory notes: installer creates only a plugin-owned empty scaffold",
]


def validate_payload(root: Path) -> list:
    """Reject unexpected files, symlinks and machine-specific paths before export."""
    payload = root / ".codex"
    if not payload.is_dir() or payload.is_symlink():
        raise ValueError("Template .codex must be a regular directory")
    actual = set()
    for path in payload.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not portable payload files: {path.name}")
        if not path.is_file():
            continue
        relative = path.relative_to(payload).as_posix()
        actual.add(relative)
        content = path.read_text(encoding="utf-8")
        if re.search(r"/(?:Users|home)/[^\s/]+|[A-Za-z]:\\Users\\", content):
            raise ValueError(f"Machine-specific home path in {relative}")
    if actual != ALLOWLIST:
        raise ValueError(f"Payload allowlist mismatch; missing={sorted(ALLOWLIST - actual)}, "
                         f"unexpected={sorted(actual - ALLOWLIST)}")
    return sorted(actual)


def build_manifest(root: Path) -> dict:
    """Hash reviewed bytes in stable order and record project-relative provenance."""
    files = []
    for relative in validate_payload(root):
        content = (root / ".codex" / relative).read_bytes()
        generated = relative in AUTHORED
        files.append({
            "path": relative,
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
            "provenance": {
                "source": ("runtime-template/.codex/" if generated else ".codex/") + relative,
                "kind": "authored" if generated else ("adapted" if relative in ADAPTED else "audited-copy"),
                "origin": "GB Systems workspace instructions and generic runtime tooling",
            },
        })
    return {"version": VERSION, "files": files, "exclusions": EXCLUSIONS}


def main() -> None:
    """Check or write the manifest and optionally export to a new destination."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check manifest without changing files")
    parser.add_argument("--output", type=Path, help="Export reviewed template into a new directory")
    args = parser.parse_args()
    if args.check and args.output:
        parser.error("--check cannot be combined with --output")
    if args.output and args.output.exists():
        parser.error("--output must be a new directory; existing data is never overwritten")
    try:
        manifest = build_manifest(TEMPLATE)
        serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        manifest_path = TEMPLATE / "manifest.json"
        if args.check:
            if manifest_path.read_text(encoding="utf-8") != serialized:
                raise ValueError("Manifest differs from reviewed payload; regenerate and inspect it")
        elif args.output:
            args.output.mkdir(parents=True)
            shutil.copytree(TEMPLATE / ".codex", args.output / ".codex")
            shutil.copyfile(TEMPLATE / "README.md", args.output / "README.md")
            (args.output / "manifest.json").write_text(serialized, encoding="utf-8")
        else:
            manifest_path.write_text(serialized, encoding="utf-8")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Runtime template export failed: {error}\n")
    total = sum(entry["bytes"] for entry in manifest["files"])
    print(f"Validated {len(manifest['files'])} payload files, {total} bytes, version {VERSION}")


if __name__ == "__main__":
    main()
