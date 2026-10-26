# Computer Use testing procedure

Load the Computer Use skill and follow applicable permissions. One agent controls the browser at a time. Read [requirements](requirements.md), complete the CLI gate, and start a run. Reuse a verified server or start the declared project command. Open a new Chrome tab for a separate task. Call get_app_state once per assistant turn before interacting and refresh state after navigation or layout changes. Select live accessibility elements; use screenshot coordinates only when needed. Inspect before each action and verify its outcome afterward.

## Design and layout

Use Chrome DevTools responsive device mode to set each exact width/height from the contract; verify the dimensions displayed. Capture and inspect desktop/mobile screenshots. Compare the supplied design; if absent use recorded heuristics. Inspect component alignment, baseline/grid consistency, spacing, text wrapping/readability, contrast, target sizes, clipping, overlap, scroll behavior, horizontal overflow, fixed/sticky layers, zoom and relevant breakpoints. Inspect default, hover, focus, active, disabled, loading, error and success states where present. Use Elements/Computed and box-model views to diagnose dimensions, margins, padding, flex/grid alignment and stacking. Visibility in an accessibility tree does not prove visual alignment.

## Flow and interaction

For every scenario restore its declared starting state. Exercise mouse/touch where applicable, keyboard Tab/Shift-Tab, Enter/Space, navigation/back/reload, repeated or rapid activation and reset/persistence behavior. Cover relevant happy paths and validation/empty/loading/error/recovery paths. Verify visible outcomes and state transitions, not just successful clicks. Check accessible names, semantic controls, focus visibility/order, live feedback and keyboard traps; limited checks do not establish comprehensive accessibility compliance.

Keep DevTools Console and Network capture active during reproduction using [debugging](debugging.md). Do not generate artificial production errors. Supplement with focused unit/integration/browser automation where useful, clearly separating automated results from Computer Use observations. Playwright is optional diagnostic supplementation, never an undisclosed replacement for a blocked Computer Use run.

## Evidence and repeat

Save screenshots when persistence is available; otherwise save sanitized observations with exact URL, viewport, observed labels/values, action sequence, expected/actual outcome and why screenshot persistence was unavailable. Do not store full browser trees containing unrelated personal information. Add one cycle result per scenario/declared viewport. PASS requires observation; FAIL requires reproduction detail; BLOCKED needs prerequisite and recovery; NA needs a feature-specific justification. Use evidence paths relative to the run directory. Read [debugging](debugging.md) for the fix/retest loop. Record each cycle with `record`; use `status` to report scope-limited stability.

Computer Use accessibility activation can invoke a button without moving DOM keyboard focus. For keyboard scenarios, click blank page content through visible coordinates and use Tab to reach the control; verify the reported focused element and visible outline before Enter/Space. If a numeric DevTools field does not retain a value via set_value, click the field, select its contents, type, commit with Tab, and verify the displayed dimensions. Refresh live state after a tool reports that the app changed; do not reuse stale indexes.
