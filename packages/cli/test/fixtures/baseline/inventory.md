# Baseline inventory: progress prints and run-state control

Captured by task 1.1 of `add-typed-event-stream`, before any production edit. Line numbers are
hints from the baseline tree; the file and symbol names are the contract.

Reproduce the goldens and this inventory:

```bash
bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts
bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts --out /tmp/baseline-2
diff -r packages/cli/test/fixtures/baseline /tmp/baseline-2
```

`thresholds.json` is a one-time measurement; regenerate it deliberately with
`bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts --thresholds`. A plain
capture reuses the committed document, so it cannot lower the recorded pass count.

The scenario capture pins `parallel.maxAgents` and `parallel.maxGateProcesses` to 1 and chains
the task list, so the two captured runs print in one order. The submodule scenario still builds
all three submodules and bumps the touched one's pointer; only the backend is edited, so the
full-suite lines cannot interleave between repos. Parallel scheduling stays covered by
`packages/cli/test/pipeline.test.ts`.

Each `*.stdout.txt` and `*.stderr.txt` is the calls of one scenario in order, each behind a
`===== <call> (exit <code>) =====` banner; `<kind>.exit.txt` is the exit code of the last call.
JSON documents are re-serialised with sorted keys so map iteration order cannot leak, and usage
token/cost values are the `<tokens>` / `<cost>` placeholders; compare parsed values, not raw
layout or those numbers.

## 1. `Progress` methods

Source: `packages/core/src/pipeline/progress.ts::Progress`. `normal` means the method prints
unless verbosity is `quiet`; `unconditional` prints in every mode.

| Method                                                                        | Gate                                                                                                                                                | Icons and width constants                                                                                                       |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `line(text)`                                                                  | unconditional                                                                                                                                       | none; raw line                                                                                                                  |
| `note(text)`                                                                  | normal                                                                                                                                              | none; caller supplies `⚙`                                                                                                       |
| `agentStarted(input)`                                                         | normal                                                                                                                                              | `ICON.start` (`▶`), `TITLE_MAX = 60`, `attempt/<maxAttempts>`                                                                   |
| `agentFinished(end)`                                                          | normal                                                                                                                                              | `ICON.ok` / `ICON.stop` / `ICON.fail` (`✓ ⊘ ✗`), `DETAIL_MAX = 100`, duration + tokens                                          |
| `activity(step, activity)`                                                    | normal; tool lines verbose                                                                                                                          | `ICON.warn` (`!`), `ICON.fail` (`✗`), `ICON.tool` (`·`, verbose only), `DETAIL_MAX = 100`, `describeTool` cap                   |
| `gate(step, event, stage)`                                                    | normal                                                                                                                                              | plan/start `ICON.gate` (`⚙`), `GATE_ICON` (`✓ – ✗`), `SLOW_GATE_MS = 10_000`, command capped at 70                              |
| `gatesDone(step, report, durationMs, stage)`                                  | normal                                                                                                                                              | `ICON.ok` / `ICON.fail` (`✓ ✗`)                                                                                                 |
| `install(step, repo, phase, durationMs, detail)`                              | normal                                                                                                                                              | `ICON.gate` / `ICON.fail` / `ICON.ok`, `SLOW_GATE_MS = 10_000`, `DETAIL_MAX = 100`                                              |
| `task(event)`                                                                 | mixed: `failed`, `merged`, `conflict`, `requeued`, `transient`, `interrupted` unconditional; `started` silent; `retry`, `merging`, `waiting` normal | `ICON.retry` (`↻`), `ICON.fail`, `ICON.merge` (`⇢`), `ICON.ok`, `ICON.warn`, `ICON.stop`, `ICON.wait` (`…`), `DETAIL_MAX = 100` |
| `implementSummary(counts, elapsedMs)`                                         | unconditional; silent when `total === 0`                                                                                                            | none                                                                                                                            |
| `tick()`                                                                      | normal                                                                                                                                              | `ICON.wait`, `HEARTBEAT_MAX = 220`                                                                                              |
| `#startHeartbeat()` / `#stopHeartbeat()` / `#stopHeartbeatIfIdle()` (private) | internal                                                                                                                                            | `DEFAULT_HEARTBEAT_MS = 30_000`; timer is `unref`ed                                                                             |
| `stop()`                                                                      | internal                                                                                                                                            | clears sessions, gates and installs                                                                                             |
| `setChangeId(id)`, `now()`, `verbosity` getter                                | no output                                                                                                                                           | none                                                                                                                            |

