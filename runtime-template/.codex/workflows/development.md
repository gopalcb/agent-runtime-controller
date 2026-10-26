# Development workflow

## Entry and responsibilities

Use only when selected under AGENTS.md or explicitly requested for planning.
Handle questions and clear, localized, low-risk changes directly.

Resolve RUNTIME_CONTROLLER_CODEX_HOME from the environment. Before maintaining task records,
read $RUNTIME_CONTROLLER_CODEX_HOME/references/task-records.md.

The main agent plans, implements, verifies, and maintains records in the same
conversation. Load $RUNTIME_CONTROLLER_CODEX_HOME/skills/plan-development/SKILL.md for planning,
then $RUNTIME_CONTROLLER_CODEX_HOME/skills/implement-development/SKILL.md for implementation.
Keep stage transitions, material findings, and verification outcomes visible
in the main conversation. Activity logs supplement these updates.

Delegate when explicitly requested, required by applicable instructions, or
justified by the task-based model/effort routing rules in AGENTS.md. Keep routine
work direct when delegation has no clear benefit. The main conversation still
owns planned stages and final integration. When registered and available, the provided role templates offer bounded
assistance; planner-agent and builder-agent load the same stage skills.
Role files are templates, not automatic registration or model entitlement.
Include absolute project/plan paths, context, constraints, and explicit file
ownership in handoffs. Only one agent edits a given file, including documentation.
The main agent owns records and shared indexes unless one index is explicitly
assigned to a builder. Preserve concurrent work and coordinate ownership changes
through the main agent. A delegated planner remains read-only and returns its
plan and milestones for the main agent to save and log. Keep dependent stages
sequential. If requested delegation is unavailable, perform the stages in the
main thread and report the limitation.

Respect scope and permissions; proceed without routine confirmation.
Resolve genuine blockers, otherwise document reasonable assumptions.
For planning-only requests, deliver the plan and stop.

## Verification

Always inspect the final diff. Match verification to the change:
inspection for documentation/non-behavioral edits, focused checks for
configuration, targeted tests for behavior, and browser checks for UI
behavior or styling.

Use existing tooling. Avoid unrelated suites and redundant reruns.
Record deferred, unavailable, or blocked checks; never mark them passed.

## 1. Plan

1. Load plan-development and analyze the request in the main thread.
2. Inspect applicable instructions, code, tests, and .codex/project.toml
   when present. Resolve manifest paths from the project root; consult
   relevant docs, examples, and index sections. Verify against current code.
3. Reuse established approaches. Research missing or insufficient approaches,
   unstable external facts, or explicit user requests.
4. Identify affected code, verification, and necessary documentation updates.
   For UI work, include browser scenarios, expected outcomes, and viewports.
5. Review requirement coverage, actionable tasks, observable acceptance
   criteria, and proportionate verification. Resolve material omissions.
6. Save reviewed plan.md; set summary.md to "Planned".

## 2. Implement and verify

1. Load implement-development and execute the reviewed plan in the main thread.
   Set summary.md to "In progress".
2. Implement, verify acceptance criteria, and maintain affected documentation,
   manifest entries, and indexes using the rules below.
3. Record minor deviations. Revisit planning for material scope or approach
   changes, revise plan.md, then resume.
4. For UI verification, follow $RUNTIME_CONTROLLER_CODEX_HOME/workflows/ui-testing.md.
   Report affected verification as blocked if the file or tools are unavailable.

## 3. Resolve failures

Investigate actionable failures in the main thread. Fix introduced issues and rerun
affected checks; distinguish pre-existing and environmental failures.
Never weaken valid tests or criteria to obtain a pass. Continue until criteria
are met or a concrete blocker remains; stop retries that yield no new progress.

## Documentation and indexes

Update only affected guidance: architecture for structural/data-flow changes,
development docs for setup/usage/command changes, and source docstrings for
changed contracts.

Regenerate existing indexes when indexed paths, definitions, signatures,
or docstrings change, including additions, renames, and deletions.
Do not edit generated content manually or duplicate source details.
Report missing indexing tools; implement them only when in scope.
Reuse existing files and tools; avoid unrelated updates and broad rewrites.

## Project manifest

Create <project>/.codex/project.toml only when useful and in scope, using
$RUNTIME_CONTROLLER_CODEX_HOME/assets/templates/project.toml. For planning-only requests,
propose changes without writing them.

Use verified details, project-relative paths, examples, and existing commands.
Omit unused entries and secrets. Preserve unrelated settings; update affected
entries and remove confirmed obsolete references.

Include optional UI and UI startup-command sections only for browser UI projects.
Merge without duplication. Validate changed TOML and references; verify commands
against project tooling and execute only appropriate checks.
Record meaningful changes in summary.md.

## 4. Complete

1. Review the final diff and run relevant existing manifest, documentation-link,
   and index-freshness checks where affected.
2. Mark each acceptance criterion PASS, FAIL, or BLOCKED with evidence applicable
   to the final changes. Distinguish inspection, local tests, and deployed
   verification. The main agent inspects the final diff and supporting
   evidence, including any delegated work. Run
   additional checks only where the evidence is insufficient.
3. Save implementation details, verification results, deviations, documentation
   updates, blockers, remaining work, and limitations in summary.md.
   Preserve durable discoveries in authoritative project documentation.
4. Return a concise outcome, verification results, limitations, and record paths.

For browser UI testing/debugging, use $RUNTIME_CONTROLLER_CODEX_HOME/tools/ui-testing-and-debugging/README.md and its requirements gate. Computer Use is the primary browser driver; inspect DevTools network payload/response and console as needed, and fix/retest until scoped stability or a concrete blocker. Keep shared UI testing/debugging Markdown and UI run records under that tool directory; workflows/ui-testing.md remains the entry point.
