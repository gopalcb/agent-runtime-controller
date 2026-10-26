"""Explicit administrator setup for the local alias and an unprivileged TCP proxy.

Run manually with sudo only after starting the controller as a normal user.
The process binds port 1001, drops privileges, and only then starts listening.
It installs no daemon or privileged persistent code.
"""

import argparse
import fcntl
import os
from pathlib import Path
import pwd
import select
import socket
import socketserver
import stat
import sys
import time

from installer.ensure import get_identity

HOSTNAME = "localhost.runtime-controller"


def update_hosts(path: Path = Path("/etc/hosts")) -> None:
    """Add the loopback alias once, keeping an exclusive timestamped backup."""
    descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "r+", encoding="utf-8") as hosts:
        info = os.fstat(hosts.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("Hosts file must be a regular root-owned file without group/world write access")
        fcntl.flock(hosts.fileno(), fcntl.LOCK_EX)
        content = hosts.read()
        for line in content.splitlines():
            fields = line.split("#", 1)[0].split()
            if HOSTNAME in fields[1:]:
                if fields[0] != "127.0.0.1":
                    raise RuntimeError(f"Existing {HOSTNAME} mapping is not 127.0.0.1; resolve it manually")
                return
        backup = path.with_name(f"{path.name}.runtime-controller-{time.time_ns()}.bak")
        with backup.open("x", encoding="utf-8") as target:
            target.write(content)
        hosts.seek(0, os.SEEK_END)
        hosts.write(("" if content.endswith("\n") else "\n") + f"127.0.0.1 {HOSTNAME}\n")
        hosts.flush()
        os.fsync(hosts.fileno())
        print(f"Added {HOSTNAME}; hosts backup: {backup}", flush=True)


def drop_privileges() -> None:
    """Drop all supplementary groups and real/effective/saved root identities."""
    uid = int(os.environ.get("SUDO_UID", "0"))
    gid = int(os.environ.get("SUDO_GID", "0"))
    if uid <= 0 or gid < 0:
        raise RuntimeError("Run with sudo from your normal account; a nonroot SUDO_UID is required")
    account = pwd.getpwuid(uid)
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    os.chdir(account.pw_dir)
    if os.getuid() == 0 or os.geteuid() == 0:
        raise RuntimeError("Privilege drop failed")


class LoopbackProxy(socketserver.ThreadingTCPServer):
    """Serve a fixed loopback upstream without running any privileged handler."""

    allow_reuse_address = True
    daemon_threads = True


class ProxyConnection(socketserver.BaseRequestHandler):
    """Relay one client connection to the controller's fixed loopback port."""

    def handle(self) -> None:
        """Forward HTTP and upgraded connections until EOF or an idle timeout."""
        try:
            with socket.create_connection(("127.0.0.1", 10101), timeout=5) as upstream:
                peers = [self.request, upstream]
                while True:
                    readable, _, _ = select.select(peers, [], [], 300)
                    if not readable:
                        return
                    for source in readable:
                        chunk = source.recv(65536)
                        if not chunk:
                            return
                        destination = upstream if source is self.request else self.request
                        destination.sendall(chunk)
        except (ConnectionError, OSError):
            return


def main() -> int:
    """Configure hosts and run the foreground proxy only after dropping root."""
    parser = argparse.ArgumentParser(description="Explicit localhost.runtime-controller:1001 setup")
    parser.add_argument("--hosts-only", action="store_true", help="Only add the alias; port 1001 still needs a proxy")
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise RuntimeError("Administrator privileges required; run sudo python3 -m installer.host_setup")
        if int(os.environ.get("SUDO_UID", "0")) <= 0:
            raise RuntimeError("Invoke sudo from a normal account, not a root shell")
        if not args.hosts_only and get_identity(10101) is None:
            raise RuntimeError("First start Runtime Controller on port 10101 as your normal user")
        update_hosts()
        if args.hosts_only:
            return 0
        with LoopbackProxy(("127.0.0.1", 1001), ProxyConnection, bind_and_activate=False) as proxy:
            proxy.server_bind()
            drop_privileges()
            proxy.server_activate()
            print(f"http://{HOSTNAME}:1001/controller/install -> 127.0.0.1:10101; uid={os.geteuid()}; Ctrl-C stops proxy", flush=True)
            proxy.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Runtime Controller alias setup: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
