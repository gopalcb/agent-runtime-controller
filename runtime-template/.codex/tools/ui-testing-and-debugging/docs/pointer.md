# Optional blue pointer

The supplied source has two optional macOS features: a desktop overlay and an MCP
proxy that enhances successful coordinate-action screenshot frames. They do not
prove action outcomes or locate keyboard focus. Use raw screenshots for visual
judgments where the marker would interfere.

Prerequisites: macOS, Swift Command Line Tools (swiftc), Node 22, and the separately
installed native Computer Use integration with required screen/accessibility
permissions. No native app, MCP launcher, configuration, binary, or saved captures
are distributed here. The CLI requirements gate works without these features.

From $RUNTIME_CONTROLLER_CODEX_HOME/tools/ui-testing-and-debugging:

```bash
node pointer/pointer.mjs build
node pointer/pointer.mjs on
node pointer/pointer.mjs status
node pointer/pointer.mjs off
node --test pointer/pointer.test.mjs
```

The desktop overlay compiles into pointer/.runtime and records its own PID there.
`off` stops only the identified owned process and disables frame enhancement.
Always turn it off and verify cleanup after a session. Do not kill unrelated apps.

The optional proxy is pointer/mcp-proxy.mjs. It expects the existing native launcher
at $CODEX_HOME/local-plugins/computer-use/bin/computer-use-client-launcher; this is
an external prerequisite, not a shipped file. Preserve native CODEX_HOME when
using the proxy and use it only if that compatible launcher is already installed.
RUNTIME_CONTROLLER_CODEX_HOME locates project procedures, not native plugins. Configure your client's MCP command manually to run
Node with the proxy path, preserving the previous native command/args/environment
for rollback. This template never edits config.toml. Reconnect the MCP session
after a command change; existing sessions retain their original server command.
Restore your recorded original command/args to remove the proxy and reconnect.

Inspect current screen state before acting. Prefer screenshot coordinates for
faithfully placed enhanced click/drag frames. Accessibility-index actions cannot
be located reliably, so their marker is suppressed. Distinguish enhanced frames
from raw evidence. Rendering failure preserves the successful native result.
The proxy uses private temporary images and removes them after processing.
Optional UI_POINTER_CAPTURE_DIR exports marked frames to an explicitly selected
new private directory. Captures may contain sensitive screen content: scope the
session and exclude its outputs from source control. No historical smoke result,
project-specific browser script, or screenshot evidence is shipped.
