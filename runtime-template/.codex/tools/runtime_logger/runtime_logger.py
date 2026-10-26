"""Shared runtime and agent logging. Python 3.11+, macOS/Linux."""

import fcntl
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo


# File location: .codex/tools/runtime_logger/runtime_logger.py
CODEX_DIR = Path(__file__).resolve().parents[2]
LOG_DIR = CODEX_DIR / "logs"
TIMEZONE = ZoneInfo("UTC")

LOG_FILES = {
    "initializer": "logs__initializer__%Y.log",
    "folder-watcher": "logs__folder-watcher__%Y.log",
    "agent": "logs__{agent}__%Y.log",
}

_write_lock = Lock()


def log_path(tool_name, now, agent=None):
    """Resolve the log filename for the supplied timestamp."""
    if tool_name not in LOG_FILES:
        raise ValueError(f"Unknown tool: {tool_name}")

    template = LOG_FILES[tool_name]

    if tool_name == "agent":
        if not isinstance(agent, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}",
            agent,
        ):
            raise ValueError(
                "Agent name must be 1–120 characters: letters, numbers, "
                "hyphens or underscores, starting with a letter or number."
            )

        template = template.format(agent=agent)

    return LOG_DIR / now.strftime(template)


def append_line(tool_name, line, now, agent=None):
    """Create the log file if missing and append safely."""
    path = log_path(tool_name, now, agent=agent)

    with _write_lock:
        LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)

        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
            0o600,
        )

        with os.fdopen(
            descriptor,
            "a",
            encoding="utf-8",
        ) as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)

            try:
                stream.write(line)
                stream.flush()
                os.fsync(stream.fileno())
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    return path


def initialize():
    """Create runtime logs; agent logs are created on their first event."""
    now = datetime.now(TIMEZONE)

    for tool_name in LOG_FILES:
        if tool_name != "agent":
            append_line(tool_name, "", now)


def write_activity(agent, event_message, project=""):
    """Append one INFO line to the agent's yearly log."""
    if not isinstance(event_message, str) or not event_message.strip():
        raise ValueError("event_message must be a non-empty string")

    if not isinstance(project, str):
        raise ValueError("project must be a string")

    now = datetime.now(TIMEZONE)

    message = f"[{project}] {event_message}" if project else event_message

    return append_line(
        "agent",
        f"{now.isoformat(timespec='seconds')} [INFO] {message}\n",
        now,
        agent=agent,
    )


class RuntimeLogHandler(logging.Handler):
    """Write runtime messages to the configured yearly file."""

    def __init__(self, tool_name):
        super().__init__()

        if tool_name not in LOG_FILES or tool_name == "agent":
            raise ValueError(f"Unknown runtime tool: {tool_name}")

        self.tool_name = tool_name

    def emit(self, record):
        now = datetime.fromtimestamp(record.created, TIMEZONE)
        message = self.format(record)

        append_line(
            self.tool_name,
            f"{now.isoformat(timespec='seconds')} "
            f"[{record.levelname}] {message}\n",
            now,
        )


def get_logger(tool_name):
    """Return a runtime logger without adding duplicate handlers."""
    if tool_name not in LOG_FILES or tool_name == "agent":
        raise ValueError(f"Unknown runtime tool: {tool_name}")

    logger = logging.getLogger(f"codex.{tool_name}")
    logger.setLevel(logging.INFO)
    logger.propagate = False

    with _write_lock:
        if not logger.handlers:
            handler = RuntimeLogHandler(tool_name)
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)

    return logger