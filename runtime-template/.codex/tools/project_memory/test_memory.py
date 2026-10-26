"""Verify project note isolation, persistence and unsafe filesystem boundaries.

All writes occur under temporary test projects; native Codex state is untouched.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import memory


class ProjectMemoryTests(unittest.TestCase):
    """Exercise note storage through temporary project and memory directories."""

    def test_notes_survive_reload_and_projects_remain_isolated(self) -> None:
        """Persist retained text and search it without leaking between projects."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            self.assertEqual(memory.manage_notes(first, "list"), [])
            self.assertFalse((first / ".codex").exists())
            added = memory.manage_notes(first, "add", "  Remember the verified build command.  ")
            self.assertEqual(added[0]["text"], "Remember the verified build command.")
            self.assertEqual(memory.manage_notes(first, "list"), added)
            self.assertEqual(memory.manage_notes(first, "search", "BUILD"), added)
            self.assertEqual(memory.manage_notes(first, "search", "absent"), [])
            self.assertEqual(memory.manage_notes(second, "list"), [])
            self.assertFalse(list(first.rglob("*.tmp")))
            index = first / ".codex/runtime-controller/memory/notes.json"
            self.assertEqual(index.stat().st_mode & 0o777, 0o600)

    def test_environment_and_explicit_project_preserve_native_home(self) -> None:
        """Use the project variable or explicit root without touching auth home."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            project = root / "project"
            project.mkdir()
            native = root / "native"
            with patch.dict(os.environ, {"RUNTIME_CONTROLLER_CODEX_HOME": str(project / ".codex"), "CODEX_HOME": str(native)}):
                self.assertEqual(memory.resolve_project(None), project)
                self.assertEqual(memory.resolve_project(str(root)), root)
                memory.manage_notes(memory.resolve_project(None), "add", "Explicit retention.")
                self.assertEqual(os.environ["CODEX_HOME"], str(native))
            self.assertFalse(native.exists())
            link = root / "linked-project"
            link.symlink_to(project, target_is_directory=True)
            with self.assertRaises(ValueError):
                memory.resolve_project(str(link))

    def test_symlinked_namespace_index_and_lock_are_rejected(self) -> None:
        """Reject links at every writable namespace component without escape."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            outside = root / "outside"
            outside.mkdir()
            for relative in (".codex", ".codex/runtime-controller", ".codex/runtime-controller/memory"):
                project = root / relative.replace("/", "-").replace(".", "")
                project.mkdir()
                link = project / relative
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(outside, target_is_directory=True)
                with self.assertRaises(OSError):
                    memory.manage_notes(project, "add", "Do not escape.")
            for filename in ("notes.json", ".notes.lock"):
                project = root / filename.replace(".", "-")
                space = project / ".codex/runtime-controller/memory"
                space.mkdir(parents=True)
                target = outside / filename
                target.write_text("untouched")
                (space / filename).symlink_to(target)
                with self.assertRaises(OSError):
                    memory.manage_notes(project, "add", "Do not follow.")
                self.assertEqual(target.read_text(), "untouched")
            self.assertEqual(sorted(path.name for path in outside.iterdir()), [".notes.lock", "notes.json"])

    def test_invalid_text_and_corrupt_index_preserve_existing_bytes(self) -> None:
        """Fail before replacing bounded or malformed stored content."""
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            for text in (" ", "x" * (memory.MAX_TEXT + 1)):
                with self.assertRaises(ValueError):
                    memory.manage_notes(project, "add", text)
            self.assertFalse((project / ".codex").exists())
            memory.manage_notes(project, "add", "Retained.")
            index = project / ".codex/runtime-controller/memory/notes.json"
            for raw in ('{"version": 2, "notes": []}', '{broken'):
                index.write_text(raw)
                with self.assertRaises(ValueError):
                    memory.manage_notes(project, "add", "Another note.")
                self.assertEqual(index.read_text(), raw)

    def test_concurrent_cli_additions_keep_every_note(self) -> None:
        """Serialize concurrent additions and leave a complete JSON index."""
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            processes = [subprocess.Popen(
                [sys.executable, "-B", memory.__file__, "--project", str(project), "add", f"Explicit note {number}"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            ) for number in range(6)]
            try:
                for process in processes:
                    output, errors = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, 0, errors)
                    self.assertEqual(len(json.loads(output)), 1)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                    process.communicate(timeout=10)
            notes = memory.manage_notes(project, "list")
            self.assertEqual({note["text"] for note in notes}, {f"Explicit note {number}" for number in range(6)})
            self.assertEqual(len({note["id"] for note in notes}), 6)

    def test_failed_atomic_replace_keeps_old_index_and_removes_temporary(self) -> None:
        """Clean temporary output while preserving the last committed index."""
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            original = memory.manage_notes(project, "add", "Original.")
            with patch.object(memory.os, "replace", side_effect=OSError("Injected replacement failure")):
                with self.assertRaises(OSError):
                    memory.manage_notes(project, "add", "Uncommitted.")
            self.assertEqual(memory.manage_notes(project, "list"), original)
            self.assertFalse(list(project.rglob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
