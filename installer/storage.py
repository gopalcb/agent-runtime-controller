"""Perform descriptor-relative, symlink-safe file operations and advisory locking."""

from collections.abc import Iterator
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import secrets
import stat

from installer.validation import validate_relative


class SafeRoot:
    """Own a directory descriptor so managed writes cannot follow symlink parents."""

    def __init__(self, root: Path) -> None:
        """Open an existing directory without following a final symlink."""
        self.fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def close(self) -> None:
        """Release the root directory descriptor."""
        os.close(self.fd)

    @contextmanager
    def parent(self, path: str, create: bool = False) -> Iterator:
        """Yield the parent descriptor and basename, rejecting symlink components."""
        parts = validate_relative(path).split("/")
        descriptor = os.dup(self.fd)
        try:
            for part in parts[:-1]:
                if create:
                    try:
                        os.mkdir(part, 0o700, dir_fd=descriptor)
                    except FileExistsError:
                        pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            yield descriptor, parts[-1]
        finally:
            os.close(descriptor)

    def read(self, path: str) -> bytes | None:
        """Read a regular file safely, returning None only for a missing path."""
        try:
            with self.parent(path) as (parent, name):
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(descriptor, "rb") as source:
                    if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                        raise ValueError(f"Expected a regular file: {path}")
                    return source.read()
        except FileNotFoundError:
            return None

    def write(self, path: str, content: bytes, mode: int = 0o600) -> None:
        """Atomically replace a regular file without following symlinks."""
        with self.parent(path, True) as (parent, name):
            try:
                existing = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if not stat.S_ISREG(existing.st_mode):
                    raise ValueError(f"Refusing non-regular destination: {path}")
            except FileNotFoundError:
                pass
            temporary = f".{name}.{secrets.token_hex(8)}.tmp"
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
            try:
                with os.fdopen(descriptor, "wb") as target:
                    target.write(content)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
            finally:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass

    def remove(self, path: str) -> None:
        """Unlink only the named entry; never recursively remove directories."""
        with self.parent(path) as (parent, name):
            os.unlink(name, dir_fd=parent)

    def read_json(self, path: str, default: dict) -> dict:
        """Read JSON state or return its explicit default when absent."""
        content = self.read(path)
        result = json.loads(content) if content is not None else default
        if not isinstance(result, dict):
            raise ValueError(f"Expected object in {path}")
        return result

    def write_json(self, path: str, value: dict) -> None:
        """Persist formatted JSON with atomic replacement."""
        self.write(path, (json.dumps(value, indent=2) + "\n").encode())

    @contextmanager
    def lock(self, path: str, wait: bool = False) -> Iterator:
        """Hold a kernel lock; crashes release it without unsafe stale-lock deletion."""
        with self.parent(path, True) as (parent, name):
            try:
                descriptor = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            except FileExistsError:
                descriptor = os.open(name, os.O_RDWR | os.O_NOFOLLOW, dir_fd=parent)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError("Lock must be a regular file")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
            except BlockingIOError as error:
                raise RuntimeError("Another installation or startup is already in progress") from error
            yield
        finally:
            os.close(descriptor)
