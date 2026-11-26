# install-deps-before-full-suite: done

When a task changes package.json or bun.lock and merges, the factory's full-suite gate in finish.ts runs against the main checkout without running installDeps first, so the root node_modules stays stale forever. The suite-fix agent then gets a freshly installed worktree, sees green results, and correctly refuses to write outside its own worktree, burning MAX_SUITE_ROUNDS = 2 and pausing the run. The requester wants finish.ts (or the full-suite path) to install dependencies in the main checkout before running runGates there, so the root state matches the merged lockfile. Secondary ask: a full-suite pause should write a .factory/reports/<id>-paused.md with the failing output, since only the implementing branch currently calls writePauseReport, leaving the run record without the failure details on disk.

## Branches (local only; nothing was pushed)

- loomwright: `change/install-deps-before-full-suite` at 59a0b60ce7f2 (8 commits)
- AI repo: `change/install-deps-before-full-suite` (archive commit 59a0b60ce7f2)

## Tasks

- [x] 1.1 (loomwright, task): Share the install-with-progress path between task worktrees and the full suite — 1 failed attempt
- [x] 1.2 (loomwright, task): Install in the gated checkout before the full-suite gates
- [x] 1.3 (loomwright, task): Write the pause report for full-suite pauses, with the failing output, and name it in the stop detail
- [x] 1.4 (loomwright, task): Cover the stale-checkout loop end to end
- [x] 1.5 (loomwright, task): Record the ADR, the architecture note and the `gate --full` clarification
- [x] 1.6 (loomwright, task): Add the changeset
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test

## Spec

Archived as `openspec/changes/archive/2026-11-26-install-deps-before-full-suite`.

## Review findings

- review:loomwright: [nice] packages/core/test/full-suite.test.ts:147 The spec requirement also covers installer failure: install.started then install.failed with step and repo both set to the repo name. Only installFor's own test covers install.failed, with a task id as step; a regression that drops or mislabels the failure event on the full-suite path would pass this suite.

## Risks and things not checked

