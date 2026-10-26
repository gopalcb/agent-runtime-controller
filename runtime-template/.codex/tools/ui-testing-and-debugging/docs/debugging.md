# Computer Use debugging and stabilization

Start with clear [requirements](requirements.md) and a reproducible observed failure. Capture expected versus actual behavior, URL/viewport, time, start data and minimal action sequence. Keep a defect list with severity, cause, fix and retest evidence.

## Browser diagnostics

Open Chrome DevTools through the UI (macOS Command+Option+I; Console Command+Option+J). Inspect the live state before selecting panels. Use Network and Console as appropriate; record only the relevant sanitized details.

- Network: enable capture before reproduction; use Preserve log for navigation when needed, and disable cache for a deliberate cold-load check. Inspect document/assets and Fetch/XHR, method, URL, status, initiator, timing/waterfall, blocked/failed requests, redirects and preflight/CORS. Select a relevant request and inspect Headers, Payload (query/form/JSON), Preview/Response, and Timing. Compare payload and response against the actual API contract, including content type, validation/errors and state reflected in the UI. Check missing, duplicate or out-of-order calls and cancellation/races when implicated. For WebSockets/streaming inspect messages when relevant. An empty request list is not evidence of success unless capture was active during the triggering action.
- Console: clear or delimit the reproduction, inspect error/warning counts, message, stack/source location and timing. Distinguish app failures from extension/environment noise using evidence; do not dismiss unexplained errors. Follow stacks to source and correlate with network/server logs. No console output is required for successful controls.
- Layout: inspect Elements/Computed/box model and responsive dimensions for alignment, overflow, z-index and focus issues. Use Sources breakpoints, Performance, Application/storage or accessibility inspection when the failure calls for them. Avoid unrelated data collection.

Computer Use provides screenshots/accessibility and input, not a direct network API. Use DevTools UI to see request/response bodies. If the UI cannot expose needed evidence, record BLOCKED or use an explicitly labeled supplemental browser/server diagnostic; never claim direct Computer Use payload collection. GET requests legitimately have no body; a purely local button can have no API call. Record the reason and still inspect actual asset requests. Do not replay mutating requests or submit third-party data without task authorization. Exclude cookies, credentials, tokens and personal payloads from artifacts; summarize or redact before saving.

## Fix and retest loop

1. Reproduce and gather the smallest useful visual/console/network/source evidence.
2. Trace the cause through the affected UI/API/server code. Distinguish application defects from environment failures and pre-existing out-of-scope issues.
3. Fix the underlying cause within authorized scope. Add a targeted regression test when it protects meaningful behavior; never weaken valid acceptance criteria or tests to pass.
4. Run affected local checks, restart/reload as needed, compute the new source revision and start a fresh run. Retest the defect, related journeys, console/network, and affected viewport matrix against final source.
5. Continue diagnosis, fixes and retests while actionable failures remain. After the final fix, obtain the required consecutive clean cycles, including a fresh reload/start state, with no unresolved in-scope defects.

Do not stop at the first passing click or first clean run. Do stop retrying when new evidence cannot be obtained because of a concrete external blocker, missing authorization or unresolved requirements; save a blocked result and exact next step. Never call the app stable with blocked checks. The agent performs this loop in the active task; the CLI is a journal and does not run an unattended self-modifying service.
