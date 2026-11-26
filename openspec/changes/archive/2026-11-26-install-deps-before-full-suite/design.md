## Context

`finish.ts::fullSuite` runs `runGates` in full mode against `p.repoDir(repo)` — for the single layout the workspace root, for submodules the checkout tasks merged into. Installs only happen in task worktrees (`implement.ts::attempt` → `installDeps`, then `quick.ts`), so after a merged lockfile change the gated checkout keeps stale `node_modules`. The failing full suite creates a `suite-<repo>-<n>` task; its worktree installs from the new lockfile, the agent sees green and refuses to write outside its worktree, and the change pauses after `MAX_SUITE_ROUNDS = 2` with no fix possible.

Separately, `drive.ts` calls `writePauseReport` only on the implementing path (`:290`, `:298`); the full-suite branch (`:346-356`) pauses without a report, so the failing output exists only in `run.fullSuite` and `pausedReason`. `writePauseReport` takes a `RunSummary` that only the scheduler produces, and it renders failed tasks' `lastGateOutput`, never `run.fullSuite`.

## Decisions

1. **Install at the start of each repo's full-suite gate pass, in `finish.ts`.** Inside the existing `p.gates.run(...)` callback, install in `p.repoDir(repo)`, then call `runGates` on success. Rejected: installing inside `runGates` — `runGates` also serves `loomwright gate --full`, contract gates and land, and a diagnostic command must not rewrite a user's `node_modules`. Rejected: installing once per change — a suite-fix round can merge another lockfile change. Rejected: detecting a changed lockfile to skip installs — needs new state, and a crash can leave it wrong; installs are idempotent and cached.
2. **Share one install-with-progress path with the task worktrees.** A new `pipeline/install.ts` exports `installFor(p, step, repo, dir)`, which calls `p.deps.install ?? installDeps` and emits/prints `install.started`/`finished`/`failed`. `implement.ts::attempt` uses it with `step = task.id`; `fullSuite` uses it with `step = repo name`, matching the full-suite gate events' step and the TUI's repo scoping. `PipelineDeps.install` is a test seam in the style of `runtime`, `now` and `ask`. Rejected: a second copy of the event wiring in `finish.ts`, which would drift from the task path.
3. **An install failure is infrastructure, not a suite failure.** No gates run, no suite-fix task is created, `suiteRounds` does not move, and `run.fullSuite` stays untouched, so `status` does not show a fake gate failure. `fullSuite` returns `{ failing, installFailures }` and the driver builds a reason naming the repo and the install detail. This mirrors the §9 rule that install time and failures never count against a retry budget: a suite-fix agent cannot fix a registry outage.
4. **The pause report's summary becomes optional.** `writePauseReport(p, id, summary?)` derives the merged/failed/cancelled/pending lists from the run state when the scheduler did not supply them, so the full-suite branch can call it without manufacturing a `RunSummary`. The scheduler's adjusted summary still wins on the implementing path, where routed spec fixes change the failed list.
5. **The report reads `run.fullSuite`.** A `## Full suite: <repo>` section is emitted for every entry with `passed: false`, using the already-compacted captured output in a fence. Entries that passed are omitted, so a stale failure from an earlier round does not resurface. Next steps offer `retry --task` only when a task actually failed, and always offer `resume`.
6. **No protocol, event or run-state schema change.** `install.*` events and `run.fullSuite` already exist; the only new persisted value is the paused reason text.
7. **`loomwright gate --full` keeps today's behaviour.** It gates a checkout the user controls and stays read-only with respect to dependency state; `docs/cli.md` says so. The pipeline fixes its own checkouts.

## Contract changes

None. No API schema, event payload or config key changes.

## Risks

- The install now writes into the user's repo checkout: it can create ignored files (for example `charts/` for Helm, `.venv` for uv) and takes one install per full-suite pass. Shared caches keep repeats cheap, but the first install is a real cost.
- A registry outage pauses at the full-suite phase; the reason says resume, and the report repeats the install detail. There is no automatic retry, by design.
- The report renders the last recorded full-suite result. A crash between the gate run and the `run.update` can leave the section missing or stale; the reason line still names the phase's failure.
- ADR-0024 and the older `ARCHITECTURE.md` sentence describe worktree-only installs. Historical ADR text stays untouched per the monorepo-layout spec; ADR-0053 records the change and `ARCHITECTURE.md` is updated.
- End-to-end coverage uses the single layout with a stubbed `bun`; the submodule layout is covered only by the per-repo unit path.
- Tests that run the full suite now need the install step to be harmless: fixtures without a lockfile stay skipped, and any new fixture with a lockfile must stub the package manager instead of reaching the network.