- intake: Chose 'install-deps-before-full-suite' as the id; it names the primary fix but not the secondary pause-report gap.
- intake: No source was read; the file paths and constants (MAX_SUITE_ROUNDS, suiteRounds, implement.ts, finish.ts, writePauseReport) come from the request text only.
- intake: The scope split between pipeline/ and any report-writing helpers is unverified.
- design: Shell was unavailable in this session, so I could not run `openspec validate`, graphify queries or the test suite; the change is grounded in direct reads of finish.ts, drive.ts, install.ts, run.ts, scheduler.ts, fixtures and the archived specs.
- design: The install now writes into the gated checkout (ignored files such as Helm charts or .venv) and adds real time on the first full-suite pass; caches only help repeats.
- design: `loomwright gate --full` still reports a stale checkout; left out of scope deliberately and documented.
- design: Historical ADR-0024 text about worktree-only installs is left untouched per the monorepo-layout spec; ADR-0053 supersedes it and ARCHITECTURE.md is updated.
- design: The e2e test relies on a temporary `bun` stub at the front of PATH, matching the existing fixtures/bin pattern; it must restore PATH to avoid leaking into later tests in that file.
- design: Submodule-layout coverage is only via the per-repo unit path; the e2e test uses the single layout.
- context-packs: The shell and graphify tools were denied in this session, so the packs come from direct file reads plus grep/glob rather than graph queries; all line ranges are hints and every quoted excerpt was read from the current tree.
- context-packs: The 1.3 drive-level recipe (writing .factory/approvals/<id>.json by hand with specHash + HEAD as specCommit so verifyApproval passes) is the least-proven part; if it turns brittle, the report-content assertions still stand and the stop-detail shape can follow pipeline-events.test.ts:182.
- context-packs: 1.4's second test (install failure pauses and names the report) goes slightly beyond the task title but keeps the spec's pause-report naming covered end to end; it depends on `cmp`, gitignored node_modules and macOS real-path normalisation.
- context-packs: The 1.4 stale-checkout proof relies on a task editing bun.lock and on isGeneratedLockfile letting the task commit keep it; if the scope audit rejects the lockfile edit, the task should edit a manifest and lockfile pair instead.
- context-packs: 1.6 sets a patch bump for @loomwright/core and @loomwright/cli; if the maintainer wants a different semver level, only that fragment changes.
- 1.5: The ADR references packages/core/src/pipeline/install.ts and PipelineDeps.install from tasks 1.1-1.3; those are not in this worktree, so docs-only gates cannot verify the identifiers exist.
- 1.5: Full bun run check passed (1839 pass, 11 skip). No tests were added or changed, per the task's 'no code and no tests change'.
- 1.5: Historical ADR-0024 was left untouched; ADR-0053 records that it supersedes the worktree-only-install sentence.
- 1.1: Did not run the full `bun run check` (several-minute suite); ran the affected set twice (105 pass), scheduler + cli pipeline (55 pass), the new install suite, tsc and biome.
- 1.1: The per-test timeout is a Bun runner workaround; it can be removed once the preload timeout bug no longer applies.
- 1.1: Attempt 1's failure was not reproducible in two exact-command reruns; it was the 5 s per-test timeout, not an install-path regression.
- 1.2: No changeset added: the task's edit scope covers only finish.ts/drive.ts/test files, and changeset generation is a repo convention handled outside this task.
- 1.2: With multiple repos the installFailures order follows Promise.all completion order, so the joined pause reason can vary between identical runs; not asserted by the spec.
- 1.2: Install failures are asserted at the fullSuite level only; the drive pause report/stop detail is deferred to task 1.3 as instructed.
- 1.3: No changeset added: the task's edit scope excludes .changeset files, but repo convention asks for one for packages/ changes; a human may want to add it.
- 1.3: Drive-level tests run a real sh gate command and the fixture's lockfile detection; they do not touch the network (no lockfile in the fixture, verified by existing full-suite tests).
- 1.6: bunx changeset status still exits 1 in this worktree with a pre-existing mixed ignored/not-ignored packages error that also hits the existing fragments; .changeset/config.json is untouched and the maintainer owns releasing.
- 1.6: Did not run the full bun run test suite; only the changeset/docs-related suites and typecheck/lint/format.
- 1.4: I did not run the new test against pre-1.2 code; the failure mode follows from the full-suite `test` gate seeing the stale `node_modules/.lock`, but it was not simulated directly.
- 1.4: No changeset was added because this task changes only a test file.
- review:loomwright: Not checked: could not run git diff or any test/gate (shell denied); verification is by reading code, fixtures and the run log, not by execution.
- review:loomwright: The submodule layout's real install is not exercised end to end: both golden fixtures have no lockfile, so their full-suite install reports 'skipped'. Only the single-layout e2e runs a stubbed bun install in the gated checkout.
- review:loomwright: Golden event fixtures, checkpoints and baseline stdout were recaptured by the implementer; if the capture and the code drift, events-golden.test.ts fails - the gate will tell.
- review:loomwright: With several failing installs the joined pause reason order follows Promise.all completion, so the reason text can vary between identical runs (not asserted).
- review:loomwright: A stale failing repo keeps its ## Full suite section beside a newer install-failure reason, because the report renders the last recorded result (intended by the spec).
- test-loomwright: No new tests were added because the scenarios already had passing coverage; the only changes on the branch are from earlier commits.
- test-loomwright: The full-suite requirement clause about emitting install.failed on a failed full-suite install is asserted at the installFor level in packages/core/test/pipeline-install.test.ts, but not directly inside a fullSuite test; none of the listed scenarios requires that event assertion.

## Usage

Total: 36.74M tokens (35.36M cache read, 106.2k out) · cost n/a over 13 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| implementer-loomwright | 16.55M | 45% | cost n/a |
| architect | 10.39M | 28% | cost n/a |
| reviewer | 7.32M | 20% | cost n/a |
| explorer | 1.85M | 5% | cost n/a |
| tester | 621.9k | 2% | cost n/a |
| orchestrator | 9.8k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| context-packs | 7.46M | 20% | cost n/a |
| review:loomwright | 7.32M | 20% | cost n/a |
| 1.4 | 6.71M | 18% | cost n/a |
| 1.1 | 3.92M | 11% | cost n/a |
| 1.2 | 3.07M | 8% | cost n/a |
| design | 2.92M | 8% | cost n/a |
| explore:loomwright | 1.85M | 5% | cost n/a |
| 1.3 | 1.59M | 4% | cost n/a |
| 1.5 | 944.5k | 3% | cost n/a |
| test-loomwright | 621.9k | 2% | cost n/a |
| 1.6 | 314.2k | 1% | cost n/a |
| intake | 9.8k | 0% | cost n/a |

Top consumers: context-packs (7.46M), review:loomwright (7.32M), 1.4 (6.71M), 1.1 (3.92M), 1.2 (3.07M).
Retry overhead: 2.69M tokens (7%).
Wasted re-reads of unchanged files: 48.
