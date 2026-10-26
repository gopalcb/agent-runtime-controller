# UI testing and debugging

Computer Use is the primary browser driver. Codex reads the screen/accessibility tree, operates Chrome and DevTools, fixes source defects, and repeats verification. The Node CLI gates requirements and records observed evidence; it does not autonomously operate a browser, inspect pixels, or fix code. No extra npm dependencies are needed (Node 22).

Read [requirements](docs/requirements.md) before testing, then [testing](docs/testing.md) and [debugging](docs/debugging.md). All shared UI testing/debugging procedures, templates, task records and example run evidence live here. Project-specific setup stays with its application; historical records stay at their original paths.

From this directory:

```bash
node cli.mjs init runs/draft
# Edit runs/draft/requirements.json until requirements are clear.
node cli.mjs check runs/draft/requirements.json
node cli.mjs start runs/my-run runs/draft/requirements.json
# Operate Computer Use using docs/testing.md and docs/debugging.md.
# Save inspected screenshots/sanitized observations under runs/my-run/artifacts/.
# Copy templates/cycle.json; supply every scenario x its listed viewports.
node cli.mjs record runs/my-run runs/my-run/observed-cycle.json
node cli.mjs status runs/my-run
node --test tests/*.test.mjs
```

Exit codes: 0 for DRAFT/READY/STABLE, 1 for invalid input/I/O, 2 for a valid run that is not yet stable. DRAFT and READY are requirements states, not browser readiness or test passes. `start` freezes requirements in run.json; cycle files are created exclusively and never overwritten by the CLI. Keep one journal writer. Update the source revision after every fix and start a new run; repeat the full affected matrix. Use a source digest when no Git repository exists. Do not edit run.json or cycle files to alter results.

Stability requires at least two consecutive complete clean cycles for one requirement fingerprint and app revision, evidence files for every result, no unresolved defects and no blocked checks. The latest failure/blocker overrides previous passes. This is stability within the agreed scope, not a guarantee of all possible application behavior. Evidence is agent attestation: the CLI validates structure and file existence, not the truth of the observation. Do not mark a check PASS until its expected result was observed. N/A needs a specific reason and is not a substitute for an unavailable tool.

The saved status describes the recorded revision. `status` does not hash the current application or monitor later changes: the agent must verify the source digest/commit still matches before using historical results. Observation timestamps must increase, so submitting the same cycle twice is rejected. The skill is shipped under $RUNTIME_CONTROLLER_CODEX_HOME/skills/ui-testing-and-debugging; the installer also copies it into project .agents/skills for native discovery, preserving existing files.

For a bright blue desktop pointer and enhanced Computer Use recording frames, see [pointer controls and recording](docs/pointer.md). Run `node pointer/pointer.mjs on` from this directory. The overlay is optional. The wrapper requires a separately installed native Computer Use MCP and explicit manual configuration; see docs/pointer.md.
