# Runtime Logger

A local Python module for recording runtime messages and agent activities.
Requires Python 3.11+ on macOS/Linux and uses only the standard library.

The module is at `$RUNTIME_CONTROLLER_CODEX_HOME/tools/runtime_logger/runtime_logger.py`.
Resolve RUNTIME_CONTROLLER_CODEX_HOME from the environment. No MCP server or restart is required.

## Agent activity logging

Call `write_activity(agent, event_message, project="")` at meaningful milestones
for planned work. One completion event is sufficient for a small direct change;
do not log routine questions. Use your assigned agent name and affected project,
or `""` when unrelated to a project. Keep messages brief and factual. Exclude
secrets, full prompts, code, and command output. Avoid duplicate events.
If logging fails, report it briefly and continue.

Agent names must start with a letter or number and contain only letters,
numbers, hyphens, or underscores, up to 120 characters.

Agent logs use the same timestamp and severity format as runtime logs:

```text
2026-10-17T08:30:36+00:00 [INFO] [example-project] Completed implementation.
```

The project prefix is omitted when the project is empty. Python generates the
timestamp. Logs are stored yearly per agent in
`$RUNTIME_CONTROLLER_CODEX_HOME/logs/logs__<agent-name>__YYYY.log`. Existing monthly JSON logs are
left in place; new events use the yearly text logs.

## Example and verification

Run from any directory with RUNTIME_CONTROLLER_CODEX_HOME set:

```bash
python3 - <<'PYTHON'
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ["RUNTIME_CONTROLLER_CODEX_HOME"]) / "tools" / "runtime_logger"))
from runtime_logger import write_activity

path = write_activity(
    agent="main-agent",
    project="",
    event_message="Verified activity logging setup.",
)
print(path)
PYTHON
```

Check the returned file for the new record. Files are created as needed and
retained until manually removed. Logging settings, including the default
UTC timezone, are configured in `runtime_logger.py`.

## Runtime logging

`initialize()` creates the runtime log files. `get_logger("initializer")` and
`get_logger("folder-watcher")` return standard Python loggers that write yearly
files under `$RUNTIME_CONTROLLER_CODEX_HOME/logs`. Agent logs are created on their first event.

Activity logging is agent-reported history, not automatic auditing. Writes use
thread and process locks. Failed writes raise exceptions; retries may produce
duplicate entries. Keep logs on local disk and exclude logs and .venv from
version control.