Shared constants: `ICON` map, `SLOW_GATE_MS`, `DETAIL_MAX`, `TITLE_MAX`, `HEARTBEAT_MAX`,
`DEFAULT_HEARTBEAT_MS`, `GATE_ICON`.

## 2. Every `Progress` call site

| Site (file::symbol)                                          | Methods                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline/context.ts::Pipeline.#call`                        | `activity` (:175 via `onActivity`), `agentFinished` (:188 open failure, :209 finish), `agentStarted` (:197); `progress.now()` for durations |
| `pipeline/finish.ts::review` (`:54`)                         | `gate` (:211 via `onGate`), `gatesDone` (:213)                                                                                              |
| `pipeline/finish.ts::close` (`:338`)                         | `note` (:358 pointers), `note` (:377 archive)                                                                                               |
| `pipeline/implement.ts::PipelineTaskRunner.#gates` (`:285`)  | `gate` (:299), `gatesDone` (:301), `progress.now()`                                                                                         |
| `pipeline/implement.ts::PipelineTaskRunner.attempt` (`:371`) | `install` (:384 start, :389 failed, :401 done), `progress.now()`                                                                            |
| `pipeline/implement.ts::implement` (`:643`)                  | `setChangeId` (:647), `task` (:677 via scheduler `observe`), `implementSummary` (:695), `progress.now()`                                    |
| `pipeline/quick.ts::quickTask` (`:48`)                       | `gate` (:134), `gatesDone` (:136), `progress.now()`                                                                                         |
| `pipeline/contracts.ts::contractPhase` (`:56`)               | `verbosity` (:69), `line` (:70 verbose contract check)                                                                                      |

`Progress` instances are created per command; `Pipeline` exposes `progress` and `out`, and
`Pipeline.update` is the only run-state write helper.

## 3. Every `p.out(...)` banner

`p.out` is `Pipeline.out` (`pipeline/context.ts`), a plain terminal write; it does not touch the
run state. `precedes` / `follows` names the nearest run-state write in the same flow: a banner
before a step that writes state precedes it, a banner that reports a completed step follows it.

