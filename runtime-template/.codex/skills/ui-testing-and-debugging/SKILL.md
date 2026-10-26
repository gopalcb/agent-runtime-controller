---
name: ui-testing-and-debugging
description: Test and debug local browser UI design, layout and user flows with Computer Use and DevTools, then fix and retest application defects to agreed stability criteria.
---

Use `$RUNTIME_CONTROLLER_CODEX_HOME/tools/ui-testing-and-debugging` as the canonical tool directory.
Read its README.md and docs/requirements.md before browser testing. Resolve material requirements first, then use cli.mjs to gate a requirement contract and freeze a run. Load the computer-use skill for GUI control and permissions.

Read docs/testing.md for visual/interaction checks and docs/debugging.md for DevTools network payload/response, console diagnosis and the correction/retest loop. Keep shared testing/debugging Markdown and run evidence under the tool directory. Use a source revision and complete viewport/scenario matrix. Record observed outcomes with cli.mjs; repeat until scoped stability or a concrete blocker. Report local automation separately from visible Computer Use evidence.

When recording or demonstrating actions with the optional blue pointer, read docs/pointer.md in the tool directory. Prefer verified screenshot coordinates for highlighted clicks/drags; index-only actions cannot be located faithfully. Distinguish enhanced frames from raw visual evidence, and report the native-preview/reconnection limitations.
