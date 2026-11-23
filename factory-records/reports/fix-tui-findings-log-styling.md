# fix-tui-findings-log-styling: done

The terminal UI hides and misroutes three things users need: spec findings and the reword flow are invisible and unreachable from the screens where they apply, task detail logs omit the reviewer/contract/tester activity that belongs to the task, and the activity log has no room or way to scroll; on top of that the frame drifts out of position and overflows the terminal when lists or graphs get long, the questions pane forces a choice between answering and navigating, and the whole UI reads as barely styled. The requester wants findings surfaced as first-class state with a reword panel launched from the run view, a scoped and scrollable full-height log, pure view-model scroll offsets and fixed row budgets so the frame never exceeds `rows`, a questions flow that can answer and still navigate, and a styling pass on existing tokens only — all inside `packages/tui`, with `docs/tui.md`, a `factory-tui` spec delta and at most one additive optional event field, no new pipelines, event types, commands, flags or dependencies. Reported scenarios were seen on the released 1.2.0 and must be re-verified against a 1.2.0 checkout so already-fixed behaviour on `main` is not re-fixed, and the release note must name the version that finally ships the fix.

## Branches (local only; nothing was pushed)

- loomwright: `change/fix-tui-findings-log-styling` at cf30681f1695 (55 commits)
- AI repo: `change/fix-tui-findings-log-styling` (archive commit cf30681f1695)

## Tasks