| Site                                                            | Text pattern                                                        | Run-state position                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pipeline/design.ts::intake` :91                                | `▶ intake`                                                          | precedes `saveRun(newRun(...))` :135                                               |
| `pipeline/design.ts::intake` :111                               | `▶ clarify: … from intake`                                          | precedes the change's `saveRun`                                                    |
| `pipeline/design.ts::intake` :150                               | `  change <id>[ (drafted in …)]`                                    | follows `saveRun` :135                                                             |
| `pipeline/design.ts::design` :180                               | `▶ graph: building the workspace graph`                             | precedes design writes; no run-state write of its own                              |
| `pipeline/design.ts::design` :182                               | `  ! graph build failed (…): …`                                     | precedes design writes                                                             |
| `pipeline/design.ts::design` :184                               | `▶ explore: <repos>`                                                | precedes design writes                                                             |
| `pipeline/design.ts::design` :218                               | `▶ design: openspec/changes/<id>` (or `▶ adopt`)                    | precedes design writes                                                             |
| `pipeline/design.ts::design` :262                               | `▶ clarify: … from design`                                          | precedes `p.update` :270                                                           |
| `pipeline/drive.ts::drive` :257                                 | `▶ starting queued change <id>`                                     | follows `close` (which writes `phase: done`) and precedes the next change's writes |
| `pipeline/implement.ts::activate` :85                           | `⧗ <id> is queued behind <holder>`                                  | follows `p.update(phase: queued)` :82                                              |
| `pipeline/implement.ts::ensureContextPacks` :181                | `▶ context packs (<n>)`                                             | precedes `p.update(handoffs["context-packs"])` :194                                |
| `pipeline/implement.ts::PipelineTaskRunner.#claimCheckout` :273 | `  ! <owner> left work in <repo>; kept as git stash: …`             | precedes `p.update(serialOwner)` :276                                              |
| `pipeline/implement.ts::implement` :648                         | `▶ implement: <n> task(s) (max <n> agents)`                         | precedes `p.progress.setChangeId`; task writes follow                              |
| `pipeline/implement.ts::implement` :655                         | `  ! graph update failed: …`                                        | follows `p.update(graphSeq)` :659 (graph updater callback)                         |
| `pipeline/finish.ts::review` :71                                | `⚠ review round cap (<cap>) reached; …`                             | follows `p.update(reReview = [])` :70                                              |
| `pipeline/finish.ts::review` :77                                | `▶ review + tests: …` / `▶ review round <n>/<cap>: …`               | precedes reviewer `p.update(handoffs…)` :119                                       |
| `pipeline/finish.ts::review` :173                               | `⚠ review round cap (<cap>) reached; …`                             | follows `p.update(reviewRound/reReview)` :168                                      |
| `pipeline/finish.ts::review` :178                               | `  ⚐ <n> finding(s) concern the spec (not code)`                    | follows `p.update(reviewRound/reReview)` :168                                      |
| `pipeline/finish.ts::review` :182                               | `    - [<severity>] <file>[:line] <problem>`                        | follows `p.update(reviewRound/reReview)` :168                                      |
| `pipeline/finish.ts::fullSuite` :196                            | `▶ full suite: <repos>`                                             | precedes `p.update(fullSuite…)` :231                                               |
| `pipeline/finish.ts::close` :345                                | `▶ close`                                                           | precedes pointer/archive/`phase: done` writes                                      |
| `pipeline/finish.ts::close` :475                                | `  ⚙ recorded <files>`                                              | follows `p.update(phase: done)` :466                                               |
| `pipeline/finish.ts::close` :477                                | `warning: could not record artifacts (…); …`                        | follows `p.update(phase: done)` :466                                               |
| `pipeline/finish.ts::close` :483                                | `✓ <id> done — report: <file>`                                      | follows `p.update(phase: done)` :466 and `releaseActive`                           |
| `pipeline/contracts.ts::contractPhase` :61                      | `▶ contracts: none touched`                                         | no write before return                                                             |
| `pipeline/contracts.ts::contractPhase` :65                      | `▶ contract gate: <n> contract(s)`                                  | precedes `p.update(contractResults)` :94                                           |
| `pipeline/contracts.ts::contractPhase` :84                      | `  <summarize(result)>` (one line each)                             | precedes `p.update(contractResults)` :94                                           |
| `pipeline/contracts.ts::contractPhase` :123                     | `▶ contract review`                                                 | precedes `p.update(contractReviewed/handoffs)` :157                                |
| `pipeline/contracts.ts::contractPhase` :177                     | `  ⚐ <n> contract finding(s) concern the spec (not code)`           | follows `p.update(contractReviewed/handoffs)` :157                                 |
| `pipeline/approve.ts::approve` :84                              | `✓ approved <id> by <approver> (spec <sha12>, <n> tasks)`           | follows `p.update(phase: queued)` and `writeApproval` :65                          |
| `pipeline/reword.ts::diff` :266                                 | `<spec diff, capped at 400>`                                        | no run-state write                                                                 |
| `pipeline/reword.ts::reapprove` :329                            | `▶ reapprove <id> (dry run)`                                        | no write (dry run)                                                                 |
| `pipeline/reword.ts::reapprove` :331                            | `<id>: nothing was committed or re-stamped`                         | no write (dry run)                                                                 |
| `pipeline/reword.ts::reapprove` :348                            | `✓ <id>: the spec is unchanged; cleared <n> spec finding(s)`        | follows `p.update(specFindings = [])` :345                                         |
| `pipeline/reword.ts::reapprove` :351                            | `next: loomwright resume <id>`                                      | follows `p.update(specFindings = [])` :345                                         |
| `pipeline/reword.ts::reapprove` :353                            | `✓ <id>: the spec is unchanged; the approval is still valid`        | no write                                                                           |
| `pipeline/reword.ts::reapprove` :368                            | `▶ spec changes accepted:`                                          | follows `p.update(specFindings = [])` :358                                         |
| `pipeline/reword.ts::reapprove` :370                            | `✓ re-approved <id> (spec <sha12>, hash <sha12>)`                   | follows `p.update(specFindings = [])` :358                                         |
| `pipeline/reword.ts::reapprove` :373                            | `next: loomwright resume <id>`                                      | follows `p.update(specFindings = [])` :358                                         |
| `pipeline/reword.ts::reword` :408                               | `▶ reword: <n> finding(s)[ + instruction]`                          | precedes `p.update(specFindings)` :503                                             |
| `pipeline/reword.ts::reword` :482                               | `✓ <id>: dry run; the spec was restored and the findings are kept`  | no write (dry run)                                                                 |
| `pipeline/reword.ts::reword` :488                               | `✓ <id>: the architect made no spec changes; the findings are kept` | no write                                                                           |
| `pipeline/reword.ts::reword` :516                               | `▶ spec changes applied:`                                           | follows `p.update(specFindings)` :503                                              |
| `pipeline/reword.ts::reword` :518                               | `✓ reworded <id> (spec <sha12>, hash <sha12>, <n> finding(s))`      | follows `p.update(specFindings)` :503                                              |
| `pipeline/reword.ts::reword` :522                               | `<n> finding(s) remain; run loomwright reword <id> again`           | follows `p.update(specFindings)` :503                                              |
| `pipeline/reword.ts::reword` :525                               | `next: loomwright resume <id>`                                      | follows `p.update(specFindings)` :503                                              |

