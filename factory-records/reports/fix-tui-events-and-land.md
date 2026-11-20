# fix-tui-events-and-land: done

The TUI only shows events and logs for task phases such as review and test, so activity in the rest of a run is invisible, and there is no way to land a change from the TUI. Add streaming of all run events and logs regardless of phase, and expose a land action in the TUI that triggers the existing local land flow.

## Branches (local only; nothing was pushed)

- loomwright: `change/fix-tui-events-and-land` at 08e73d270595 (29 commits)
- AI repo: `change/fix-tui-events-and-land` (archive commit 08e73d270595)

## Tasks

- [x] 1.1 (loomwright, task): Fold every run event into the activity facts
- [x] 1.2 (loomwright, task): Wire the land action through the launcher, controls and footer — 1 failed attempt
- [x] 1.3 (loomwright, task): Render the run-level tail at every width and refresh the frame states
- [x] 1.4 (loomwright, task): Document the all-event tail and the land action, add the changeset
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (packages/tui/test/view-model.test.ts:718): The spec scenario 'only the short commands run in-process' also names land, and the forbidden list omits it, so a future
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1146): While a land child runs, a second l opens a confirmation; confirming calls startLand, guard.begin returns false and noth
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:302): In replay the footer lists `r resume`, `x abort`, `t retry` and `l land` as valid, but `replayKey` intercepts all of the
- [x] fix-loomwright-2-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/activity.tsx:24): `singlePaneTailRows` (run-view.tsx:20-24) is `rows - 6 - tasks.length`; at 80x24 a run with 18 or more tasks yields 0 or
- [x] fix-loomwright-2-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:424): The spec requires the child's `.factory/logs/tui-spawn-<timestamp>.log` path to be shown by the UI. Intake and the appro
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:548): The bounded-polling requirement says status() is polled once a second *plus immediately after a spawn*, and a land launc
- [x] fix-loomwright-3-2 (loomwright, review-fix): Fix review finding (packages/tui/test/views.test.ts:881): The `case "land"` dispatch in entry.tsx and the confirmation-to-startLand path are untested, and the spec's test require
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-view.tsx:24): A failure notice is multi-line: `resumeFailed`/`landFailed` join the headline, the spawn-log path and up to ten log line
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/facts.ts:34): The fold now surfaces text from `progress.line`, `question.*`, `install.*`, `run.paused.reason` etc., but nothing in the
- [x] fix-loomwright-5-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/task-detail.tsx:54): At 80x24 the detail header, status, agent, retries, Gates and gate rows take about 8-10 rows, leaving about 13 for activ
- [x] fix-loomwright-5-3 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-view.tsx:53): `landFailed`/`resumeFailed` produce a 12-line notice; at 120x40 the header (1) + notice (12) + 34 tail rows exceed the 3
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/activity.tsx:32): Ink truncates the row at the pane width, so the ref is the first thing cut. A `progress.line` that carries a ref is by d
- [x] fix-loomwright-6-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1317): Pressing `?` in `--replay` does nothing while the footer advertises Help, contradicting 'the footer SHALL list the keys 
- [x] fix-loomwright-7-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:163): With the replay help panel open (press `?` on a non-approval stream), Ctrl-C is swallowed: `helpKeys('c', {ctrl:true})` 
- [x] fix-loomwright-8-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/facts.ts:63): `flat()` exists to stop terminal escape injection, but a replay line like `progress.line` with `ref.path` = "ESC]52;c;..
- [x] fix-loomwright-8-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:587): If that single `status()`/`listRuns()` call fails once (`scanRuns` rethrows non-corrupt I/O errors), the run is gone but
- [x] fix-loomwright-9-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:235): The change sanitised activity text, step and logRef with flat(), but these fields bypass it, so a crafted --replay file 
- [x] fix-loomwright-9-2 (loomwright, review-fix): Fix review finding (packages/tui/src/launch/launcher.ts:161): The log may contain escape sequences from gate or agent output (the same data the fold now sanitises for the tail), and 
- [x] fix-loomwright-10-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1030): Landing A, pressing Esc, opening run B, pressing l and confirming launches a second land child; both run switchToTarget 

## Spec

Archived as `openspec/changes/archive/2026-11-20-fix-tui-events-and-land`.

## Review findings

