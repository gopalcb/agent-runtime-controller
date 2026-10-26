# UI testing and debugging entry point

Use the Computer Use tool at [$RUNTIME_CONTROLLER_CODEX_HOME/tools/ui-testing-and-debugging](../tools/ui-testing-and-debugging/README.md).
Shared testing/debugging procedures and templates are maintained there.

Before testing, read [requirements](../tools/ui-testing-and-debugging/docs/requirements.md), resolve material ambiguity and pass the CLI requirements gate. Then follow [testing](../tools/ui-testing-and-debugging/docs/testing.md) and [debugging](../tools/ui-testing-and-debugging/docs/debugging.md). Use Computer Use for browser interaction and Chrome DevTools for network requests, API payload/response and console inspection. Fix and retest until agreed stability; report concrete blockers explicitly. Optional supplementary automation must be labeled separately.

Keep task records/evidence for UI testing under the tool directory, referencing the implementation task where applicable. Existing historical project records remain in place.
