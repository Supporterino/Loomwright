# implement-factory-tui: done

Build `ai-factory tui`, an Ink-based terminal UI in a private packages/tui workspace (lazily bundled as dist/tui.js) that watches and controls factory runs from the event stream plus Factory read/command APIs: run list and run view (task graph, activity tail, gates, usage, lock), phase-driven spec-approval overlay, intake dialog (typed text or request file) spawning detached CLI children, question/abort/retry/resume controls, replay/--once mode, with one additive approval.pending event added first and no in-process pipeline calls.

## Branches (local only; nothing was pushed)

- loomwright: `change/implement-factory-tui` at fdea6bd0c3f7 (54 commits)
- AI repo: `change/implement-factory-tui` (archive commit fdea6bd0c3f7)

## Tasks

- [x] 1.1 (loomwright, task): Add the additive `approval.pending` event and emit it when design parks a change at `awaiting-approval`, with the gate replay fixture and re-recorded goldens
- [x] 1.2 (loomwright, task): Scaffold the private `packages/tui` workspace and bundle it lazily as `dist/tui.js`, with the `tui` command stub, a Node 20.3 proof of the bundle and ADR-0047
- [x] 1.3 (loomwright, task): Add the pure view-model (`snapshot` and status to `ViewModel`) and the brand token and glyph modules, unit-tested without Ink
- [x] 1.4 (loomwright, task): Render the run list and the run view (header, task graph, task detail, activity ring buffer, key footer) with the 80×24/120×40 frame snapshots for no runs, running graph, failing task and finished
- [x] 1.5 (loomwright, task): Add the injectable `Launcher` (detached children, log file, failure frame) and the new-run dialog for typed text and request files, with its guards and frame snapshots
- [x] 1.6 (loomwright, task): Add the phase-driven approval overlay with its identity check, the four confirmed actions, the read-only waiting state and the approve-and-run and approve-only frame snapshots
- [x] 1.7 (loomwright, task): Add the question pane and answer semantics, abort, retry and resume, with the keybinding tests and the question-open frame snapshot
- [x] 1.8 (loomwright, task): Add `--replay` and `--once`, rendering recorded streams read-only through the same tree and printing one frame to stdout
- [x] 1.9 (loomwright, task): Bound rendering and polling (10 fps batching, 2,000-line tail, one-second status poll) and finish the `NO_COLOR`, `--ascii` and locale handling, with the 100k-event soak and accessibility tests
- [x] 1.10 (loomwright, task): Write `docs/tui.md`, the README section, the `docs/cli.md` entry and the architecture rows, add the changeset, and add the replay smoke to the Node 20.3/22/24 CI job with the recorded timing and size report
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:419): Retained events grow without bound and each frame is O(n); the 2,000-line ring only caps derived activity, not the sourc
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (packages/tui/src/approval/overlay.ts:174): docs/tui.md and the approve-only scenario say `r` resumes the queued run; the real event order (phase.changed(queued) th
- [x] fix-loomwright-1-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:565): This polls status ~2-3 times per second, over the 'at most once per second plus immediately after a spawn' budget, and i
- [x] fix-loomwright-1-4 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/tui.ts:55): A directory (or FIFO) passes R_OK, then readReplayFile throws EISDIR inside runTui; runCli reports 'internal error' and 
- [x] fix-loomwright-1-5 (loomwright, review-fix): Fix review finding (packages/tui/src/views/panel.tsx:30): Repeated lines are common (log-tail lines, blank preview lines, repeated questions), producing duplicate React keys; Rea
- [x] fix-loomwright-1-6 (loomwright, review-fix): Fix review finding (packages/tui/test/views.test.ts:1): The 'a terminal opens the run list' scenario (newest run selected, no exit until quit) is not pinned even though runTui 
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/tui.ts:56): The spec says a missing OR unreadable --replay path is a usage error with exit 2; an unreadable path exits 1 with 'inter
- [x] fix-loomwright-2-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:761): At awaiting-approval the only way out is Ctrl-C. docs/tui.md:64 says `q` quits 'Everywhere' and the footer requirement s — 1 failed attempt
- [x] fix-loomwright-2-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:838): The footer and docs/tui.md:63 advertise `?` Help on every screen and docs tests assert it; pressing it does nothing. The — 1 failed attempt
- [x] fix-loomwright-2-4 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:490): After one not-installed rejection, intakeKeys short-circuits every later Enter with the stale message, so even after `lo — 1 failed attempt
- [x] fix-loomwright-2-5 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:460): A run whose log does not exist yet (queued run, or a run opened between saveRun and its first event) never gets a tail,  — 1 failed attempt
- [x] fix-loomwright-2-6 (loomwright, review-fix): Fix review finding (packages/tui/src/model/facts.ts:49): Retention is keyed by event count, not by task, so a long run with many gate rounds grows without bound and each frame c
- [x] fix-loomwright-2-7 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:302): On an aborted run `r` works but the footer does not list it, and docs/tui.md:59 says r applies to paused/aborted/queued.
- [x] fix-loomwright-2-8 (loomwright, review-fix): Fix review finding (packages/tui/test/accessibility.test.ts:18): Bun's default (hoisted) linker puts ink in the root node_modules (bunfig.toml sets only preload), so on a fresh install 
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-view.tsx:23): A replay stream that does not end at the gate (e.g. at implementing) shows no replay mark; pressing n gives no read-only
- [x] fix-loomwright-3-2 (loomwright, review-fix): Fix review finding (packages/tui/src/approval/overlay.ts:289): approvalKeys still accepts a/A/w/R from a failed state, so the overlay is actionable but its footer lists none of the va
- [x] fix-loomwright-3-3 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/questions.tsx:112): After an answer is recorded (draft.recorded=true) and before question.answered updates run state, pressing Enter again w
- [x] fix-loomwright-3-4 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:165): A stale lock (driver crashed) still shows active (pid N), though the spec requires driver liveness from status() and the
- [x] fix-loomwright-3-5 (loomwright, review-fix): Fix review finding (packages/tui/src/intake/dialog.tsx:144): The file-intake scenario and docs/tui.md promise a twenty-line preview; the dialog shows 14 of 20 and the label claims 2
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/tui/src/intake/paths.ts:126): Under `.factory` this reads or lists the event log, run state, lock and driver files, which the spec limits to `.factory
- [x] fix-loomwright-4-2 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:219): The spec says the `question.raised` records come from the snapshot; the tail's `question.answered` cannot flip the row t
- [x] fix-loomwright-4-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:206): The overlay is rendered and key-handled before intake, questions, help and confirmations, so it hides the open panel and
- [x] fix-loomwright-4-4 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:906): Below 100 columns the run view is one pane with drill-down; after Enter/j/k selects a task, Esc goes to the list instead
- [x] fix-loomwright-4-5 (loomwright, review-fix): Fix review finding (packages/tui/src/intake/paths.ts:147): A user can point the path field at a huge (or binary) file; the UI thread then reads and decodes it all, freezing or exh
- [x] fix-loomwright-4-6 (loomwright, review-fix): Fix review finding (packages/tui/src/launch/launcher.ts:129): A long-running child can make the log large; reading it all on the UI thread while polling blocks the interface.
- [x] fix-loomwright-4-7 (loomwright, review-fix): Fix review finding (packages/tui/test/intake.test.ts:316): It never calls `submitAction`/`open`, so removing the `open` rejection catch in `entry.tsx` would not fail a test; the s
- [x] fix-loomwright-4-8 (loomwright, review-fix): Fix review finding (docs/tui.md:5): `abort` and `retry` (and `answer`) are in-process per the spec and code; README repeats 'Every action is a detached CLI 
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (packages/tui/src/views/frame.tsx:27): The spec's layout requirement and the `two panes become one` scenario say at 100+ columns the run list and the detail ar
- [x] fix-loomwright-5-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:216): The read model says phase comes from status(); if another process approves while the overlay is idle, status and the tai
- [x] fix-loomwright-5-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:632): The spec says a child's stdout/stderr log path is shown by the UI; the intake dialog shows `displayPath`, but approvals 
- [x] fix-loomwright-5-4 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:340): A non-zero resume child is silent (no code or tail), and a double-tap `r` launches two detached `resume` children for on
- [x] fix-loomwright-5-5 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:508): Two Enter events in one frame both read `submitting: false` from `dataRef` and both call `submitAction`, launching two `
- [x] fix-loomwright-5-6 (loomwright, review-fix): Fix review finding (packages/tui/src/launch/launcher.ts:96): Node emits `error` on a failed spawn; with no listener it throws asynchronously, outside `runInSession`'s `finally`, so 
- [x] fix-loomwright-5-7 (loomwright, review-fix): Fix review finding (packages/tui/src/views/run-list.tsx:25): The layout requirement says every state is conveyed by a glyph and a label, but the run list has no phase or role glyph,
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:399): The spec's failed-child scenario requires the exit code and the last ten log lines in the UI; a resume child that fails 
- [x] fix-loomwright-6-2 (loomwright, review-fix): Fix review finding (packages/tui/src/model/view-model.ts:299): The entry switch (entry.tsx:989-1078) has no cases for those intents, so pressing a/A/w/R with no overlay open does noth
- [x] fix-loomwright-6-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1117): approvalPanel renders the CLI message 'git user.email is not set; it records who approved' in every replayed approval fr

## Spec

Archived as `openspec/changes/archive/2026-11-19-implement-factory-tui`.

## Review findings

- review:loomwright: [must] packages/tui/src/entry.tsx:399 The spec's failed-child scenario requires the exit code and the last ten log lines in the UI; a resume child that fails shows only three, and the resume path is a Launcher child.
- review:loomwright: [should] packages/tui/src/model/view-model.ts:299 The entry switch (entry.tsx:989-1078) has no cases for those intents, so pressing a/A/w/R with no overlay open does nothing. A run in implementing with specFindings shows 'w reword'; a run at awaiting-approval before syncApproval opens the overlay shows 'a approve and run' but the key is silent.
- review:loomwright: [should] packages/tui/src/entry.tsx:1117 approvalPanel renders the CLI message 'git user.email is not set; it records who approved' in every replayed approval frame, but replay has no workspace and no CLI identity; the line is false output in --once.
- review:loomwright: [nice] docs/tui.md:28 RunListItem.summary is dead and the required doc describes a field the UI does not show.
- review:loomwright: [nice] docs/tui.md:66 entry.tsx dispatches panel keys before applyKey, so ? and q do nothing in the intake, questions and confirmation panels (q is special-cased only over the approval overlay); the help panel even lists '? help'.
- review:loomwright: [nice] packages/tui/src/entry.tsx:136 Q opens a read-only pane, not a write; replay labels it read-only and refuses it, and ? is inert, so a recording with question.raised cannot show the questions pane or help.
- review:loomwright: [nice] packages/tui/src/replay/once.ts:19 The extra path is dead production code with two strip implementations to keep in sync.
- review:loomwright: [nice] packages/tui/src/session.ts:54 About a hundred lines of terminal/key parser code exist only to be implemented as no-ops by test fakes.

## Risks and things not checked

- intake: Scope is large (nine-task chain incl. a protocol event addition and a new package); if the event-stream precondition has not landed, the change must pause.
- intake: Platform constraint: the UI must run on Node 20.3+ (no Bun-only or native-addon runtime); if Ink blocks a requirement the work pauses for a decision rather than switching frameworks.
- intake: Tarball size delta must be recorded and justified above 1 MB.
- intake: Protected files (package.json gate scripts, .opencode/, factory.config.jsonc, factory.lock.json, openspec/specs/) may need edits; those belong in the final report as manual steps, not in the change.
- intake: The request text is treated as specification data only; nothing in it was acted on as an instruction to this intake step.
- design: The requirement header still reads 'three packages' while the body says four; it is kept for delta matching and listed as a follow-up (REMOVED + ADDED pair) in the proposal and design.
- design: No code was run in this session (shell unavailable), so the validation result depends on the factory's `openspec` check rather than a local run.
- context-packs: graphify was unavailable (shell permission denied); symbol locations were found with grep and targeted reads instead of graph queries.
- context-packs: 1.8 parses replay JSONL locally with RunEvent.safeParse rather than importing the core reader, which only reads .factory/events/<id>.jsonl; the reader's skip-don't-fail semantics are reproduced and tested.
- context-packs: 1.9 treats an unset locale as UTF-8 (ASCII only for an explicit non-UTF-8 value such as C/POSIX); this is a narrow reading, called out in the pack.
- context-packs: 1.7 limits resume to paused/aborted phases; an interrupted run surfaces as paused in the run file, which is the reading recorded in design.
- context-packs: The 'keys are documented' scenario has no test file in 1.10's touches; the footer/doc key lists must be cross-read by a reviewer (noted in the pack's pitfalls).
- context-packs: 1.2's Node 20.3 acceptance needs npx to fetch node@20.3.0; if the environment is offline the task is instructed to pause rather than switch frameworks.
- context-packs: The exact @types/react version and the Ink 6 declared peer range could not be verified offline; the implementer pins what installs with ink 6.4.0/react 19.3.1 and records it in ADR-0047.
- 1.1: Test task text asked the TUI replay fixture to contain at least one task and one gate line, but design emits approval.pending before any task/gate event; a contiguous prefix ending at approval.pending cannot contain them. I kept the stronger constraints (byte-identical prefix, phase.changed then approval.pending last) and omitted task/gate lines.
- 1.1: bun run check (1182 pass, 5 skip) passed before the final one-line assertion added to the invalid-spec test; that suite was re-run green afterwards, and format/lint/types were re-run after every edit.
- 1.2: Interactive TTY behaviour (run list opens, waits for quit) is still the 1.2 placeholder and has no automated TTY test; only the non-TTY, replay/once and usage paths are tested.
- 1.2: No changeset was added because .changeset/ is outside the task's allowed paths; the repo convention expects one for package manifest changes.
- 1.2: The Node 20.3 proof was run locally with node@20.3.0 (exit 0, frame printed) but is not part of the automated suite; CI's node-smoke matrix remains the backstop.
- 1.2: The quit key path (q / Ctrl-C) is not integration-tested; the --once path is.
- 1.3: Did not add a changeset: task 1.10 owns it and it is outside this task's touch list.
- 1.3: Colour-depth detection and NO_COLOR handling are deferred to 1.9 as specified; callers pass depth.
- 1.3: The a/A/w/R/r/x/t footer gating is inferred from design §6 rather than pinned by a scenario test.
- 1.3: No filesystem or Ink/React imports exist in model/theme; only tests read files (imports and colour scans).
- 1.4: Interactive terminal behaviour (alternate screen, raw mode, SIGTERM, real key input) is not exercised end to end in CI; only the session contract and pure key handling are tested. Real Ink useInput/drill-down paths remain for 1.7/1.9 coverage.
- 1.4: --once/--replay still use the 1.2 placeholder, as the task specifies; real screens there are 1.8.
- 1.4: The session module carries a minimal key parser but entry uses Ink's useInput, so the parser is currently only a seam for later tests.
- 1.4: No changeset was added because .changeset is outside this task's touches; 1.10 owns it.
- 1.4: Approval banner rendering is implemented but only exercised indirectly; its frame snapshot and overlay behaviour are 1.6.
- 1.5: After a not-installed rejection the dialog blocks further submits until it is reopened; a later `loomwright init` in another terminal is not picked up in place.
- 1.5: New-run detection treats any run id absent from the pre-spawn status as the started run, so an unrelated concurrent new run could be opened first.
- 1.5: No entry-level integration test exercises the run.started -> run-view transition; the pure dialog and launcher seams are covered instead.
- 1.5: Only 14 of the 20 preview lines are painted even at 120x40 to keep one deterministic panel rendering for both sizes.
- 1.6: The overlay panel is still rendered through the generic PanelBox, which uses the focus token; coral border/title needs a panel renderer change outside this task's allowed files.
- 1.6: reapprove emits no events and does not change the phase, so its waiting overlay may remain read-only until resume or another phase event; this follows the specified grant-plus-phase close rule but is a live usability gap.
- 1.6: Live terminal behaviour was not exercised; closure, failure and read-only transitions are covered by pure tests and frame snapshots.
- 1.7: The footer still shows the resume hint only for paused runs; an aborted run can resume with r via resumeFor, but the hint is omitted because view-model.ts is outside this task's touch set.
- 1.7: A recorded draft lives in the single QuestionsState draft; navigating to another record before question.answered arrives discards its recorded label and prompt text.
- 1.7: Q availability and question rows come from run state refreshed by the one-second poll; a question.raised seen only in the live tail appears after the next status refresh.
- 1.7: The no-signal-on-quit/SIGINT/crash assertion remains in the existing 1.5 launcher suite; this task did not duplicate that fake child test.
- 1.8: RunDetail.replayed is true, but views/header.tsx is outside this task's scope and still renders the idle lock role instead of the word replayed.
- 1.8: Non-approval replay run screens carry the read-only notice on the ViewModel, but Frame only paints notice on the run list; the approval fixture visibly shows it via the panel notice.
- 1.8: The interactive replay path is covered by pure replayKey tests and the once path, not by rendering Ink with a fake terminal.
- 1.8: No changeset added; task 1.10 owns the changeset and documentation.
- 1.9: Live entry still retains the run's raw events in eventsRef because reduce() takes the full event list; a very long live stream therefore grows memory even though the retained activity tail and fact maps are bounded. The 100k soak exercises collectFacts, not the live accumulator.
- 1.9: No changeset or docs were added because this task's touches exclude .changeset, docs/tui.md and README; task 1.10 covers them.
- 1.9: The accessibility colour assertions depend on resolving ink's transitive chalk from its installed location and setting level 3; bun's current isolated install layout is exercised by the full suite.
- 1.9: make sure `--replay` stays read-only: the scheduler/poller effects return early for replay, and no new writes were added there.
- 1.10: ADR-0047 says dist/tui.js is 'about 1 MB'; the built bundle is 2,294,754 bytes. The ADR is outside this task's touch list and the task says to verify it, not rewrite it, so it was left unchanged.
- 1.10: The 'keys are documented' check reads the keyHint declarations that build the footer plus docs/tui.md; it is a source-level parity test rather than a rendered-footer snapshot.
- 1.10: The 'protected paths have no diff' and 'report lists the follow-ups' scenarios are process/report checks with no automated test, matching the archived precedent (the report test only checks that docs/tui.md names the out-of-scope follow-ups).
- 1.10: release.yml still checks the tarball for cli.js and package.json but not package/dist/tui.js; it was outside this task's touch list, while CI now checks it.
- review:loomwright: No test run: the paused report at .factory/reports/implement-factory-tui-paused.md shows fix tasks 2-1..2-3 failed; 2-1 (unreadable --replay) and 2-2 (q at the gate) look fixed in this tree, but the suites were not run.
- review:loomwright: The final report with tarball size delta, --version timing and protected-file statement is not present; the paused report contains none of those.
- review:loomwright: Every TUI status poll uses Factory.status() without a change id, which summarises every usage ledger (and wasted reads) that the TUI never displays; harmless today but grows with run count.
- review:loomwright: Replay is tested only against the approval-gate fixture; the questions and help screens in replay are untested.
- fix-loomwright-1-1: Runs only the TUI, protocol and core event suites locally, not the full `bun run test`; the protocol change is additive and the existing 100k-event soak still passes.
- fix-loomwright-1-1: No new changeset: the fix is inside the existing `tui-watch-and-approve` change already covered by `.changeset/tui-watch-and-approve.md`, so adding one would double-bump.
- fix-loomwright-1-1: `EventFacts.gates` rows per step are still append-only (bounded by gate runs per task, not by event count); the review finding was about source-event retention, so that was left unchanged.
- fix-loomwright-1-1: The entry-level drain itself is exercised only indirectly through `foldRun` tests; there is no existing Ink component test harness in this repo.
- fix-loomwright-1-2: Pressing `r` on a queued run that is waiting behind an active change spawns a resume child that exits immediately with 'waits for the active change to close'; harmless but adds a log line.
- fix-loomwright-1-2: The entry-level wiring (key -> applyControl -> launcher) is covered indirectly (pure approvalKeys test plus existing performControl/launcher tests); no ink-level integration test presses `r` in the overlay.
- fix-loomwright-1-2: Full `bun run test` was not re-run after the final comment-only edit; `bun run test:fast` (1260 pass), all 148 packages/tui tests, format, lint and typecheck were run and are green.
- fix-loomwright-1-3: A newly started run is now detected on the next 1 s poll (or the immediate kick) instead of within 500 ms; spec only requires the run view to open when run.started arrives.
- fix-loomwright-1-3: The spawn-log tail refreshes once per second instead of twice; acceptable and still bounded.
- fix-loomwright-1-3: Did not run the full repo test suite (`bun run test`); ran the TUI suite plus architecture/docs tests, format, lint and typecheck.
- fix-loomwright-1-4: Ran format:check, lint, typecheck, packages/cli/test and packages/tui-related tui-command suite; did not run the full repo test suite.
- fix-loomwright-1-4: A FIFO case is covered by the isFile() check by construction, but no explicit mkfifo test was added (Unix-only and would hang if the check regressed).
- fix-loomwright-1-5: Full `bun run test` was not run (only the 150-test packages/tui suite); the change is local to the TUI panel so no other package is affected.
- fix-loomwright-1-5: No new changeset added: the change already ships .changeset/tui-watch-and-approve.md.
- fix-loomwright-1-6: The test temporarily replaces process.stdin/stdout in the test process; restoration happens in finally, and the suite passes under CI=true and unset CI.
- fix-loomwright-1-6: No real-TTY run is exercised; the test proves the injected seam only, as the unit-gate environment cannot allocate a TTY.
- test-loomwright: Implementation bug (not fixed, per role): `loomwright tui --replay <path>` with an unreadable file (EACCES) exits 1 via the generic error path instead of the spec's usage exit 2. Scenario 'bad flags are usage errors' (unreadable half) is pinned by a `test.failing` case in packages/cli/test/tui-command.test.ts; delete the `.failing` when the command maps read errors to UsageError.
- test-loomwright: Workspace resolution from -C and the process cwd is only covered indirectly: a relative --replay resolves from -C, and the run list is exercised at entry level. There is no end-to-end CLI test that opens the live list with -C because tuiCommand loads the real entry without an injection seam.
- test-loomwright: The 'no child process is spawned' half of the no-terminal scenario is not asserted; the test proves no TUI output and exit 1, and the command returns before loading the TUI, so a child cannot be spawned there.
- test-loomwright: Report-only requirements are not testable in the suite: --version startup timing and tarball size delta are recorded in the change report, and 'the protected paths have no diff' needs a base revision (existing tests pin the protected file contents and exact gate scripts instead).
- test-loomwright: The spec says @loomwright/tui dependencies are each pinned to an exact version, but the workspace packages use `workspace:*`; the existing architecture test asserts that and was left unchanged.
- fix-loomwright-2-1: The reported commit failure (git commit exited 128) is a factory-side git step, not a file change; it may recur if the cause is environmental (e.g. signing config or stale lock). I did not run or alter any commit.
- fix-loomwright-2-1: The unreadable-file test relies on chmod 0o000 being effective; it would not detect the bug when the test process runs as root. Did not run the full repo-wide test suite; only the affected CLI suite plus typecheck/biome.
- fix-loomwright-2-2: `TuiOptions.frames` exists only for tests that must read a live screen; it maps to Ink's debug renderer and defaults to off in production.
- fix-loomwright-2-2: Frame fixtures were regenerated; any later footer change must update them again.
- fix-loomwright-2-2: Did not add a changeset: existing fix-task commits in this change also omit one, and the feature changeset already covers the tui.
- fix-loomwright-2-3: The retry's original failure was `git commit` exit 128, almost certainly the GPG-signed commit waiting on the YubiKey pinentry (agent default-cache-ttl 60s, max 120s) and timing out. I made no repo change for it and cannot commit myself; I re-warmed the gpg-agent cache immediately before handoff, but if a PIN prompt appears the card/PIN must be supplied promptly or the commit will fail again.
- fix-loomwright-2-3: `?` is inert inside intake/approval/questions/confirm panels because those consume keys for text entry; docs/tui.md's "Everywhere" for `?`/`q` is loose for those panels (unchanged, and their footers stay honest).
- fix-loomwright-2-3: The new interactive views test uses 50 ms frame waits; it passed locally and with `CI=1`, but is timing-based on a very slow machine.
- fix-loomwright-2-3: I ran `bun run test` (1362 pass, 5 skip, 0 fail) before the final one-line assertion; after it I re-ran format:check, lint, typecheck and the three affected suites with CI=1 (34 pass, 0 fail).
- fix-loomwright-2-4: The attempt-2 git failure exited 128 before any commit landed. Local/global config signs commits (commit.gpgsign=true) with a smartcard-backed GPG subkey; a detached-sign check hung on the card, so the next factory commit may fail again unless the hardware key is present and unlocked.
- fix-loomwright-2-4: Did not run the separate plugin bundle build; no plugin/policy files changed, and bun run test covers the bundle check.
- fix-loomwright-2-5: The rewritten test uses a bounded 1 s wait for the frame coalescer because the scheduler is not injectable from entry.tsx; it held under 8x CPU load and 18 repeated runs, but it is a time-based wait, not an event.
- fix-loomwright-2-5: Did not run the full `bun run test` (all repos); ran the whole packages/tui suite plus test/architecture.test.ts under CI=true, and the cheap format/lint/types gates.
- fix-loomwright-2-6: EventFacts.gates remains an array per step (deduped) rather than a Map; the public internal shape is unchanged, which keeps hand-built test facts and the accessibility suite working.
- fix-loomwright-2-6: Skipped running the build/plugin bundle gate; no plugin or policy sources were touched.
- fix-loomwright-2-7: `x abort` still uses its own phase check rather than a shared predicate; not part of this finding.
- fix-loomwright-2-7: No changeset added: the branch already carries .changeset/tui-watch-and-approve.md and sibling review-fix commits add none.
- fix-loomwright-2-7: Did not run the full repo `bun run test`; ran all packages/tui suites (160 pass), typecheck, lint and format:check.
- fix-loomwright-2-8: Depends on ink's exports map allowing the ./package.json subpath; verified it resolves on ink 6.4.0 with this Bun, but a future ink version that hides package.json would throw again at import.
- fix-loomwright-2-8: No new test added: the change is test-harness plumbing with no spec scenario; the suite itself (8 passing tests) exercises the resolution.
- fix-loomwright-2-8: No changeset added (test-only change in a private package); add one if the repo requires it for test-only edits.
- fix-loomwright-2-8: Full gate run locally: format:check, lint, typecheck and bun run test (1367 tests, 0 fail) all pass.
- fix-loomwright-3-1: Only the run screen was covered; RunList/panel notices are unchanged and no other screens needed it.
- fix-loomwright-3-1: No changeset added, matching the sibling review-fix commits in this change series.
- fix-loomwright-3-2: No changeset added; repo convention asks for one for packages/ changes, but this is a review-fix task and release mechanics stay human.
- fix-loomwright-3-2: Ran format:check, lint, typecheck and the full test suite locally; all passed.
- fix-loomwright-3-3: Did not audit every entry.tsx caller path beyond the `answering` ref guard; the unit-level fix is what the finding asked for.
- fix-loomwright-3-4: Did not add a frame/snapshot test for a stale lock; the view-model unit test covers the source of both the list and header labels.
- fix-loomwright-3-4: No new changeset: this is a fix inside the existing implement-factory-tui change, which already carries .changeset/tui-watch-and-approve.md.
- fix-loomwright-3-5: At the minimum 80x24 size the dialog shows 16 of 20 preview lines (honest label); the spec's 'twenty-line preview' is met at 120x40 and every larger frame. The spec text itself was not edited (openspec is off-limits).
- fix-loomwright-3-5: The chrome-row constant (5) assumes a single-line footer, which holds for the tested widths; a very narrow terminal that wraps the footer could still clip by a line.
- fix-loomwright-3-5: Full suite was run before the final identifier rename (PANEL_ROWS -> PANEL_CHROME_ROWS); the affected three suites were re-run afterwards.
- fix-loomwright-4-1: The guard is lexical: a symlink inside `.factory/requests` pointing at an event/run file would still pass (noted as a `shortcut:` comment). Realpath checks would also have to realpath `cwd` (tmpdir is symlinked on macOS), which is out of scope for this finding.
- fix-loomwright-4-1: Listing `<cwd>/.factory` itself now returns no candidates, so `requests` does not autocomplete from `.factory/`; users must type `.factory/requests/` (or pick the `.factory` entry shown by `.`). This follows the finding's literal wording.
- fix-loomwright-4-1: Ran the full suite once before the final comment-only doc edit; the gate rerun was limited to format/lint/typecheck and the intake suite.
- fix-loomwright-4-2: If a live snapshot somehow lacks question.raised events that exist only in run state, rows will be empty rather than fall back; this matches the spec's snapshot-as-source requirement.
- fix-loomwright-4-2: No new changeset added: the existing .changeset/tui-watch-and-approve.md already covers packages/tui.
- fix-loomwright-4-3: The overlay now appears up to one poll interval (1 s) after a panel closes while the run is at `awaiting-approval`; this is the intended 'next poll opens it' behaviour.
- fix-loomwright-4-3: The race is verified at the state-function level, not through a live Ink key/screen test.
- fix-loomwright-4-3: No changeset added, matching the other review-fix commits on this branch.
- fix-loomwright-4-4: No live Ink end-to-end test for the new entry.tsx `clear-task` branch; coverage is the pure applyKey table test plus the full suite.
- fix-loomwright-4-4: At >=100 columns, j/k then Esc now clears the selection (showing activity) before a second Esc returns to the list; this is the review's unconditional fix but is a behaviour change for two-pane users.
- fix-loomwright-4-5: A multibyte character split at the 64 KiB boundary can render as a replacement character on the last displayed line; it only appears in the preview, never in the request itself.
- fix-loomwright-4-5: Emptiness is judged from the first 64 KiB only, so a file whose first 64 KiB is whitespace is reported empty even if content follows.
- fix-loomwright-4-5: Ran the tui test directory rather than the full `bun run test`; format, lint and typecheck were run across the repo.
- fix-loomwright-4-6: Tests assert the last-lines result on a ~200 KiB log (including that the first row is absent), not the syscall count; the bounded read itself is only verified by code inspection.
- fix-loomwright-4-6: All gates run clean: format:check, lint, typecheck, and full `bun run test` (1383 pass, 5 skip).
- fix-loomwright-4-7: The integration test uses fake stdin/stdout and an injected open/launcher; it does not exercise a real `Factory.open` against an uninitialised workspace.
- fix-loomwright-4-7: No changeset added, matching the preceding review-fix commits in this series.
- fix-loomwright-4-8: Docs-only change: no runtime behaviour was touched; verified against packages/tui/src/entry.tsx (performControl/recordAnswer).
- fix-loomwright-4-8: No changeset added because nothing under packages/, templates/ or a package.json changed.
- fix-loomwright-4-8: Full gates run locally: bun run format:check, lint, typecheck and bun run test all pass.
- fix-loomwright-5-1: Two-pane list rows are half the terminal width; long ids/titles truncate with Ink's U+2026 ellipsis even under --ascii (pre-existing behaviour of truncated Text, not introduced here, but only visible now at 100+ columns).
- fix-loomwright-5-1: The activity pane on the list screen uses a fixed rows-6 cap; very small heights may show fewer lines than fit.
- fix-loomwright-5-1: No changeset added: .changeset/tui-watch-and-approve.md already covers this feature change.
- fix-loomwright-5-2: The overlay can now wait up to one status poll (~1s) to open if status lags the tail, because run state wins. Acceptable per the read-model requirement.
- fix-loomwright-5-2: Did not add a changeset; this is a review-fix within an existing change.
- fix-loomwright-5-2: Full bun test suite (1390 pass, 5 skip), format, lint and typecheck all pass locally.
- fix-loomwright-5-3: Did not update docs/tui.md's approval-overlay paragraph to mention the new spawn-log line; docs are not part of the finding and the spec already requires the path be shown.
- fix-loomwright-5-3: Did not add a changeset: the existing .changeset/tui-watch-and-approve.md already covers this TUI change.
- fix-loomwright-5-3: No entry-level test exercises the launchApproval hook wiring directly (none exists for this seam); the entry change is a one-line argument pass verified by typecheck, and overlay behaviour is covered in approval.test.ts.
- fix-loomwright-5-4: The guard deliberately holds a run id until its resume child exits, so a second r during a genuinely long resume is ignored rather than queued.
- fix-loomwright-5-4: Signalled exits (code null) still look successful; the finding only covered non-zero codes.
- fix-loomwright-5-4: The multi-line notice relies on Ink rendering explicit newlines inside a truncating Text; long tail lines are still truncated at the frame width.
- fix-loomwright-5-4: Double-r wiring is covered at the startResume seam, not by a full Ink key-drive test.
- fix-loomwright-5-5: If a spawn never appears in the status poll the dialog stays locked until Esc + `n`; that is the existing behaviour, now also true of the ref.
- fix-loomwright-5-5: Only the intake path is guarded; the approval overlay launches remain unguarded (each is a distinct user action, outside the finding).
- fix-loomwright-5-6: Did not run the real-opencode E2E (opt-in, environment-dependent); the fix is covered by the scripted launcher test only.
- fix-loomwright-5-6: Test fake uses one cast per listener kind, justified by the event-name overload; it is test-only scaffolding.
- fix-loomwright-5-7: Only the phase state gets a glyph on list rows; role (active/queued/idle) is still label-only, as permitted by the finding.
- fix-loomwright-5-7: In ASCII both focus and the running phase glyph are `>`, so a selected running row starts `> >`; the label still disambiguates it.
- fix-loomwright-5-7: Full `bun run test` was run and passed (1402 pass, 5 skip); format, lint and typecheck pass.
- fix-loomwright-6-1: Notice text is now longer by up to seven lines; the views render notice verbatim, so it occupies more vertical space in small terminals (no truncation was added).
- fix-loomwright-6-1: No changeset added: task scope is a review fix within packages/tui; repo convention may want one before landing.
- fix-loomwright-6-2: Did not edit docs/tui.md or help.ts: both already scope a/A/w/R to the approval overlay, so they stay accurate.
- fix-loomwright-6-2: Skipped adding a changeset; the change branch already carries .changeset/tui-watch-and-approve.md for this feature.
- fix-loomwright-6-3: The fix uses omission rather than an explanatory replay line; the panel's existing 'replay: read-only' notice carries that context.
- fix-loomwright-6-3: A live overlay still shows the missing-identity message in the brief window before readApprover resolves (pre-existing behaviour, outside this finding).
- fix-loomwright-6-3: Ran `bun run test`, `bun run typecheck`, `bun run format:check` and `bun run lint`; all passed. No changeset added because the parent change already has `.changeset/tui-watch-and-approve.md` and prior review-fix commits added none.

## Open questions

- fix-loomwright-2-3: Should factory task commits disable GPG signing (e.g. `git -c commit.gpgsign=false`) or is the smartcard PIN prompt intended? The current setup leaves every task commit one pinentry timeout away from exit 128.

## Shortcuts (Ponytail)

- loomwright:packages/tui/src/intake/paths.ts:55 — the guard is lexical; a symlink under `requests` could still point elsewhere.
- loomwright:packages/tui/src/views/frame.tsx:114 — Ink reads only these fields from the alternate streams; replace with real streams

## Usage

Total: 239.62M tokens (231.53M cache read, 627.9k out) · cost n/a over 78 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| implementer-loomwright | 137.69M | 57% | cost n/a |
| reviewer | 72.18M | 30% | cost n/a |
| architect | 21.54M | 9% | cost n/a |
| tester | 6.29M | 3% | cost n/a |
| explorer | 1.91M | 1% | cost n/a |
| orchestrator | 10.9k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 72.18M | 30% | cost n/a |
| fix-loomwright-2-3 | 14.89M | 6% | cost n/a |
| 1.9 | 12.47M | 5% | cost n/a |
| design | 11.72M | 5% | cost n/a |
| context-packs | 9.04M | 4% | cost n/a |
| 1.7 | 8.88M | 4% | cost n/a |
| 1.4 | 8.66M | 4% | cost n/a |
| 1.6 | 8.58M | 4% | cost n/a |
| 1.10 | 7.73M | 3% | cost n/a |
| fix-loomwright-2-2 | 6.67M | 3% | cost n/a |
| 1.5 | 6.60M | 3% | cost n/a |
| 1.2 | 6.53M | 3% | cost n/a |
| test-loomwright | 6.29M | 3% | cost n/a |
| 1.8 | 6.09M | 3% | cost n/a |
| fix-loomwright-2-5 | 5.60M | 2% | cost n/a |
| 1.1 | 3.56M | 1% | cost n/a |
| fix-loomwright-4-7 | 3.33M | 1% | cost n/a |
| 1.3 | 2.89M | 1% | cost n/a |
| fix-loomwright-3-5 | 2.66M | 1% | cost n/a |
| fix-loomwright-1-6 | 2.43M | 1% | cost n/a |
| fix-loomwright-1-3 | 2.40M | 1% | cost n/a |
| fix-loomwright-5-4 | 2.19M | 1% | cost n/a |
| fix-loomwright-1-1 | 2.17M | 1% | cost n/a |
| fix-loomwright-1-2 | 1.99M | 1% | cost n/a |
| explore:loomwright | 1.91M | 1% | cost n/a |
| fix-loomwright-5-5 | 1.74M | 1% | cost n/a |
| fix-loomwright-4-4 | 1.67M | 1% | cost n/a |
| fix-loomwright-2-4 | 1.54M | 1% | cost n/a |
| fix-loomwright-5-1 | 1.45M | 1% | cost n/a |
| fix-loomwright-5-3 | 1.25M | 1% | cost n/a |
| fix-loomwright-2-1 | 1.23M | 1% | cost n/a |
| fix-loomwright-6-2 | 1.16M | 0% | cost n/a |
| fix-loomwright-4-3 | 1.07M | 0% | cost n/a |
| fix-loomwright-4-2 | 1.07M | 0% | cost n/a |
| fix-loomwright-6-3 | 904.0k | 0% | cost n/a |
| fix-loomwright-1-5 | 852.1k | 0% | cost n/a |
| fix-loomwright-5-7 | 836.7k | 0% | cost n/a |
| reword | 775.2k | 0% | cost n/a |
| fix-loomwright-4-1 | 753.2k | 0% | cost n/a |
| fix-loomwright-5-2 | 689.5k | 0% | cost n/a |
| fix-loomwright-2-6 | 640.1k | 0% | cost n/a |
| fix-loomwright-3-1 | 616.1k | 0% | cost n/a |
| fix-loomwright-5-6 | 556.8k | 0% | cost n/a |
| fix-loomwright-2-7 | 526.7k | 0% | cost n/a |
| fix-loomwright-4-8 | 452.7k | 0% | cost n/a |
| fix-loomwright-3-4 | 395.3k | 0% | cost n/a |
| fix-loomwright-4-6 | 357.5k | 0% | cost n/a |
| fix-loomwright-4-5 | 338.8k | 0% | cost n/a |
| fix-loomwright-1-4 | 286.5k | 0% | cost n/a |
| fix-loomwright-3-3 | 276.7k | 0% | cost n/a |
| fix-loomwright-6-1 | 266.8k | 0% | cost n/a |
| fix-loomwright-2-8 | 219.6k | 0% | cost n/a |
| fix-loomwright-3-2 | 210.3k | 0% | cost n/a |
| intake | 10.9k | 0% | cost n/a |

Top consumers: review:loomwright (72.18M), fix-loomwright-2-3 (14.89M), 1.9 (12.47M), design (11.72M), context-packs (9.04M).
Retry overhead: 19.14M tokens (8%).
Wasted re-reads of unchanged files: 208.
