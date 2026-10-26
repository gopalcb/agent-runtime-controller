"""Store explicitly retained project notes without accessing native Codex memory.

This standalone CLI owns the controller memory notes.json index. Directory file
handles and no-follow opens constrain writes to the selected project namespace;
cooperative file locking and atomic replacement preserve complete updates.
"""

import argparse
import fcntl
import json
import os
from pathlib import Path
import stat
from datetime import datetime, timezone
from uuid import uuid4


MAX_TEXT = 8000
MAX_INDEX_BYTES = 4 * 1024 * 1024
MAX_NOTES = 1000


def resolve_project(project: str | None) -> Path:
    """Resolve an explicit root or project runtime environment, rejecting links."""
    if project:
        selected = Path(project).expanduser().absolute()
    else:
        runtime = os.environ.get("RUNTIME_CONTROLLER_CODEX_HOME")
        if not runtime:
            raise ValueError("Set RUNTIME_CONTROLLER_CODEX_HOME or pass --project")
        runtime_path = Path(runtime).expanduser().absolute()
        if runtime_path.name != ".codex" or runtime_path.is_symlink():
            raise ValueError("Project runtime must be a non-symlink .codex directory")
        selected = runtime_path.parent
    if selected.is_symlink() or not selected.is_dir():
        raise ValueError("Project root must be an existing non-symlink directory")
    return selected.resolve(strict=True)


def validate_index(payload: dict) -> list:
    """Validate bounded note records before returning them or changing the index."""
    if not isinstance(payload, dict) or type(payload.get("version")) is not int or payload["version"] != 1:
        raise ValueError("Unsupported memory index version")
    notes = payload.get("notes")
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        raise ValueError("Memory index must contain at most 1000 notes")
    ids = set()
    for note in notes:
        if not isinstance(note, dict) or set(note) != {"id", "text", "created_at"}:
            raise ValueError("Invalid memory note record")
        if any(not isinstance(note[key], str) or not note[key].strip() for key in note):
            raise ValueError("Memory note fields must be non-empty strings")
        if len(note["text"]) > MAX_TEXT or len(note["id"]) > 100 or len(note["created_at"]) > 100:
            raise ValueError("Memory note exceeds field limits")
        if note["id"] in ids:
            raise ValueError("Memory note IDs must be unique")
        ids.add(note["id"])
    return notes


def manage_notes(project: Path, action: str, value: str = "") -> list:
    """Read, search or atomically append a note through safe directory handles."""
    if action not in {"add", "list", "search"}:
        raise ValueError("Unknown memory action")
    if action in {"add", "search"} and (not value.strip() or len(value) > MAX_TEXT):
        raise ValueError("Note or search text must contain 1 to 8000 characters")
    descriptors = []
    temporary = None
    memory_fd = None
    try:
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        current = os.open(project, directory_flags)
        descriptors.append(current)
        for component in (".codex", "runtime-controller", "memory"):
            try:
                child = os.open(component, directory_flags, dir_fd=current)
            except FileNotFoundError:
                if action != "add":
                    return []
                try:
                    os.mkdir(component, mode=0o700, dir_fd=current)
                except FileExistsError:
                    pass  # A concurrent writer may have created the directory.
                child = os.open(component, directory_flags, dir_fd=current)
            descriptors.append(child)
            current = child
        memory_fd = current
        if action == "add":
            lock_fd = os.open(".notes.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=memory_fd)
            descriptors.append(lock_fd)
            if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
                raise ValueError("Memory lock must be a regular file")
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
        try:
            index_fd = os.open("notes.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=memory_fd)
        except FileNotFoundError:
            notes = []
        else:
            with os.fdopen(index_fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ValueError("Memory index must be a regular file")
                raw = stream.read(MAX_INDEX_BYTES + 1)
                if len(raw) > MAX_INDEX_BYTES:
                    raise ValueError("Memory index exceeds 4 MiB")
                notes = validate_index(json.loads(raw))
        if action == "list":
            return notes
        if action == "search":
            return [note for note in notes if value.casefold() in note["text"].casefold()]
        note = {"id": str(uuid4()), "text": value.strip(), "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        notes.append(note)
        validate_index({"version": 1, "notes": notes})
        encoded = (json.dumps({"version": 1, "notes": notes}, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(encoded) > MAX_INDEX_BYTES:
            raise ValueError("Memory index exceeds 4 MiB")
        temporary = f".notes-{uuid4()}.tmp"
        output_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=memory_fd)
        with os.fdopen(output_fd, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, "notes.json", src_dir_fd=memory_fd, dst_dir_fd=memory_fd)
        temporary = None
        os.fsync(memory_fd)
        return [note]
    finally:
        try:
            if temporary is not None and memory_fd is not None:
                try:
                    os.unlink(temporary, dir_fd=memory_fd)
                except FileNotFoundError:
                    pass
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)


def main() -> None:
    """Parse explicit note commands and print JSON results or a concise failure."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", help="Existing project root; overrides project runtime environment")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("list", help="List retained project notes")
    commands.add_parser("add", help="Retain only a note explicitly requested by the user").add_argument("text")
    commands.add_parser("search", help="Find notes by case-insensitive substring").add_argument("text")
    args = parser.parse_args()
    try:
        result = manage_notes(resolve_project(args.project), args.action, getattr(args, "text", ""))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Project memory failed: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