Count: 46 `p.out(` sites across `design.ts` (8), `drive.ts` (1), `implement.ts` (5),
`finish.ts` (10), `contracts.ts` (5), `approve.ts` (1) and `reword.ts` (16).

## 4. Every run-state mutation

`saveRun` writes `.factory/runs/<id>.json`; `updateRun` and `Pipeline.update` are
read-modify-write under the run lock. `scheduler.ts` mutates through `updateRun` too.

| Site                                                 | Fields set                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline/design.ts::intake` :135 (`saveRun`)        | new run: `id`, `request`, `phase: design`, `summary`, `likelyRepos`, `clarifications`, `handoffs.intake`                                                                                  |
| `pipeline/design.ts::ensureDesignBranch` :162        | `branches["."]`, `draft`                                                                                                                                                                  |
| `pipeline/design.ts::design` :270                    | `clarifications`                                                                                                                                                                          |
| `pipeline/design.ts::design` :291                    | `handoffs.design`, `phase` (`awaiting-approval`/`paused`), `pausedReason`                                                                                                                 |
| `pipeline/approve.ts::approve` :65                   | `phase: queued`, `pausedReason` (delete), `tasks[]` (status, history) + `writeApproval`                                                                                                   |
| `pipeline/drive.ts::setPhase` :43                    | `phase`, `pausedReason` (unless `abortRequested`)                                                                                                                                         |
| `pipeline/drive.ts::stopAborted` :53                 | `phase: aborted`                                                                                                                                                                          |
| `pipeline/drive.ts::drive` :77                       | `abortRequested` (cleared on resume of an aborted change)                                                                                                                                 |
| `pipeline/contracts.ts::contractPhase` :94           | `contractResults[key] = {passed, summary}`                                                                                                                                                |
| `pipeline/contracts.ts::contractPhase` :108          | `contractRounds += 1`, adds contract-fix tasks                                                                                                                                            |
| `pipeline/contracts.ts::contractPhase` :157          | `contractReviewed`, `handoffs["contract-review"]`, `specFindings`, adds fix tasks                                                                                                         |
| `pipeline/implement.ts::activate` :82                | `phase: queued`                                                                                                                                                                           |
| `pipeline/implement.ts::activate` :96                | `draft` (delete)                                                                                                                                                                          |
| `pipeline/implement.ts::activate` :121               | `branches`, `phase: implementing`, `abortRequested: false`                                                                                                                                |
| `pipeline/implement.ts::ensureContextPacks` :194     | `handoffs["context-packs"]`                                                                                                                                                               |
| `pipeline/implement.ts::#workdir` :249               | `tasks[].worktree`, `tasks[].branch`                                                                                                                                                      |
| `pipeline/implement.ts::#claimCheckout` :276         | `serialOwner[repo]`                                                                                                                                                                       |
| `pipeline/implement.ts::attempt` :402                | `tasks[].installed`                                                                                                                                                                       |
| `pipeline/implement.ts::attempt` :447                | `handoffs[<task>]`                                                                                                                                                                        |
| `pipeline/implement.ts::merge` :506                  | `serialOwner[repo]` (delete)                                                                                                                                                              |
| `pipeline/implement.ts::routeBlockedSpecFixes` :627  | `specFindings`, `tasks` (remove routed fix tasks)                                                                                                                                         |
| `pipeline/implement.ts::implement` :659              | `graphSeq` (max)                                                                                                                                                                          |
| `pipeline/finish.ts::review` :66                     | `reReview = []`                                                                                                                                                                           |
| `pipeline/finish.ts::review` :70                     | `reReview = []`                                                                                                                                                                           |
| `pipeline/finish.ts::review` :119                    | `handoffs["review:<repo>"]`, `specFindings`, `reviewed`, adds review-fix/test tasks                                                                                                       |
| `pipeline/finish.ts::review` :164                    | `reReview` (retry a crashed pass)                                                                                                                                                         |
| `pipeline/finish.ts::review` :168                    | `reviewRound`, `reReview`                                                                                                                                                                 |
| `pipeline/finish.ts::fullSuite` :231                 | `fullSuite[repo] = {passed, output}`                                                                                                                                                      |
| `pipeline/finish.ts::fullSuite` :240                 | `suiteRounds += 1`, adds `suite-<repo>-<n>` tasks                                                                                                                                         |
| `pipeline/finish.ts::close` :363                     | `pointersBumped`, `pointerCommit`, `pointers`                                                                                                                                             |
| `pipeline/finish.ts::close` :387                     | `archivedAs`, `archiveCommit`                                                                                                                                                             |
| `pipeline/finish.ts::close` :466                     | `phase: done`, `reportPath`                                                                                                                                                               |
| `pipeline/reword.ts::reapprove` :345                 | `specFindings = []`                                                                                                                                                                       |
| `pipeline/reword.ts::reapprove` :358                 | `specFindings = []`                                                                                                                                                                       |
| `pipeline/reword.ts::reword` :503                    | `specFindings`                                                                                                                                                                            |
| `scheduler/scheduler.ts::Scheduler.#update` :157     | task fields via `updateRun`: `status`, `failures`, `lastError`, `lastGateOutput`, `commit`, `gatesPassed`, `serial`, `installed`, `worktree`, `branch`, `history`; dependents `cancelled` |
| `pipeline/context.ts::Pipeline.update` :125          | delegates to `updateRun`                                                                                                                                                                  |
| `cli/commands/state-commands.ts::abortCommand` :338  | `abortRequested: true`, `phase: aborted`                                                                                                                                                  |
| `cli/commands/state-commands.ts::retryCommand` :388  | via `retryTask`: task `status: pending`, `failures: 0`, clears `lastError`, un-cancels dependents                                                                                         |
| `cli/commands/adopt.ts` :252, :269, :282 (`saveRun`) | `phase` (`design`/`paused`), `pausedReason`                                                                                                                                               |