- review:loomwright: [should] packages/tui/src/entry.tsx:1030 Landing A, pressing Esc, opening run B, pressing l and confirming launches a second land child; both run switchToTarget and git merge in the same shared checkout, and a failing merge path calls git merge --abort against whatever merge is in progress there.
- review:loomwright: [nice] packages/tui/src/entry.tsx:612 settleLanding deliberately leaves a selection the user moved to alone, but this path yanks the screen to the list and clears selectedRunId even when the user is viewing another run.
- review:loomwright: [nice] packages/tui/src/entry.tsx:537 Every other list entry path keeps or sets a selection; with null, no row is highlighted and the footer drops Enter open run while runs remain.
- review:loomwright: [nice] packages/tui/src/entry.tsx:615 The repo standard forbids floating promises; startResume wraps its refresh in try/catch, so a future LandRun.refresh that rejects would surface as an unhandled rejection and exit the process without the session finally restoring the terminal.
- review:loomwright: [nice] packages/tui/test/facts.test.ts:140 The standard requires a test whose name mentions each spec scenario, so a scenario-to-test name scan cannot map this one.

## Risks and things not checked

- intake: Scope inferred from the request only; no repository code, specs or graph were read.
- intake: Assumed 'land' means invoking the existing local land/merge flow from the TUI, not a new merge implementation.
- intake: 'Events/logs outside of tasks' is read narrowly as non-task pipeline phases; if it also covers scheduler, gate or graph activity the scope grows.
- design: I could not run the OpenSpec validator in this session (shell unavailable); I re-read all MODIFIED blocks against the current spec's scenario lists and only this one was missing.
- design: The new scenario sits alongside the added all-event scenarios; the task-detail filter and evidence requirements are compatible.
- context-packs: Shell and graph tooling were permission-denied in this session, so the packs were built from direct file reads instead of graphify queries; symbol line ranges are from the current working tree and should be treated as hints.
- context-packs: The approved tasks do not include test/docs.test.ts or test/architecture.test.ts. The packs therefore require the docs to satisfy the existing assertions; if the reviewer wants new assertions for the l key or the land wording, that needs a task outside these touches.
- context-packs: The existing frame fixtures will change for reasons beyond the two new states (done-run footer gains 'l land', single-pane layout shifts). 1.3 regenerates every state deliberately; unexplained diffs should stop the implementer.
- context-packs: Two intake/design questions about land scope and confirmation remain unanswered in questions.md; the packs follow the design's stated assumptions (done only, confirmation required).
- context-packs: The changeset readiness check (bunx changeset status) is optional and may be noisy on a change branch; bun run check remains the gate.
- 1.1: `bun run check` fails 5 frame snapshot tests (running-graph, failing-task, finished and list-with-runs) because the new run-level lines change the rendered frames. The fixtures are outside this task and are explicitly refreshed by task 1.3; I did not edit them.
- 1.1: Heartbeat lines use kind `heartbeat` (not one of the design.md suggested family labels) so coalescing can identify them by kind.
- 1.2: Frame fixture regeneration touches files nominally owned by task 1.3; task 1.3's UPDATE_FRAMES=1 pass will overwrite them with the same or newer content, so no conflict is expected.
- 1.2: docs/tui.md's key table row for `l` is task 1.4; test/docs.test.ts does not yet assert it, so nothing here is red because of that.
- 1.2: No real `loomwright land` child was executed; the argv, detachment, exit-code and log-tail behaviour is covered by the scripted launcher seam only.
- 1.3: Runs with very many tasks can make the single-pane tail budget 0 while ActivityTail still renders its one-line 'no activity yet' fallback; overflowY=hidden clips it, matching the suggested formula.
- 1.3: A changeset was not added because the task restricts edits to the listed touches.
- 1.4: Docs-only change; no product code touched and no new tests added — the existing `test/docs.test.ts`/`test/architecture.test.ts` scenarios already cover the required text and all pass.
- 1.4: The docs link `cli.md#land` and `docs/tui.md`; anchors depend on the `## land` heading remaining in `docs/cli.md`.
- 1.4: `--dry-run` is documented as a CLI-only flag not offered in the TUI.
- review:loomwright: Could not run bun test / bun run check in this session (shell denied); frame fixtures and new assertions were verified by reading only, so a regeneration mismatch would surface at the gate.
- review:loomwright: RunState.summary is still rendered raw (approval panel); the new stripControls/flat hardening covers event payloads and task rows, not run state. The summary is operator-supplied, so this is not an attack path.
- review:loomwright: The CLI land command exits 2 when it kept unmerged branches, so a land that removed run state can still be reported as a failure by the TUI (pre-existing CLI contract).
- fix-loomwright-1-1: Did not check whether another suite already covers the 'land is a child, not a call' scenario; that scenario is a separate finding.
- fix-loomwright-1-1: bun run test (full parallel suite) not run, only packages/tui/test/view-model.test.ts plus format:check, lint and typecheck.
- fix-loomwright-1-2: The key-handler wiring in the Interactive component itself is only exercised indirectly through landConfirmation; full key-path coverage would need an Ink render test, which the repo's existing land tests do not use.
- fix-loomwright-1-2: No new changeset: the existing .changeset/tui-activity-tail-and-land.md covers this review fix.
- fix-loomwright-1-2: Ran bun run format:check, lint, typecheck, and the full bun run test (1439 pass, 5 skip, 0 fail).
- test-loomwright: The 'no signal on exit' clause for real SIGINT/SIGTERM is verified structurally (launcher never exposes kill/wait; source scan forbids .kill/process.kill/child.wait) and by the launcher fake-child liveness test, rather than by sending real OS signals to a child.
- test-loomwright: All gate commands were run: format:check, lint, typecheck and the full bun test suite (1441 pass, 5 skip, 0 fail).
- fix-loomwright-2-1: A replay with an open approval overlay still shows the panel footer (its write keys are already filtered out), not the reduced run footer; out of the reported scope.
- fix-loomwright-2-1: Formatting check only covers files Biome sees; no build or E2E replay run was executed.
- fix-loomwright-2-2: Row sizing assumes each header/notice/task/footer row is exactly one line; this holds today because all those Text nodes use wrap="truncate".
- fix-loomwright-2-2: Existing changeset tui-activity-tail-and-land.md already covers this change; no new changeset added.
- fix-loomwright-2-3: The notice persists after a successful resume/land until the next openRun/back; accepted as evidence of where the log lives.
- fix-loomwright-2-3: Did not touch docs/tui.md, intake or approval modules, which hardcode the same 'spawn log: ' prefix; the format string is now duplicated in entry.tsx.
- fix-loomwright-3-1: The test covers startLand's own refresh; the wiring of pollerRef/refreshStatus at the applyControl call site is unchanged and only covered indirectly by the tui suite.
- fix-loomwright-3-1: Ran the full `bun run test` (1449 pass, 5 skip), typecheck, lint and format:check locally.
- fix-loomwright-3-2: Test-only change; no changeset added because no package source or exports changed.
- fix-loomwright-3-2: The run-row wait matches the bare run id and the footer wait matches the ASCII `l land` hint; reshaping those footer strings would need the test updated.
- fix-loomwright-4-1: Ink's headless frame capture clamps output to the terminal height, so the strongest regression guard is the direct singlePaneTailRows assertion; the frame assertions cover the visible symptom.
- fix-loomwright-4-1: Did not check other fixed-row budget calculations (e.g. two-pane tail maxLines = rows - 6) for the same multi-line notice issue, as that was outside this finding.
- fix-loomwright-5-1: The strip keeps only tab and newline among all Cc characters; any future payload-like field that is expected to honour CR would be flattened by the existing newline collapse anyway.
- fix-loomwright-5-1: Unicode line separators (U+2028/U+2029) are not Cc and are not stripped; Ink would render them inside a single Text row rather than as terminal controls, so no escape surface remains.
- fix-loomwright-5-2: The row accounting assumes every detail and gate line renders on one row, which holds because those Texts use wrap="truncate".
- fix-loomwright-5-2: No changeset was added; the repository convention asks for one for packages changes, but this task did not request it and the gates do not enforce it.
- fix-loomwright-5-3: Only the two-pane run-level tail (run.detail === null) was changed; the list screen's two-pane activity tail in frame.tsx still uses rows - 6 and has no notice row at all, so it is unaffected by this finding but shares the magic number.
- fix-loomwright-5-3: Full gate run locally: format:check, lint, typecheck and bun run test (1454 pass, 5 skip) all clean.
- fix-loomwright-6-1: A very long step or kind label could still push the ref past a narrow pane; the pathological case the finding names (long text) is covered.
- fix-loomwright-6-1: Only reordered output; did not measure or truncate the text itself, so the visible tail of long text is shorter by the ref width.
- fix-loomwright-6-2: The Replay useInput handler reads help state through currentRef, so a key pressed between setHelp and the next render is handled against the previous frame (same pre-existing one-frame window as the notice state).
- fix-loomwright-6-2: Did not test live ink stdin key dispatch for `?`; coverage is the pure replayKey/replayHelpView path plus renderOnceFrame.
- fix-loomwright-7-1: Did not run the CLI build or a real-terminal replay; the fix is covered by the pure `replayKey` test and the full suite only.
- fix-loomwright-7-1: No new changeset: the containing change already has `.changeset/tui-activity-tail-and-land.md`.
- fix-loomwright-8-1: gate.finished steps containing control characters now land under a flattened key in facts.gates; such steps never match real task ids, so lookups are unaffected.
- fix-loomwright-8-1: No escape-in-logRef coverage exists for install/gate activity lines beyond the shared line() path, which is exercised indirectly.
- fix-loomwright-8-2: The React wiring in `refreshStatus` is not exercised by a component test; tests cover the pure settlement and `startLand` arming/wiring directly.
- fix-loomwright-8-2: If the user moves to another run before the pending poll succeeds, the pending marker is cleared and the landed notice is intentionally not shown for the old run.
- fix-loomwright-8-2: The retry adds one immediate extra `status()`/`listRuns()` call only after a failed zero-exit refresh.
- fix-loomwright-9-1: flat() trims and collapses whitespace, so a crafted id is displayed differently from the raw run-state id; normal ids are unchanged.
- fix-loomwright-9-1: run.id is left raw because the replay schema constrains it to a change id, and replay run summaries are empty; other live-only strings such as run.summary and run.draft were not sanitised.
- fix-loomwright-9-1: No changeset added, matching the previous review-fix commits in this change.
- fix-loomwright-9-2: A log row made only of control characters now reads as an empty line in a notice (content loss is intentional).
- fix-loomwright-9-2: Did not run bun run build/build:plugin; this change touches neither packages/core/src/plugin nor policy, so the committed plugin bundle should be unaffected.
- fix-loomwright-10-1: Checked only the guard path; the real concurrent-merge behaviour of the land child itself is unchanged and not exercised against a live checkout.
- fix-loomwright-10-1: No changeset added — the change-level changeset .changeset/tui-activity-tail-and-land.md already covers this TUI work, matching the previous fix commits in this change.

