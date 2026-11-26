## ADDED Requirements

### Requirement: The full suite installs dependencies in each checkout before its gates

Before `runGates` runs in full mode for a repo, the full-suite phase SHALL run that repo's lockfile install in the checkout it is about to gate (`p.repoDir(repo)`), through the same installer the task worktrees use: the same shared caches, credential-scrubbed environment and frozen-lockfile commands. The install SHALL run once per repo on every full-suite pass, so a lockfile change merged by a suite-fix round is installed too. A repo with no matching lockfile SHALL be skipped for that directory and its gates SHALL still run. When any install step fails, the repo's gates MUST NOT run, no suite-fix task SHALL be added, `suiteRounds` MUST stay unchanged, `run.fullSuite` MUST NOT record a gate result for that repo, and the phase SHALL pause with a reason naming the repo and the installer's detail. When the run's event stream is bound, the install SHALL emit `install.started` and then `install.finished` or `install.failed` with `step` and `repo` both set to the repo name, before that repo's first gate event; an unbound pipeline SHALL print the same progress lines directly.

#### Scenario: a merged lockfile change is installed before the gates run

- **WHEN** a change whose tasks merged a `bun.lock` update reaches the full-suite phase for repo `app`
- **THEN** the lockfile install runs in `app`'s checkout before the first gate of that repo
- **AND** the gates start only after a successful install
- **AND** the run records `app`'s full-suite result as before

#### Scenario: a repo without a lockfile keeps running its gates

- **WHEN** a code repo has a `package.json` but no `bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `yarn.lock` or `package-lock.json`
- **THEN** the install reports a `skipped` step for that directory
- **AND** the full-suite gates still run

#### Scenario: an install failure pauses without spending a suite round

- **WHEN** the full-suite install exits non-zero for repo `app`
- **THEN** no gate runs in `app`
- **AND** no `suite-*` task is added and `suiteRounds` keeps its previous value
- **AND** the run pauses with a reason naming `app` and the install detail
- **AND** `run.fullSuite.app` is not written

#### Scenario: every full-suite pass installs again

- **WHEN** a suite-fix round merges another lockfile change and the change enters the full-suite phase again
- **THEN** the install runs again in the checkout before the gates
- **AND** the previous pass's install does not satisfy the new pass

#### Scenario: install progress is attributed to the repo

- **WHEN** the full-suite install starts and finishes for `app` with the run's event stream bound
- **THEN** the stream contains `install.started` and `install.finished` with `step: "app"` and `repo: "app"`
- **AND** both appear before the first `gate.started` event for `app`

### Requirement: A pause in the full-suite phase writes the pause report

When the full-suite phase pauses — the suite still failing after `MAX_SUITE_ROUNDS`, or a dependency install failure — the driver SHALL write `.factory/reports/<id>-paused.md` before it stops, and the stop detail SHALL name that file. `writePauseReport` SHALL accept a scheduler `RunSummary` as an optional argument and SHALL derive the merged, failed, cancelled and pending lists from the run state when it is absent. The report SHALL keep the reason and the task tallies, and SHALL add a `## Full suite: <repo>` section for every repo whose last recorded full-suite result has `passed: false`, containing that result's captured output in a fenced block. A repo whose latest result passed MUST NOT get a section. When the run has no failed task, the "Next steps" section MUST NOT contain the `loomwright retry <id> --task <task>` line and MUST still name `loomwright resume <id>`. A pause in the implementing phase SHALL keep the content it has today.

#### Scenario: the suite round cap still writes the report

- **WHEN** `suiteRounds` is 2 and the full suite fails in `app` again
- **THEN** the run pauses with `full suite still failing in app`
- **AND** `.factory/reports/<id>-paused.md` exists
- **AND** it contains `## Full suite: app` and the failing gate output
- **AND** the stop detail names that file
- **AND** `suiteRounds` stays 2

#### Scenario: an install-failure pause writes the report

- **WHEN** the full-suite install fails in `app` and the phase pauses
- **THEN** the report exists
- **AND** its reason names `app` and the install detail
- **AND** its next steps name `loomwright resume <id>` and no `retry --task` line

#### Scenario: only failing repos get a full-suite section

- **WHEN** `app` failed and `web` passed in the last full-suite pass
- **THEN** the report has a `## Full suite: app` section
- **AND** it has no `## Full suite: web` section

#### Scenario: a stale failure that later passed is not shown

- **WHEN** `app` failed in the first full-suite round and its latest recorded result passed
- **THEN** the report has no `## Full suite: app` section

#### Scenario: a task-failure pause keeps its task sections

- **WHEN** implementation pauses on failed task `1.1` with gate output
- **THEN** the report still lists `- Failed: 1.1`
- **AND** it contains the task's gate output
- **AND** its next steps still offer `loomwright retry <id> --task <task>`