`pipeline/land.ts` removes the state file (section 7); nothing else writes run state.

## 5. Event sources

| Source                              | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduler/scheduler.ts::TaskEvent` | 10 variants: `started`, `retry`, `failed`, `merging`, `merged`, `conflict`, `requeued`, `transient`, `interrupted`, `waiting`                                                                                                                                                                                                                                                                                                                                                                                                     |
| `gates/run.ts::GateEvent`           | `plan` (`gates`), `start` (`gate`), `end` (`gate`, `status`, `durationMs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `gates/run.ts::GateReport`          | `repo`, `mode`, `base`, `passed`, `changed`, `results[]` (`GateResult`: `type`, `name`, `status`, `durationMs`, `output`, `modified`, `regenerated`)                                                                                                                                                                                                                                                                                                                                                                              |
| `runtime/types.ts::SessionActivity` | `step-started`, `tool`, `tool-done`, `step-done`, `retry`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `runtime/types.ts::Usage`           | `input`, `output`, `reasoning`, `cacheRead`, `cacheWrite`, `cost`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `state/run.ts::RunState`            | `version`, `id`, `factoryVersion`, `origin`, `adoptedAt`, `preserveProgress`, `request`, `createdAt`, `updatedAt`, `phase`, `pausedReason`, `abortRequested`, `branches`, `tasks`, `mergeSeq`, `graphSeq`, `serialOwner`, `summary`, `likelyRepos`, `draft`, `reviewed`, `reviewRound`, `reReview`, `specFindings`, `contractResults`, `contractRounds`, `contractReviewed`, `fullSuite`, `suiteRounds`, `pointersBumped`, `pointerCommit`, `pointers`, `archivedAs`, `archiveCommit`, `reportPath`, `handoffs`, `clarifications` |
| `state/run.ts::Phase`               | `intake`, `design`, `awaiting-approval`, `queued`, `implementing`, `reviewing`, `contracts`, `full-suite`, `closing`, `done`, `paused`, `aborted`                                                                                                                                                                                                                                                                                                                                                                                 |
| `state/run.ts::TaskStatus`          | `pending`, `running`, `merging`, `merged`, `failed`, `cancelled`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `state/run.ts::TaskState`           | `id`, `title`, `repo`, `deps`, `touches`, `kind`, `status`, `failures`, `serial`, `worktree`, `branch`, `commit`, `mergeSeq`, `finding`, `lastGateOutput`, `lastError`, `gatesPassed`, `installed`, `history`                                                                                                                                                                                                                                                                                                                     |
| `state/run.ts::Clarification`       | `step`, `question`, `status`, `answer`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `approval/approval.ts::Approval`    | `changeId`, `approver`, `specCommit`, `hash`, `approvedAt`, `history[]` (`hash`, `specCommit`, `at`, `reason`)                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 6. Cross-process control map