- [x] 1.1 (loomwright, task): Surface spec findings, the paused banner and the list summary — 1 failed attempt
- [x] 1.2 (loomwright, task): Decide reword availability and build its argv
- [x] 2.1 (loomwright, task): Derive a task's activity scope in one pure function
- [x] 3.1 (loomwright, task): Add a pure viewport module for offsets and windows
- [x] 3.2 (loomwright, task): Give the run list and task graph row budgets and scroll offsets
- [x] 4.1 (loomwright, task): Add the scoped full-height activity pane and the four-row tail floor
- [x] 5.1 (loomwright, task): Let the questions pane compose, record and advance
- [x] 6.1 (loomwright, task): Collapse the approval overlay to its banner
- [x] 6.2 (loomwright, task): Add the reword panel with findings and a multi-line prompt
- [x] 6.3 (loomwright, task): Apply the styling pass on the existing tokens
- [x] 7.1 (loomwright, task): Add the new frame states and fixtures at both sizes
- [x] 8.1 (loomwright, task): Document the keys and flows, add ADR-0048 and a changeset naming 1.3.0
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/task-detail.tsx:84): With more than 12 gates at 80x24 (or 100x24) the detail renders 10+gate rows beyond its budget: 13 gates give 25 lines p
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/questions.tsx:66): At 80x24 the pane emits 1 file line + 18 record rows; with notice 'the answer is empty' PanelBox adds one row, so the fr
- [x] fix-loomwright-1-3 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:437): RunHeader adds a second row for a paused run with findings, so a paused run with 3 findings and 19+ activity rows at 80x
- [x] fix-loomwright-1-4 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/reword.ts:217): Pressing q appends 'q' to the prompt while the footer says quit (and docs say q quits everywhere); the ASCII keys row is
- [x] fix-loomwright-1-5 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1417): Answer a record, Esc twice, press Q: the row reads `unanswered — Enter answers` again and Enter records a second answer,
- [x] fix-loomwright-1-6 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/activity-pane.ts:61): A run with tasks but no selection (the normal 80-column case) opens in run scope and Tab keeps `Activity - run`, though 
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:387): The spec says the footer lists the keys valid in the current state, and the 'keys are documented' scenario lists `L`; do
- [x] fix-loomwright-2-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/task-detail.tsx:41): taskDetailGateRows reaches 0 at 80x24 whenever a 10-12 line failure notice is on screen (e.g. after a failed land or res
- [x] fix-loomwright-2-3 (loomwright, review-fix): Fix review finding (docs/tui.md:166): The doc contradicts both the code and its own new paragraph; the spec requires docs/tui.md to document the same keys the
- [x] fix-loomwright-2-4 (loomwright, review-fix): Fix review finding (packages/tui/test/views.test.ts:539): The frame rendered here is 28 lines tall (1 + 25 graph rows + 2 activity chrome + footer), the tail is empty only becaus
- [x] fix-loomwright-2-5 (loomwright, review-fix): Fix review finding (packages/tui/src/views/footer.tsx:19): At 80 columns the footer reads `x abort - ? help - q quit - w reword - add-health is being d...`: the CLI reason is cut 
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:467): At 80x24 a 12-line land/resume failure notice plus a selected task with no gates and no activity needs 11-12 detail rows
- [x] fix-loomwright-3-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-list.tsx:56): A long summary eats the whole row: the findings marker is cut off and then role/tokens/cost/elapsed are cut. The committ
- [x] fix-loomwright-3-3 (loomwright, review-fix): Fix review finding (packages/tui/src/views/footer.tsx:26): At 80 columns a driven run's footer becomes 'w reword - add-health is being driven by pid 4242; stop it first - x abort 
- [x] fix-loomwright-3-4 (loomwright, review-fix): Fix review finding (packages/tui/src/views/panel.tsx:76): Ink always truncates with '…', so an --ascii/TERM=dumb frame with a long activity/progress line, a long gate command or 
- [x] fix-loomwright-3-5 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/questions.tsx:207): A paste that contains an embedded ESC after a printable prefix arrives as one input string and is rendered by <Text>; th
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/questions.tsx:204): Ink 6.4 maps the physical Backspace key (DEL, \x7f) to `key.delete`, not `key.backspace` (parse-keypress: s === '\x7f' -
- [x] fix-loomwright-4-2 (loomwright, review-fix): Fix review finding (README.md:165): This change removes `w` from the gate (the spec says w SHALL NOT be offered at awaiting-approval and Esc now collapses t
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-view.tsx:46): At 80x24 a run with 1-2 tasks and more than ~17 activity lines (any busy implementing run) gets removed = min(2, 2, over
- [x] fix-loomwright-5-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-list.tsx:65): At 80 columns a driven run at the gate needs 17 (phase) + 17 (active pid) + 12 (tokens) + 5 + 5 + 12 separators = 68 cel
- [x] fix-loomwright-5-3 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/reword.ts:120): rewordKeys only changes state.text; the offset stays 0. With 7 findings, or 3 findings whose problems wrap, the prompt i
- [x] fix-loomwright-5-4 (loomwright, review-fix): Fix review finding (docs/tui.md:126): questionsKeys and activityPaneKeys ignore q (entry returns without quitting), and rewordKeys appends q to the prompt. On
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1367): Case: a run at awaiting-approval, Esc collapses the overlay, n opens the intake dialog, typing `q` in the request exits 
- [x] fix-loomwright-6-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/activity.tsx:20): Case: at 80 columns a `gate.started` line carrying a long command, or a task title over 40 characters, is cut by Ink/cli
- [x] fix-loomwright-7-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-view.tsx:103): A line that fills the 60-cell budget is re-truncated by Ink with the non-ASCII ellipsis '…', so the 120-column ASCII tes
- [x] fix-loomwright-7-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:364): Without an approval overlay q is not handled before the questions, log and confirmation blocks; those blocks return unco
- [x] fix-loomwright-7-3 (loomwright, review-fix): Fix review finding (packages/tui/src/views/footer.tsx:44): When the enabled hints alone exceed columns (a paused run with a failed selected task and questions is 84 characters at 
- [x] fix-loomwright-7-4 (loomwright, review-fix): Fix review finding (packages/tui/src/views/task-graph.tsx:37): In the 120-column two-pane view the graph pane is 58 cells and the detail 59; a 40-character title makes the graph row ~
- [x] fix-loomwright-8-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:276): On the first frame after the overlay opens (and until the async `git config user.email` read resolves), `approvalPanel` 
- [x] fix-loomwright-8-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1520): The spec requires a keybinding test for `w` from a paused run (spec lines 368-369). `reword.test.ts` and `controls.test.
- [x] fix-loomwright-9-1 (loomwright, review-fix): Fix review finding (packages/tui/src/intake/dialog.tsx:189): PanelBox renders every newline as its own row but counts the entry as one line, so a 19-line request at 80x24 is 25 rend
- [x] fix-loomwright-9-2 (loomwright, review-fix): Fix review finding (packages/tui/src/views/header.tsx:20): At 80 columns the change's own id (fix-tui-findings-log-styling, 28 chars) plus implementing and the metadata is 91 cell
- [x] fix-loomwright-9-3 (loomwright, review-fix): Fix review finding (packages/tui/test/views.test.ts:631): No test name mentions the spec scenario 'the tail keeps its floor on a short terminal', so the scenario map shows it unc
- [x] fix-loomwright-10-1 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:261): The pipeline matches c.question === command.question against the stored raw text (core/pipeline/drive.ts:96). A question
- [x] fix-loomwright-10-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1813): replayView and the activity panel are built once with the initial rows/columns, and Frame fixes height to that number, s
- [x] fix-loomwright-10-3 (loomwright, review-fix): Fix review finding (packages/tui/test/frame-states.ts:838): The spec's snapshot list asks for the log pane following and scrolled in all three scopes; scrolled-run, follow-task and

## Spec

Archived as `openspec/changes/archive/2026-11-23-fix-tui-findings-log-styling`.

## Review findings

- review:loomwright: [should] packages/tui/src/model/view-model.ts:261 The pipeline matches c.question === command.question against the stored raw text (core/pipeline/drive.ts:96). A question with a newline is flattened, never matches, and applyAnswer appends a new 'answer' record while the real question stays unanswered; the pane still says recorded.
- review:loomwright: [should] packages/tui/src/entry.tsx:1813 replayView and the activity panel are built once with the initial rows/columns, and Frame fixes height to that number, so shrinking a replay from 120x40 to 80x24 still writes 40 rows past the terminal.
- review:loomwright: [should] packages/tui/test/frame-states.ts:838 The spec's snapshot list asks for the log pane following and scrolled in all three scopes; scrolled-run, follow-task and follow-repo have no state and no 80x24/120x40 pair.
- review:loomwright: [nice] packages/tui/src/model/activity-scope.ts:90 Two copies of the run/task/repo order must change together, and one is dead in production.
- review:loomwright: [nice] docs/tui.md:43 TaskDetail renders gateLine(name, status, duration); the step is never rendered.
- review:loomwright: [nice] packages/tui/src/controls/questions.tsx:193 Ink 6.4 parses 0x0A as name 'enter', ctrl false, input '\n', so that branch never fires; the newline only works via the stripControls-keeps-\n fallback, and the tests feed {ctrl: true, input: 'j'}, which Ink cannot produce.
- review:loomwright: [nice] packages/tui/src/controls/reword.ts:232 questions.tsx and approval/overlay.ts already import dash from views/style.ts.

## Risks and things not checked

- intake: Very large request (seven sequential tasks, many snapshot fixtures). Narrowest reading applied: no protocol event field unless task-scoped activity truly cannot be derived from existing data.
- intake: No source was read at intake, so the claim that all six defects exist as described is unverified; the baseline-verification-against-1.2.0 step is recorded as the requester's own requirement.
- design: No shell in this session, so the OpenSpec validator could not be re-run locally; the fix addresses the reported scenario-presence check only.
- design: The scenario body had to change with the requirement (the task detail now also carries its repo's reviewer and sibling-task lines); the name is preserved but the old one-line filter assertion no longer holds by design.
- context-packs: Frame-fixture churn crosses task boundaries: 1.1, 1.2, 4.1, 5.1 and 6.1 change rendered output but do not own packages/tui/test/fixtures/frames/**; only 3.2, 6.3 and 7.1 do. frames.test.ts will be red between those points; each pack tells the implementer to report rather than edit, so per-task gates may fail on snapshots.
- context-packs: packages/tui/test/views.test.ts is owned only by 6.3, but 4.1's four-row tail floor supersedes its 'tail renders nothing when zero rows are left' assertion (24-task run at 80x24). That test is expected red from 4.1 until 6.3; flagged in the 4.1 pack.
- context-packs: 6.1's Esc-inert change contradicts the existing approval.test.ts 'each action cancels with Esc' matrix; the pack rewrites it to n, but a reviewer should confirm the intent shift is acceptable (the delta is explicit).
- context-packs: The spec names two frame states ('the findings panel' and 'the reword panel with findings and a typed prompt'); 6.2 models one panel, so 7.1 renders the findings-panel state as the same panel scrolled to the body. If a reviewer reads the delta as two components, 6.2 needs a second panel kind.
- context-packs: No shell and no graph were available in this session, so file paths and line hints were taken from reads only; line numbers in the packs are hints and the packs say so via symbols.
- context-packs: The replay fixture was judged still valid (its assertions are title/hash/event-count/key-absence based), so 7.1 is told not to re-record it; if a re-record turns out to be needed, the delta requires the reason in the final report.
- 1.1: Row clipping is a placeholder for task 3.2's row budgets: at 80 columns (and 60 in the two-pane list) tokens/cost/elapsed can be cut. 3.2/6.3/7.1 own the real budgets and will regenerate these fixtures again.
- 1.1: The paused banner's rendered wording has no frame assertion yet, by instruction (frame fixtures belong to 3.2/6.3/7.1); only pausedFindings() wording is unit-tested.
- 1.1: No changeset added; task 8.1 owns docs, ADR and the changeset.
- 1.2: Frame fixture edit is outside the task's declared touches (allowed at runtime, as 1.1 did); 3.2/6.3/7.1 will regenerate these frames anyway.
- 1.2: The view-model still cannot read the approval file, so a paused/aborted never-approved run reads available; the child reports `is not approved` in the log tail (accepted in design.md).
- 1.2: roleOf's pid fallback (`?? 0`) means an inconsistent status document with driverAlive true and pid null would print `pid 0`; core never produces that state.
- 2.1: No changeset was added: packages changes normally need one, but .changeset/ is outside this task's touches globs (the factory or a later task must add it).
- 2.1: scopesFor's doc comment mentions 'the given task'; the implementation enumerates every task in Tab order (run, task, repo), which is the only sensible reading of its single task-list parameter.
- 2.1: The new test file builds the run view end to end but does not exercise a line whose agent.activity kind is review, since the protocol only allows step-started/tool/tool-done/step-done/retry.
- 3.1: No changeset was added because the task's edit scope only allows the two new files; the repo convention normally expects one for `packages/` changes.
- 3.1: Nothing renders or wires keys yet — 3.2 owns that, so only the arithmetic is proven here.
- 3.2: The spec sample title `runs 3-9/12` conflicts with the 3.1 viewport arithmetic: 12 runs with 9 fitting at offset 2 renders `runs 3-11/12` (end = offset + size). Tests assert the real arithmetic; windowTitle was left untouched.
- 3.2: Notice and panel rows are still unbounded (4.1 owns their budgets), so a notice taller than the terminal can still overflow.
- 3.2: The four-row tail floor is intentionally not added (4.1); the graph window takes priority and the tail is sized from what is left.
- 3.2: No fixture files changed, so no regeneration was required.
- 4.1: The modified scenario says a 12-task run at 80x24 overflows the graph, but 12 tasks fit (9 tail rows); the floor regression test uses 24 tasks to actually exercise graph scrolling.
- 4.1: The overview scenario in views.test.ts still passes because that view is built at the default 120x40 and only rendered at 80x24, so no expected red occurred.
- 4.1: q is inert while the activity pane is open (Esc returns first), matching the plan's dispatch order; Ctrl-C still exits.
- 4.1: PanelView.lines now contains single-space padding rows; a future consumer counting pane lines should trim them.
- 4.1: The help panel is exactly at the 80x24 limit, so later tasks adding help lines may overflow again.
- 5.1: A composer taller than the pane shows only its newest lines; there is no composer scroll, which matches the frame-budget priority but hides older typed text.
- 5.1: I did not manually drive a real terminal; the behaviour is pinned by the pure state-machine tests, frame snapshots and the full `bun run test` suite.
- 5.1: I did not add a changeset: the task touches list excludes `.changeset/`, and the change plan assigns that to task 8.1.
- 6.1: The bottom `KeyFooter` still filters disabled hints, so the inert-Esc reason is visible in the panel keys row now; task 6.3 must render disabled hints in the footer for the run-key footer to show it.
- 6.1: No changeset added because `.changeset/` is outside this task's allowed paths.
- 6.2: The keys row lists q quit as specified, but the entry's quit handler is not truly global; q types into the prompt instead of quitting so prompts may contain q.
- 6.2: RewordState carries no run id, so a delayed exit from an earlier reword child could close or fail a panel later opened for a different run; guarded against only per id.
- 6.2: No frame fixtures were added or regenerated: reword-panel/reword-confirm belong to 7.1 and existing frames did not move.
- 6.2: No changeset was added because the task's allowed paths exclude .changeset; the overall change should carry one.
- 6.3: Help and activity panels omit the blank line before the keys at 80x24; the frame-must-fit rule wins over the panel styling rule on short terminals.
- 6.3: Task-graph task/status/repo columns are not padded (only gate rows and facts align); the spec's alignment scenario covers the task detail.
- 6.3: Bold is set through Ink but cannot be observed in captured non-TTY frames (chalk level 0); tests pin the glyph/label and colours instead.
- 6.3: The frame fixture diff is the visual record of the restyle and is large by design.
- 7.1: PanelBox does not ASCII-clip its own lines. In a live --ascii 80-column frame the reword panel's duplicate keys row still ends in a Unicode ellipsis. Fix belongs in packages/tui/src/views/panel.tsx (clip with glyphs) or the ASCII scroll label in packages/tui/src/controls/reword.ts; both are outside this task's touches.
- 7.1: There is no gate scroller, so the 80x24 task-detail-gates snapshot pins 8 gates; the 120x40 snapshot pins all 20. A true 20-gate short view needs a gate window.
- 7.1: The long-list-bottom window is runs 39-60/60 at 80x24 (the list gets 22 rows), not the illustrative 41-60/60 in the task text.
- 7.1: paused-findings pins the run-view banner; the list row's '3 findings' marker is covered by the existing view-model/views tests, not this frame.
- 7.1: tasks-12 has one activity line, so the graph window stays at 12 rows rather than shrinking; the four-row tail floor is pinned by the existing long-run/activity tests.
- 8.1: README.md still describes w as an approval-overlay action and Esc as a plain cancel, and omits L and the scoped log; it is outside this task's touches and was not edited.
- 8.1: The live run-view footer in packages/tui/src/model/view-model.ts does not itself list L; only the help panel and activity pane do. packages/tui was outside this task's touches.
- 8.1: ADR-0048 is 45 lines, slightly below the suggested 50-70, but carries the required sections and decisions.
- 8.1: docs/cli.md's tui entry links docs/tui.md and covers the existing flags/land flow but does not repeat the new findings or log keys.
- review:loomwright: Could not run bun test, bun run typecheck or the frame updater: the shell tool was permission-denied, so snapshot and gate results are unverified.
- review:loomwright: Did not inspect the base commit's version of unchanged context lines (git show was unavailable); findings cite the head code only.
- review:loomwright: Finding 6's fix touches two pure key handlers; without a real-stdin test a later cleanup of the stripControls fallback would silently break Ctrl-J.
- fix-loomwright-1-1: At terminals shorter than the fixed detail rows (~15 rows) the gate list renders no rows; the frame already overflows at that size for reasons outside this task.
- fix-loomwright-1-1: The 120x40 snapshot did not change; only the 80x24 task-detail-gates snapshot was regenerated.
- fix-loomwright-1-1: Existing changeset `.changeset/tui-findings-log-scroll.md` covers this TUI change; no new changeset added.
- fix-loomwright-1-2: Existing .changeset/tui-findings-log-scroll.md already covers the change, so no new changeset was added.
- fix-loomwright-1-2: Only the questions pane budget was adjusted; other panels rely on PanelBox's own `spaced` guard and were not re-audited.
- fix-loomwright-1-3: No changeset added because this is a review fix inside an existing change that already carries one.
- fix-loomwright-1-3: The 80x24 frame test still passes under the old buggy budget because Ink clips the overflow box; the unit assertions on taskWindow.size and the four budget functions are the regression guard.
- fix-loomwright-1-4: docs/tui.md still says `q | Quit | Everywhere`, which remains inaccurate inside text-entry panels (intake, questions, reword). Left untouched because the finding's fix was only to drop the hint.
- fix-loomwright-1-4: Ran the full gates: format:check, lint, typecheck and bun run test (1608 pass, 5 skip, 0 fail).
- fix-loomwright-1-5: The recorded set lives for the session and keeps recordKey's step+question identity; a retried step that re-raises an identical step+question after question.answered would read as already recorded.
- fix-loomwright-1-5: The entry-level ref wiring has no direct test because the Ink key handler is internal; the pure openQuestions/withRecordedAnswer seam the entry uses is covered.
- fix-loomwright-1-6: No changeset added: the change already carries tui-findings-log-scroll.md, which covers this fix.
- fix-loomwright-1-6: Did not run the real-opencode E2E (opt-in) or the manual TUI run.
- test-loomwright: SIGINT/SIGTERM are not delivered to the live entry in tests: the handler calls process.exit, which would terminate the runner. The scenario is covered structurally by launcher.test.ts::no source file ever signals, kills or waits on a child plus the quit-leaves-child-alive UI test, not by raising the signal.
- test-loomwright: Doc/ADR scenarios are tested in the repo-level test/docs.test.ts (not packages/tui), which is where the existing docs suite lives.
- test-loomwright: No non-test files were touched; full `bun run test` (1611 pass, 5 skip), typecheck, lint and format:check are green.
- fix-loomwright-2-2: Pre-existing, out of scope: with zero gate results the `no gate results` row still costs one row beyond a zero gate budget, so a 12-line notice plus an empty gate list can exceed 24 lines; there is no gate count to fold in that case.
- fix-loomwright-2-2: No new changeset added — the change already ships `.changeset/tui-findings-log-scroll.md`.
- fix-loomwright-2-3: Did not run the full `bun run test` suite; ran the docs suite and the cheap gates instead.
- fix-loomwright-2-4: Test-only change; no production behaviour touched.
- fix-loomwright-2-4: Did not rerun the full suite after the final assertion tightening, but the touched suite (31 tests) passes.
- fix-loomwright-2-5: Footer ordering changes for any panel with an inert hint: the reason now leads at wide widths too. The spec and docs only require the reason to be shown, and the snapshot fixtures are updated.
- fix-loomwright-2-5: Only the 80-column boundary named in the finding was asserted; a reason longer than a full row would still clip, which matches the existing footer clip policy.
- fix-loomwright-3-1: At 80x24 a long failure notice is displayed one line shorter; the dropped line is the oldest rendered log-tail line, and the full notice/log path remains in the UI data and log file.
- fix-loomwright-3-1: The notice cap assumes the documented 80x24 minimum; below roughly 14 rows the detail minimum still cannot fit.
- fix-loomwright-3-1: No changeset was added; this change owns its release task separately.
- fix-loomwright-3-2: At 120x40 the list pane is only 60 columns, so trailing metadata (elapsed/cost) can still be clipped when the id and summary are long; the marker remains visible.
- fix-loomwright-3-2: Very long metadata on an active row at 80 columns necessarily clips the id/summary more aggressively; all measured metadata fields still fit in the covered cases.
- fix-loomwright-3-2: No new changeset added because the parent change already carries .changeset/tui-findings-log-scroll.md.
- fix-loomwright-3-3: At 80 columns the clipped reason ends at 'add-health is being driven by ...', so the pid/name clause is only visible from 120 columns or in the w notice.
- fix-loomwright-3-3: Ran the full `bun run test` (1618 pass, 5 skip) plus format, lint and typecheck.
- fix-loomwright-3-4: Inner width is derived from Ink's classic border and paddingX={1}; a future border style or padding change must update the -4.
- fix-loomwright-3-4: Frame snapshot fixtures were unchanged, so the clipping only surfaces on content wider than the panel inner width.
- fix-loomwright-3-5: A raw unparsed escape sequence pasted while composing now leaves its printable tail (e.g. ESC[2J becomes [2J); this is inert text, but it changes what the field shows compared with before.
- fix-loomwright-3-5: No new changeset added: .changeset/tui-findings-log-scroll.md already covers this TUI change.
- fix-loomwright-4-1: The forward-delete escape sequence (Esc[3~) is also reported as `key.delete` by Ink, so it now deletes the last character too; this matches the reviewer's requested fix but is a slight broadening of delete semantics.
- fix-loomwright-4-1: Full `bun run test` (1634 tests), format, lint and typecheck all pass locally; no changeset added because .changeset/tui-findings-log-scroll.md already covers this feature.
- fix-loomwright-4-2: Wording follows docs/tui.md and the change spec; if the overlay keys change again, README must be updated by hand (no test pins this bullet).
- fix-loomwright-4-2: Biome's markdown table formatter flips the large config table when unrelated 4-line edits are made; I chose phrasing that leaves the table untouched, keeping the diff to 4 lines.
- fix-loomwright-5-1: The raw single-pane tail budget is 19 rows while the rendered tail is 17 (title and blank line are chrome), so the test pins singlePaneTailRows at 19 and checks the floor via the rendered newest four lines.
- fix-loomwright-5-1: Only the TUI suite, typecheck, lint and format check were run; the full repo test suite is left to the factory gate.
- fix-loomwright-5-2: At 80 columns a row with both a findings marker and long metadata still clips the metadata tail (cost/elapsed); that is the intended trade-off of the fix.
- fix-loomwright-5-2: The two-pane list (<half width) behaviour is unchanged: the head still takes all marker room and metadata may be empty.
- fix-loomwright-5-2: Frame fixtures were not regenerated because none of the pinned list rows changed output.
- fix-loomwright-5-3: A user who scrolls up to read findings and then presses a text-editing key is snapped back to the prompt; this is intended but is a visible offset jump.
- fix-loomwright-5-3: Panel-open state can still show findings only until the first keystroke; scrolling on open would require passing viewport dimensions into openReword or entry.tsx.
- fix-loomwright-5-4: q still does nothing in the activity pane and the questions record view; this is now documented instead of changed, matching the review's accepted docs-only fix.
- fix-loomwright-5-4: The adjacent ? row still says 'Everywhere' though help is likewise not global in panels/text fields; left untouched as out of scope for this finding.
- fix-loomwright-5-4: Did not run the full bun run test suite; only the docs suite plus format, lint and typecheck were run.
- fix-loomwright-6-1: The reword clause is defensive: awaiting-approval runs have no available reword, so that path is covered by a unit test rather than an end-to-end run.
- fix-loomwright-6-1: Existing `.changeset/tui-findings-log-scroll.md` covers the parent change; no new changeset added.
- fix-loomwright-6-2: Attempt 1 failed on the factory's git commit (exit 128), not on a code gate; no lock or merge state remained, so I could not reproduce or fix the cause without committing.
- fix-loomwright-6-2: Widths are measured in UTF-16 string length, not terminal cells, matching the repo's existing truncate/clip behaviour; wide glyphs could still overflow in theory.
- fix-loomwright-7-1: In this render harness Ink previously let the right content use the full remainder (the 60-cell line fit), so the reported re-truncation was not reproducible here; the new budget still matches the padding model and the regression test fails on the old arithmetic.
- fix-loomwright-7-1: The 120-column design-activity line now loses its last three characters at 120 columns by design; the fixture records this.
- fix-loomwright-7-1: Pre-existing and out of scope: at 100 columns the left task-graph title can still be truncated by Ink with '…' when a title is long (seen while testing a task-bearing 100-column run); the new test uses a task-less run to isolate the right pane.
- fix-loomwright-7-2: Behavioural change: q now quits while the abort confirmation or the questions record list is open (previously inert there), which matches the spec's 'q SHALL still quit from every state' but differs from prior live-UI behaviour.
- fix-loomwright-7-2: No changeset added: the change branch already carries .changeset/tui-findings-log-scroll.md.
- fix-loomwright-7-3: In enabled-hint overflow states the footer necessarily omits one valid contextual key; the reported state now omits L log instead of dropping q quit / ? help.
- fix-loomwright-7-3: The chosen drop order is rightmost optional hint; if a different priority order is expected later, hidden tests could pin another key.
- fix-loomwright-7-4: The full suite was run once after the source change (1646 pass, 5 skip); after adding the extra gate assertion only the affected views test, format, lint and typecheck were re-run.
- fix-loomwright-7-4: No changeset was added because the parent change already carries its release changeset and prior review-fix commits in this branch follow the same pattern.
- fix-loomwright-7-4: The test pins the 58/59-cell pane split at 120 columns; an intentional layout change would need that assertion updated.
- fix-loomwright-8-1: No changeset added: this change already carries changesets from sibling tasks, and the factory gates do not check them.
- fix-loomwright-8-1: Did not run the full `bun run test`; ran the whole `packages/tui/test` suite (439 pass) plus format, lint and typecheck.
- fix-loomwright-8-2: No separate changeset added: packages/tui is already covered by the existing tui-findings-log-scroll changeset on this change branch.
- fix-loomwright-8-2: Full gates were run: format:check, lint, typecheck and bun run test (1652 pass, 5 skip, 0 fail).
- fix-loomwright-9-1: PanelBox itself still counts one panel entry as one row; a different panel that embeds newlines without splitting them would still overflow. This fix removes the embedded newlines at the intake source rather than changing PanelBox for all panels.
- fix-loomwright-9-1: Full suite ran green: 1655 pass, 5 skip, 0 fail; format, lint and typecheck also pass.
- fix-loomwright-9-2: At widths below the supported 80-column minimum the lock label itself could still be clipped; above 80 only extreme metadata values (very long elapsed/token/cost/pid) cause the leading metadata fields to be dropped.
- fix-loomwright-9-2: Only the header row was changed; the adjacent approval banner still relies on Ink truncation but its text fits at 80 columns.
- fix-loomwright-9-3: Test-name-only change; no production code or assertions altered, so no regression risk.
- fix-loomwright-9-3: No new changeset added: the change already carries .changeset entries and this is a test-only rename.
- fix-loomwright-10-1: Raw question text is written to the command inbox; it is already stored in run state, but any terminal control sequences present in that stored text are now forwarded verbatim to Factory.answer instead of being stripped by flat().
- fix-loomwright-10-1: Did not add a new changeset: the branch already has .changeset/tui-findings-log-scroll.md covering this change.
- fix-loomwright-10-2: The resize event listener wiring inside the Ink component is not directly unit-tested (no ink-testing-library in the repo, same as Interactive); tests cover the size normalisation plus the rebuild/render path it drives.
- fix-loomwright-10-2: Relies on process.stdout (as the finding asked and as Interactive does), not the injected TerminalSession, so a session-backed resize test would need a rendering harness.
- fix-loomwright-10-3: Did not run the full repo test suite; only packages/tui/test plus format, lint and typecheck were run locally.

## Open questions

- design: Contract-phase activity: should the single cross-repo contract-review session appear in every touched repo's task detail (needing one additive optional repo field or a forbidden config read), or stay in the run scope as planned, with only contract-fix tasks scoped to their repo?
- context-packs: Should the plan widen task 4.1's touches to include packages/tui/test/views.test.ts (the 24-task tail-floor assertion), or leave that file red until 6.3? Widening keeps every per-task gate green; leaving it keeps touches minimal but produces a failing suite for two tasks.
- 7.1: Should the PanelBox ASCII-clipping fix be scheduled as a follow-up so the 80-column reword snapshots can pin the inner keys row too?

## Usage

Total: 322.38M tokens (312.23M cache read, 613.3k out) · cost n/a over 70 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| implementer-loomwright | 160.16M | 50% | cost n/a |
| reviewer | 132.32M | 41% | cost n/a |
| architect | 20.08M | 6% | cost n/a |
| tester | 6.73M | 2% | cost n/a |
| explorer | 3.08M | 1% | cost n/a |
| orchestrator | 12.1k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 132.32M | 41% | cost n/a |
| 6.3 | 17.47M | 5% | cost n/a |
| 4.1 | 15.99M | 5% | cost n/a |
| fix-loomwright-6-2 | 15.41M | 5% | cost n/a |
| 7.1 | 11.09M | 3% | cost n/a |
| context-packs | 10.39M | 3% | cost n/a |
| design | 9.69M | 3% | cost n/a |
| 6.2 | 8.01M | 2% | cost n/a |
| 5.1 | 7.20M | 2% | cost n/a |
| 3.2 | 6.74M | 2% | cost n/a |
| test-loomwright | 6.73M | 2% | cost n/a |
| fix-loomwright-4-1 | 6.66M | 2% | cost n/a |
| 1.1 | 6.03M | 2% | cost n/a |
| 6.1 | 5.37M | 2% | cost n/a |
| fix-loomwright-3-2 | 5.10M | 2% | cost n/a |
| 8.1 | 3.90M | 1% | cost n/a |
| fix-loomwright-3-1 | 3.68M | 1% | cost n/a |
| fix-loomwright-8-2 | 3.34M | 1% | cost n/a |
| fix-loomwright-7-1 | 3.15M | 1% | cost n/a |
| explore:loomwright | 3.08M | 1% | cost n/a |
| fix-loomwright-5-2 | 2.45M | 1% | cost n/a |
| 1.2 | 2.44M | 1% | cost n/a |
| fix-loomwright-7-4 | 2.42M | 1% | cost n/a |
| fix-loomwright-6-1 | 2.24M | 1% | cost n/a |
| fix-loomwright-9-2 | 2.09M | 1% | cost n/a |
| fix-loomwright-3-4 | 1.95M | 1% | cost n/a |
| fix-loomwright-1-1 | 1.93M | 1% | cost n/a |
| fix-loomwright-9-1 | 1.81M | 1% | cost n/a |
| fix-loomwright-1-3 | 1.68M | 1% | cost n/a |
| fix-loomwright-10-2 | 1.59M | 0% | cost n/a |
| fix-loomwright-1-4 | 1.53M | 0% | cost n/a |
| fix-loomwright-1-5 | 1.52M | 0% | cost n/a |
| fix-loomwright-2-5 | 1.44M | 0% | cost n/a |
| 2.1 | 1.41M | 0% | cost n/a |
| fix-loomwright-7-3 | 1.36M | 0% | cost n/a |
| fix-loomwright-5-4 | 1.35M | 0% | cost n/a |
| fix-loomwright-3-3 | 1.14M | 0% | cost n/a |
| fix-loomwright-2-1 | 1.07M | 0% | cost n/a |
| fix-loomwright-10-1 | 980.0k | 0% | cost n/a |
| fix-loomwright-2-2 | 973.6k | 0% | cost n/a |
| fix-loomwright-5-1 | 906.4k | 0% | cost n/a |
| fix-loomwright-3-5 | 902.1k | 0% | cost n/a |
| fix-loomwright-1-2 | 867.0k | 0% | cost n/a |
| fix-loomwright-4-2 | 760.4k | 0% | cost n/a |
| fix-loomwright-2-4 | 741.6k | 0% | cost n/a |
| fix-loomwright-8-1 | 666.3k | 0% | cost n/a |
| fix-loomwright-5-3 | 648.3k | 0% | cost n/a |
| fix-loomwright-7-2 | 626.1k | 0% | cost n/a |
| fix-loomwright-10-3 | 439.8k | 0% | cost n/a |
| fix-loomwright-1-6 | 342.3k | 0% | cost n/a |
| 3.1 | 335.9k | 0% | cost n/a |
| fix-loomwright-9-3 | 253.7k | 0% | cost n/a |
| fix-loomwright-2-3 | 152.9k | 0% | cost n/a |
| intake | 12.1k | 0% | cost n/a |

Top consumers: review:loomwright (132.32M), 6.3 (17.47M), 4.1 (15.99M), fix-loomwright-6-2 (15.41M), 7.1 (11.09M).
Retry overhead: 9.08M tokens (3%).
Wasted re-reads of unchanged files: 241.
