"""Exercise installer file ownership, symlink boundaries, progress, and HTTP startup."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from installer.bootstrap import bootstrap_install
from installer.ensure import ensure_controller, get_identity
from installer.host_setup import drop_privileges, main as host_main
from installer.lifecycle import run_install
from installer.runtime import ensure_browser
from installer.storage import SafeRoot
from installer.validation import load_manifest
from installer.wrapper import main as wrapper_main


class InstallerTests(unittest.TestCase):
    """Verify install and recovery against disposable projects and manifests."""

    def setUp(self) -> None:
        """Create separate disposable project, payload, and outside directories."""
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.project = self.base / "project"
        self.project.mkdir()
        self.template = self.base / "template"
        (self.template / ".codex").mkdir(parents=True)
        self.create_template({"AGENTS.md": b"portable instructions", "skills/demo/SKILL.md": b"demo skill"})
        runtime_patch = patch("installer.lifecycle.check_runtime", return_value={"node": "fixture", "codexAvailable": False})
        browser_patch = patch("installer.lifecycle.ensure_browser", return_value={"status": "skipped", "message": "fixture"})
        runtime_patch.start()
        browser_patch.start()
        self.addCleanup(runtime_patch.stop)
        self.addCleanup(browser_patch.stop)

    def create_template(self, files: dict) -> None:
        """Write a real hash-verified template fixture."""
        entries = []
        for name, content in files.items():
            path = self.template / ".codex" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            entries.append({"path": name, "sha256": hashlib.sha256(content).hexdigest()})
        (self.template / "manifest.json").write_text(json.dumps({"version": "0.2.0", "files": entries}))

    def install(self, action: str = "install") -> dict:
        """Capture CLI events while executing the real lifecycle implementation."""
        self.output = io.StringIO()
        with redirect_stdout(self.output):
            return run_install(str(self.project), action, self.template)

    def test_progress_and_idempotent_install(self) -> None:
        """Progress records are real, persisted, and repeated installs are no-ops."""
        state = self.install()
        events = [json.loads(line) for line in self.output.getvalue().splitlines()]
        self.assertEqual([item["progress"] for item in events], [0, 10, 20, 50, 90, 100])
        self.assertIn("ownerPid", events[0])
        self.assertNotIn("ownerPid", state)
        self.assertEqual(state["status"], "completed")
        saved = json.loads((self.project / ".codex/runtime-controller/install.json").read_text())
        self.assertEqual(saved, state)
        instructions = self.project / ".codex/AGENTS.md"
        before = instructions.stat().st_mtime_ns
        self.assertEqual(self.install(), state)
        self.assertEqual(instructions.stat().st_mtime_ns, before)

    def test_reset_preserves_edits_memory_and_unrelated_state(self) -> None:
        """Reset removes only unchanged managed files and never deletes user notes."""
        self.install()
        root = self.project / ".codex"
        (root / "AGENTS.md").write_text("user edited instructions")
        (root / "auth.json").write_text("private authentication fixture")
        note = root / "runtime-controller/memory/notes/decision.md"
        note.write_text("durable user note")
        state = self.install("reset")
        self.assertEqual(state["status"], "not-installed")
        self.assertFalse((root / "skills/demo/SKILL.md").exists())
        self.assertFalse((root / "runtime-controller/codex.py").exists())
        self.assertFalse((self.project / ".agents/skills/demo/SKILL.md").exists())
        self.assertFalse((self.project / "AGENTS.md").exists())
        self.assertEqual((root / "AGENTS.md").read_text(), "user edited instructions")
        self.assertTrue((root / "auth.json").exists())
        self.assertEqual(note.read_text(), "durable user note")
        self.assertTrue((root / "runtime-controller/memory/index.md").exists())

    def test_conflicts_and_reinstall_keep_user_files(self) -> None:
        """Existing instructions and edited managed skills receive incoming copies."""
        (self.project / ".codex").mkdir()
        instructions = self.project / ".codex/AGENTS.md"
        instructions.write_text("existing user instructions")
        first = self.install()
        self.assertEqual(len(first["conflicts"]), 1)
        skill = self.project / ".codex/skills/demo/SKILL.md"
        skill.write_text("edited skill")
        self.create_template({"AGENTS.md": b"new instructions", "skills/demo/SKILL.md": b"new skill"})
        state = self.install("reinstall")
        self.assertEqual(len(state["conflicts"]), 2)
        self.assertEqual(instructions.read_text(), "existing user instructions")
        self.assertEqual(skill.read_text(), "edited skill")
        for conflict in state["conflicts"]:
            self.assertTrue((self.project / ".codex" / conflict["incoming"]).is_file())

    def test_manifest_integrity_failure_is_retryable(self) -> None:
        """A bad source hash fails before deployment and a repaired payload retries."""
        (self.template / ".codex/AGENTS.md").write_text("corrupted")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.install()
        saved = json.loads((self.project / ".codex/runtime-controller/install.json").read_text())
        self.assertEqual(saved["status"], "failed")
        self.assertFalse((self.project / ".codex/AGENTS.md").exists())
        with self.assertRaisesRegex(ValueError, "completed"):
            self.install("reset")
        self.create_template({"AGENTS.md": b"repaired"})
        self.assertEqual(self.install("retry")["status"], "completed")

    def test_lock_rejects_competing_install_without_corrupting_state(self) -> None:
        """A competing process cannot replace the current installation state."""
        self.install()
        state = (self.project / ".codex/runtime-controller/install.json").read_bytes()
        root = SafeRoot(self.project)
        try:
            with root.lock(".codex/runtime-controller/install.lock"):
                result = subprocess.run([sys.executable, "-m", "installer", "--project", str(self.project), "--action", "reinstall"], capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertIn("already in progress", result.stdout)
            self.assertEqual((self.project / ".codex/runtime-controller/install.json").read_bytes(), state)
        finally:
            root.close()

    def test_symlinked_codex_and_destination_cannot_escape_project(self) -> None:
        """Both root and nested directory symlinks fail without modifying targets."""
        outside = self.base / "outside"
        outside.mkdir()
        (outside / "sentinel").write_text("keep")
        (self.project / ".codex").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.install()
        self.assertEqual(list(outside.iterdir()), [outside / "sentinel"])
        (self.project / ".codex").unlink()
        (self.project / ".codex/skills").mkdir(parents=True)
        (self.project / ".codex/skills/demo").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.install()
        self.assertFalse((outside / "SKILL.md").exists())

    def test_traversal_and_private_payload_are_rejected(self) -> None:
        """Untrusted manifests cannot target parent directories or private auth."""
        for path in ("../escape", "/absolute", "auth.json", "config.toml", "memories/private.md", "runtime-controller/install.json"):
            with self.subTest(path=path):
                (self.template / "manifest.json").write_text(json.dumps([{"path": path, "sha256": "a" * 64}]))
                with self.assertRaises(ValueError):
                    load_manifest(self.template)

    def test_native_bridges_preserve_existing_instructions_and_skills(self) -> None:
        """Discovery bridges never replace existing project-owned instructions or skills."""
        (self.project / "AGENTS.md").write_text("project instructions")
        native_skill = self.project / ".agents/skills/demo/SKILL.md"
        native_skill.parent.mkdir(parents=True)
        native_skill.write_text("native user skill")
        result = self.install()
        self.assertEqual((self.project / "AGENTS.md").read_text(), "project instructions")
        self.assertEqual(native_skill.read_text(), "native user skill")
        self.assertEqual({item["path"] for item in result["conflicts"]}, {"AGENTS.md", ".agents/skills/demo/SKILL.md"})
        self.install("reset")
        self.assertEqual(native_skill.read_text(), "native user skill")

    def test_interrupted_install_can_retry(self) -> None:
        """A lock released by a dead worker allows retry from persisted installing state."""
        self.install()
        state_path = self.project / ".codex/runtime-controller/install.json"
        state = json.loads(state_path.read_text())
        state["status"] = "installing"
        state["ownerPid"] = 99999999
        state_path.write_text(json.dumps(state))
        self.assertEqual(self.install("retry")["status"], "completed")

    def test_wrapper_preserves_auth_environment_and_arguments(self) -> None:
        """The child guard bypasses startup while forwarding CLI arguments and auth paths."""
        self.install()
        commands = self.base / "commands"
        commands.mkdir()
        codex = commands / "codex"
        codex.write_text(f"#!{sys.executable}\nimport json,os,sys\nprint(json.dumps({{'args':sys.argv[1:],'cwd':os.getcwd(),'home':os.environ.get('CODEX_HOME'),'runtimeHome':os.environ.get('RUNTIME_CONTROLLER_CODEX_HOME'),'child':os.environ.get('RUNTIME_CONTROLLER_CHILD')}}))\n")
        codex.chmod(0o700)
        environment = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ.get("PATH", ""),
                           CODEX_HOME="/fixture/auth/home", RUNTIME_CONTROLLER_CHILD="1")
        wrapper = self.project / ".codex/runtime-controller/codex.py"
        result = subprocess.run([sys.executable, str(wrapper), "--model", "fixture model", "argument with spaces"],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["args"], ["--model", "fixture model", "argument with spaces"])
        self.assertEqual(payload["home"], "/fixture/auth/home")
        self.assertEqual(payload["cwd"], str(self.project.resolve()))
        self.assertEqual(payload["runtimeHome"], str((self.project / ".codex").resolve()))

    def test_wrapper_uses_installed_controller_port(self) -> None:
        """A custom controller port is persisted and forwarded to ensure on startup."""
        with patch.dict(os.environ, {"RUNTIME_CONTROLLER_PORT": "43217"}):
            self.install()
        wrapper = self.project / ".codex/runtime-controller/codex.py"
        receipt = json.loads(wrapper.with_name("launcher.json").read_text())
        self.assertEqual(receipt["port"], 43217)
        with patch("installer.wrapper.__file__", str(wrapper)), patch.dict(os.environ, {"RUNTIME_CONTROLLER_CHILD": "0"}), \
                patch("installer.wrapper.shutil.which", return_value="/fixture/codex"), \
                patch("installer.wrapper.subprocess.run", return_value=SimpleNamespace(returncode=0)) as ensure, \
                patch("installer.wrapper.os.chdir"), \
                patch("installer.wrapper.os.execvpe", side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit):
                wrapper_main()
        arguments = ensure.call_args.args[0]
        self.assertEqual(arguments[arguments.index("--port") + 1], "43217")


class ControllerHandler(BaseHTTPRequestHandler):
    """Provide a bounded loopback API fixture with project-aware authentication."""

    def log_message(self, format: str, *args) -> None:
        """Keep the test fixture quiet."""
        return

    def do_GET(self) -> None:
        """Return real JSON identity and bootstrap responses."""
        payload = {"service": "runtime-controller", "version": "0.2.0", "pid": os.getpid(),
                   "project": {"id": "fixture-project", "root": str(self.server.project)},
                   "token": "fixture-token", "installation": {"status": "not-installed"}}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_POST(self) -> None:
        """Record authenticated writes without altering the active project."""
        if self.headers.get("X-Builder-Token") != "fixture-token" or self.headers.get("X-Project-Id") != "fixture-project":
            self.send_error(403)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append((self.path, payload))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


class EnsureTests(unittest.TestCase):
    """Verify readiness, singleton behavior, and non-switching registration over HTTP."""

    def setUp(self) -> None:
        """Start a local test API and private disposable startup directory."""
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ControllerHandler)
        self.server.project = self.project
        self.server.requests = []
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.directory_patch = patch("installer.ensure.startup_directory", return_value=self.project)
        self.directory_patch.start()
        self.addCleanup(self.directory_patch.stop)

    def stop_server(self) -> None:
        """Close the owned fixture server and join its serving thread."""
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def test_parallel_ensure_reuses_ready_service(self) -> None:
        """Simultaneous ensure callers reuse a verified controller without spawning."""
        with patch("installer.ensure.subprocess.Popen") as spawn:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(ensure_controller, str(self.project), self.port) for _ in range(4)]
                results = [future.result(timeout=5) for future in futures]
            self.assertTrue(all(result["active"] for result in results))
            spawn.assert_not_called()

    def test_other_project_registers_without_install_or_switch(self) -> None:
        """Bootstrap preserves the active project when another project requests startup."""
        other = self.project / "other"
        other.mkdir()
        result = bootstrap_install(str(other), self.port, False)
        self.assertFalse(result["active"])
        self.assertEqual(self.server.project, self.project)
        self.assertEqual(self.server.requests, [("/api/projects/register", {"path": str(other.resolve())})])

    def test_bootstrap_submits_authenticated_install(self) -> None:
        """The UI bootstrap starts the worker through project-authenticated HTTP."""
        result = bootstrap_install(str(self.project), self.port, False)
        self.assertTrue(result["active"])
        self.assertEqual(self.server.requests, [("/api/install", {"action": "install"})])

    def test_wrong_service_is_not_treated_as_absent(self) -> None:
        """An occupied incompatible port must not trigger another launch."""
        with patch("installer.ensure.request_json", return_value={"service": "other"}):
            with self.assertRaisesRegex(RuntimeError, "incompatible"):
                get_identity(self.port)

    def test_failed_startup_terminates_owned_child(self) -> None:
        """A child which never becomes ready is terminated on timeout."""
        with patch("installer.ensure.get_identity", return_value=None), patch("installer.ensure.subprocess.Popen") as spawn:
            spawn.return_value.poll.return_value = None
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                ensure_controller(str(self.project), self.port, 0.01)
            spawn.return_value.terminate.assert_called_once()
            spawn.return_value.wait.assert_called_once()

    def test_parallel_cold_start_spawns_one_real_node_process(self) -> None:
        """Competing cold starts converge on one detached Node fixture and clean it up."""
        package = self.project / "package"
        (package / "bin").mkdir(parents=True)
        script = """const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const project=process.argv[process.argv.indexOf('--project')+1];
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
fs.appendFileSync(path.join(__dirname,'../launches'),'start\\n');
http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({service:'runtime-controller',version:'0.2.0',pid:process.pid,project:{id:'fixture',root:project}}));}).listen(port,'127.0.0.1');
"""
        (package / "bin/visual-agent-builder.cjs").write_text(script)
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
        children = []
        real_spawn = subprocess.Popen

        def record_spawn(*args, **kwargs):
            """Retain handles so the test always cleans up its owned child process."""
            process = real_spawn(*args, **kwargs)
            children.append(process)
            return process

        try:
            with patch("installer.ensure.PACKAGE_ROOT", package), patch("installer.ensure.subprocess.Popen", side_effect=record_spawn):
                with ThreadPoolExecutor(max_workers=4) as pool:
                    futures = [pool.submit(ensure_controller, str(self.project), port) for _ in range(4)]
                    results = [future.result(timeout=10) for future in futures]
            self.assertEqual(len(children), 1)
            self.assertEqual(len({result["identity"]["pid"] for result in results}), 1)
            self.assertEqual((package / "launches").read_text(), "start\n")
        finally:
            for process in children:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


class RuntimeTests(unittest.TestCase):
    """Verify browser installation respects npm dependency resolution."""

    def test_browser_download_uses_resolved_hoisted_cli(self) -> None:
        """Missing Chromium invokes the resolved Playwright CLI, not a guessed child path."""
        missing = {"path": "/fixture/browser", "exists": False, "cli": "/consumer/node_modules/playwright/cli.js"}
        installed = dict(missing, exists=True)
        responses = [SimpleNamespace(returncode=0, stdout=json.dumps(missing), stderr=""),
                     SimpleNamespace(returncode=0, stdout="", stderr=""),
                     SimpleNamespace(returncode=0, stdout=json.dumps(installed), stderr="")]
        with patch.dict(os.environ, {"RUNTIME_CONTROLLER_SKIP_BROWSER_INSTALL": "0"}), \
                patch("installer.runtime.subprocess.run", side_effect=responses) as run:
            self.assertEqual(ensure_browser(Path("/consumer/node_modules/@gb/controller"))["status"], "completed")
        self.assertEqual(run.call_args_list[1].args[0][1:], [missing["cli"], "install", "chromium"])


class PrivilegeTests(unittest.TestCase):
    """Inspect privilege ordering without changing the machine hosts file or UID."""

    def test_proxy_drops_privileges_before_listen(self) -> None:
        """The privileged helper must bind, drop root, then activate its listener."""
        events = []
        with patch.dict(os.environ, {"SUDO_UID": "501"}), patch("installer.host_setup.os.geteuid", return_value=0), \
                patch("installer.host_setup.get_identity", return_value={"service": "runtime-controller"}), \
                patch("installer.host_setup.update_hosts"), patch("installer.host_setup.LoopbackProxy") as proxy, \
                patch("installer.host_setup.drop_privileges", side_effect=lambda: events.append("drop")), \
                patch.object(sys, "argv", ["host_setup"]), redirect_stdout(io.StringIO()):
            instance = proxy.return_value.__enter__.return_value
            instance.server_bind.side_effect = lambda: events.append("bind")
            instance.server_activate.side_effect = lambda: events.append("listen")
            self.assertEqual(host_main(), 0)
        self.assertEqual(events, ["bind", "drop", "listen"])

    def test_privilege_drop_clears_groups_and_uid(self) -> None:
        """Privilege drop clears supplementary groups before gid and uid changes."""
        events = []
        with patch.dict(os.environ, {"SUDO_UID": "501", "SUDO_GID": "20"}), \
                patch("installer.host_setup.os.setgroups", side_effect=lambda groups: events.append(("groups", groups))), \
                patch("installer.host_setup.os.setgid", side_effect=lambda gid: events.append(("gid", gid))), \
                patch("installer.host_setup.os.setuid", side_effect=lambda uid: events.append(("uid", uid))), \
                patch("installer.host_setup.os.getuid", return_value=501), patch("installer.host_setup.os.geteuid", return_value=501), \
                patch("installer.host_setup.pwd.getpwuid"), patch("installer.host_setup.os.chdir"):
            drop_privileges()
        self.assertEqual(events, [("groups", []), ("gid", 20), ("uid", 501)])


if __name__ == "__main__":
    unittest.main()