| Action    | Current path                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `approve` | `.factory/approvals/<id>.json` + run state (`phase: "queued"`) via `writeApproval` / `Pipeline.update`                            |
| `abort`   | `.factory/runs/<id>.json` (`abortRequested`, `phase: "aborted"`), `queue.json` removal, `active.lock` release when no live driver |
| `retry`   | `.factory/runs/<id>.json` via `retryTask`                                                                                         |
| `resume`  | `.factory/runs/<id>.json` + `.factory/active.lock` (`claimActive`, `releaseDriver`)                                               |
| `answer`  | none — a second process cannot answer an agent question                                                                           |
| `pause`   | none — no command exists today                                                                                                    |

## 7. Retention

`pipeline/land.ts::landChange`:
- Deletes: `.factory/worktrees/<id>` (via `git worktree remove`, then `rmSync`), the change's
  `.factory/sessions/<session>.json` files, `.factory/context/<id>`, `.factory/reports/<id>-paused.md`,
  and — only when no branch or worktree was kept — `.factory/runs/<id>.json`,
  `.factory/runs/<id>` and `.factory/approvals/<id>.json`.
- Keeps: `.factory/reports/<id>.md`, `.factory/usage/<id>.json`, `.factory/logs/<id>`; with
  `artifacts.mode: "git"` it records report, approval and usage under `factory-records/` first.
- A dry run lists `.factory/drafts/<id>`, `.factory/approvals/<id>.json`, `.factory/runs/<id>.json`,
  `.factory/runs/<id>`, `.factory/sessions/` and `.factory/reports/<id>-paused.md` as `would clean`.
- `logs/log.ts::pruneLogs` only walks `.factory/logs`; it applies `logs.retentionDays` to the
  files inside each change log directory and removes an empty directory.

## 8. Thresholds

`thresholds.json` fixes the `bun test` pass count and the `bun run check` verdict. The
`declaredMinimums` table mirrors `test/architecture.test.ts::BASELINE_TEST_CASES` (keyed by
basename; the capture script reads it from source).

Rule: **no later task may lower `testsPassed`, the declared per-file test minimums, or leave
`bun run check` red.** Adding files and tests is expected.