## Open questions

- intake: Should the TUI's land action be offered only after a run passes review/test, or at any time for any change?
- intake: Should land in the TUI require an explicit confirmation step before merging locally?

## Usage

Total: 132.41M tokens (127.18M cache read, 273.6k out) · cost n/a over 41 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| reviewer | 87.97M | 66% | cost n/a |
| implementer-loomwright | 31.53M | 24% | cost n/a |
| architect | 8.59M | 6% | cost n/a |
| explorer | 2.20M | 2% | cost n/a |
| tester | 2.10M | 2% | cost n/a |
| orchestrator | 15.4k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 87.97M | 66% | cost n/a |
| design | 4.93M | 4% | cost n/a |
| 1.1 | 4.00M | 3% | cost n/a |
| 1.2 | 3.88M | 3% | cost n/a |
| context-packs | 3.40M | 3% | cost n/a |
| fix-loomwright-8-2 | 3.06M | 2% | cost n/a |
| fix-loomwright-9-1 | 2.57M | 2% | cost n/a |
| fix-loomwright-2-3 | 2.52M | 2% | cost n/a |
| 1.4 | 2.34M | 2% | cost n/a |
| explore:loomwright | 2.20M | 2% | cost n/a |
| test-loomwright | 2.10M | 2% | cost n/a |
| 1.3 | 1.71M | 1% | cost n/a |
| fix-loomwright-4-1 | 1.27M | 1% | cost n/a |
| fix-loomwright-3-2 | 1.12M | 1% | cost n/a |
| fix-loomwright-5-2 | 932.9k | 1% | cost n/a |
| fix-loomwright-2-1 | 831.6k | 1% | cost n/a |
| fix-loomwright-10-1 | 766.2k | 1% | cost n/a |
| fix-loomwright-6-2 | 758.9k | 1% | cost n/a |
| fix-loomwright-5-1 | 743.8k | 1% | cost n/a |
| fix-loomwright-6-1 | 718.9k | 1% | cost n/a |
| fix-loomwright-1-2 | 678.3k | 1% | cost n/a |
| fix-loomwright-2-2 | 656.7k | 0% | cost n/a |
| fix-loomwright-3-1 | 652.7k | 0% | cost n/a |
| fix-loomwright-5-3 | 554.7k | 0% | cost n/a |
| fix-loomwright-8-1 | 536.8k | 0% | cost n/a |
| fix-loomwright-9-2 | 533.6k | 0% | cost n/a |
| fix-loomwright-7-1 | 530.0k | 0% | cost n/a |
| reword | 267.1k | 0% | cost n/a |
| fix-loomwright-1-1 | 162.4k | 0% | cost n/a |
| intake | 15.4k | 0% | cost n/a |

Top consumers: review:loomwright (87.97M), design (4.93M), 1.1 (4.00M), 1.2 (3.88M), context-packs (3.40M).
Retry overhead: 456.3k tokens (0%).
Wasted re-reads of unchanged files: 124.
