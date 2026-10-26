# Task records

Create records for planned development and explicit checkpoint requests.
Do not create them automatically for questions or small direct changes.

## Location

<project>/docs/tasks/<YYYY-MM-DD-task-title>/

- plan.md
- summary.md

Use a short lowercase title with hyphens. Reuse the folder for the same task;
avoid collisions with unrelated tasks. For cross-project work, select one owning
project and list all affected projects.

## plan.md

Include:

- Task title and summary.
- Scope and exclusions.
- Analysis and proposed approach.
- Research findings when needed.
- Ordered implementation tasks with IDs.
- Expected end results.
- Numbered acceptance criteria.
- Verification plan: tests or other appropriate checks.
- Assumptions, risks, and blockers.

Keep detail proportional to the task. Identify intentional testing deferrals
and how affected behavior will eventually be verified.

## summary.md

Maintain:

- Current status: Planned, In progress, Complete, or Blocked.
- Completed and remaining task IDs.
- Implementation and changed files.
- Decisions and plan deviations.
- Acceptance-criteria status and evidence.
- Checks performed, results, limitations, and unverified behavior.
- Blockers and exact next steps.
- Relevant documentation, manifest, and index updates.
- Verified reusable discoveries when relevant.

Update at meaningful milestones, preserving useful evidence while replacing
outdated status. Distinguish verified facts from assumptions. Do not copy entire
conversations or logs into these records.