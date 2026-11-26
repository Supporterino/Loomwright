## Why

The full-suite phase gates the repo checkout the change's tasks have merged into, but only task worktrees install dependencies. After a task changes `package.json` or the lockfile and merges, that checkout keeps its old `node_modules`, so the full suite fails on code that is fine. The suite-fix task then gets a freshly installed worktree, sees green, and correctly refuses to write outside it, so the run burns its two suite rounds and pauses with nothing an agent could have fixed.

A full-suite pause also writes no `.factory/reports/<id>-paused.md`: only the implementing phase calls `writePauseReport`, so the failing output stays in the run state instead of a file a human can read.

## What Changes

- The full-suite phase installs the repo's dependencies in the checkout it is about to gate (`p.repoDir(repo)`) before `runGates` runs there, reusing the task worktrees' installer (shared caches, frozen-lockfile commands) and its `install.*` progress events.
- The install runs on every full-suite pass, so a lockfile change merged by a suite-fix round is picked up too.
- An install failure pauses the change without running gates, without adding a suite-fix task and without spending a suite round; the reason names the repo and the installer detail.
- A pause in the full-suite phase now writes `.factory/reports/<id>-paused.md`, and the report carries a `## Full suite: <repo>` section with the captured output of every repo whose last full-suite result failed.
- `writePauseReport` takes the scheduler's `RunSummary` as optional and derives the task tallies from the run state when the scheduler did not produce one; next steps no longer offer `retry --task` when no task failed.
- Documentation: a new ADR, the decisions index, the install paragraph in `ARCHITECTURE.md` and the `gate` section of `docs/cli.md`.

## Capabilities

### New Capabilities

- `full-suite-execution`: installing dependencies in the checkout the full suite gates, how an install failure pauses, and the pause report a full-suite pause writes.

### Modified Capabilities

- none

## Impact

- Repo: `loomwright` (`packages/core/src/pipeline/finish.ts`, `drive.ts`, a new `pipeline/install.ts`, a small refactor of `implement.ts`).
- Public surface: no CLI flag or exit code change; `fullSuite` gains a structured result, but it is internal.
- Contracts: none configured; no protocol, event-schema or run-state schema change (the `install.*` events and `run.fullSuite` already exist).
- Data: no migration. `run.fullSuite` keeps its shape; install failures are recorded in `pausedReason`, not as gate results.
- Tests: unit tests for the shared install path, the full-suite install/ordering and the pause report, plus an end-to-end test with a stubbed `bun` that proves a stale checkout no longer burns suite rounds.
- Release: a changeset is required for the `packages/` edits.
