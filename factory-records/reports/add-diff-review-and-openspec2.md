# add-diff-review-and-openspec2: done

The requester wants three improvements to Loomwright. First, support OpenSpec 2.x and later versions instead of only the currently supported 1.x line. Second, fix the TUI activity stream so it is scoped: when a single task is focused it should show only that task's activities, and when nothing is focused it should show everything as it does today. Third, add a new optional step at the end of a change, before land, that shows the diff between the finished change and main, available in both the CLI and the TUI.

## Branches (local only; nothing was pushed)

- loomwright: `change/add-diff-review-and-openspec2` at 46fbb6e5e989 (26 commits)
- AI repo: `change/add-diff-review-and-openspec2` (archive commit 46fbb6e5e989)

## Tasks

- [x] 1.1 (loomwright, task): Widen the OpenSpec version range and update its pin assertions
- [x] 1.2 (loomwright, task): Render OpenSpec 2.x output from `.agents` and commit it on install
- [x] 1.3 (loomwright, task): Protect generated `.agents/skills` and rebuild the plugin bundle
- [x] 1.4 (loomwright, task): Add the read-only change diff reader and share land's repo/base resolution
- [x] 1.5 (loomwright, task): Add the `diff` CLI command and the pre-land next-step hint
- [x] 1.6 (loomwright, task): Narrow the focused task's activity scope to its own lines
- [x] 1.7 (loomwright, task): Add the TUI `d` diff pane for done runs
- [x] 1.8 (loomwright, task): Record the ADRs and the changeset
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (docs/tui.md:86): The user docs contradict the new task scope and the new footer key; the docs requirement says the docs list the footer k
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/diff.ts:54): `--repo backend` still resolves/diffs every touched repo, so a missing base in an unrequested repo aborts the command; `
- [x] fix-loomwright-1-3 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1165): If intake/questions (or activity) is opened while the read is pending, `viewOf` shows the diff first while the key route
- [x] fix-loomwright-1-4 (loomwright, review-fix): Fix review finding (packages/tui/src/model/controls.ts:311): A diff opened while the land child runs survives; `viewOf` renders it over the list and hides the landed notice.
- [x] fix-loomwright-1-5 (loomwright, review-fix): Fix review finding (packages/tui/src/controls/diff-pane.ts:54): A patch line can carry C0/C1 sequences (`ESC[2J`, OSC 52); `renderFrame` strips only snapshots/`--once`, so the live TUI
- [x] fix-loomwright-1-6 (loomwright, review-fix): Fix review finding (packages/core/test/openspec-2.test.ts:124): The 2.x payload parsing for `validateChange`/`archiveChange`/non-JSON is unproven.
- [x] fix-loomwright-1-7 (loomwright, review-fix): Fix review finding (packages/cli/test/pipeline.test.ts:1162): No test name mentions 'a running change has no diff hint'; the TypeScript standard requires one.
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1547): `openReadOnly` deliberately opens the TUI without loading config (a missing or invalid `factory.config.jsonc` still list
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:1155): Every other async control flow (resume, land, reword) lives in `model/controls.ts` and is unit tested there; this one si
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/core/src/openspec/cli.ts:141): The spec says to append `--scope project` when the installed version is 2.1.0 or newer, and the flag exists to stop `ope
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (README.md:31): This change makes 2.2.0 the tested and recommended version (versions.ts, changeset, ADR-0051, lock, doctor), but the REA
- [x] fix-loomwright-5-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/diff.ts:80): A touched repo with no change branch and no resolvable base (a detached submodule without local/remote `main`, the state
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/diff.ts:80): A patch line is untrusted file content and can carry terminal control sequences (for example ESC[2J or an OSC 52 clipboa

## Spec

Archived as `openspec/changes/archive/2026-11-26-add-diff-review-and-openspec2`.

## Review findings

- review:loomwright: [nice] packages/tui/src/model/controls.ts:277 Press d on a done run, press n (or ? or L) before the read rejects: the failure sets the reader's error as notice behind that panel, so closing the panel later shows a stale 'reading the diff' failure for a diff the user abandoned. The success path already suppresses exactly this case.

## Risks and things not checked

- intake: The three asks (OpenSpec 2.x support, TUI activity filtering, pre-land diff review) are independent and likely differ in size and risk; one change id may produce an oversized spec and review.
- intake: OpenSpec 2.x support may break existing specs, templates and agent prompts; the scope of the compatibility promise was not stated by the requester.
- intake: Diff-review scope is unverified: unknown whether it compares the change branch against local main or a configured base, and whether binary/large diffs are in scope.
- design: The retained scenario titles use the old 'join the task' wording while their bodies assert the narrowed repo-only placement; the body is authoritative.
- design: No validation run was possible in this session; the fix was verified by reading the MODIFIED block and comparing scenario names with the current factory-tui spec.
- context-packs: openSpec-compatibility requirement text says `.agents/skills` is the protected path in `isProtectedPath`, the rendered rules and `protectedInWorktree`, but its scenario asserts `protectedInWorktree(root)` includes `<root>/.agents`, which contradicts design D3 ('custom agent skills may live there'). The pack instructs the narrow `.agents/skills` reading in all three layers and says to report the mismatch, so 1.3 may leave that one scenario assertion unsatisfied until a human decides.
- context-packs: Task 1.1 widens `tested` to 2.2.0, so every lock written by an old tool now reports `tested 1.14.3` vs `2.2.0`; packages/cli/test/update.test.ts loads test/fixtures/install-0.1.0.json and may surface it. That fixture is historical and outside 1.1's touches, so the pack tells the implementer to report rather than edit it.
- context-packs: Task 1.7 changes a user-facing key but docs/tui.md is outside its touches; test/docs.test.ts only pins the existing key list, so gates pass while the TUI key table stays silent about `d`. Flagged in the pack's handoff note.
- context-packs: 1.2 is proven only with stub binaries (no real 2.2 `init`), matching design D2; flag drift in `--scope`/`--profile`/`--no-animation` would only appear on a manual run.
- context-packs: 1.6 inverts several long-standing assertions in scope.test.ts and activity-pane.test.ts; the packs name the specific tests and expected values, but a reviewer should confirm the activity-pane.ts repo-scope tests still cover reviewer/install/full-suite lines.
- context-packs: No gate commands were executed in this session (shell unavailable); the listed commands are taken from package.json scripts and factory.config.jsonc gate mappings.
- 1.3: The spec scenario says `protectedInWorktree(root)` includes `<root>/.agents`; the requirement and design D3 say `.agents/skills`. Tests assert `.agents/skills`; reviewer should decide whether the scenario fixture wording needs aligning.
- 1.3: No changeset was added because `.changeset/*` is outside this task's touches, though repo convention asks for one for packages/ changes; the factory/landing step may need to add it.
- 1.3: sandbox.test.ts does not snapshot protectedInWorktree, so no out-of-scope edit was needed.
- 1.6: docs/tui.md line 86 still says a task's scope is the union of its own lines and its repo's; it is outside this task's touches, so it is now stale.
- 1.6: No changeset added: .changeset files are outside the task's touches, though repo convention asks for one for packages/ changes.
- 1.6: Full `bun run test` was run before the final test-only tweak to the repo-scope scenario; the affected suite plus format/lint/typecheck were rerun after it and pass.
- 1.1: Did not add a changeset: .changeset is outside the task's touches, though repo convention asks for one under packages/.
- 1.1: Full test suite was run before trimming one unused version from the new test's stub array; only that targeted suite was rerun afterwards.
- 1.4: No changeset added: `.changeset/` is outside this task's allowed edit scope; the repo convention asks for one for packages/ changes.
- 1.4: Graph query tooling is broken in this environment (graphify fails with ModuleNotFoundError: anyio), so the codebase was navigated with grep/read instead.
- 1.4: The 'no fetch' guarantee is enforced by code review, not asserted in tests (a fetch would not be visible in ref state); tests assert bases and change branches are unchanged.
- 1.2: No changeset was added: .changeset/* is outside the task's allowed file globs.
- 1.2: All openspec behavior is exercised with shell stubs; the real 2.2 init (which needs network/GitHub access) was not run, per the task.
- 1.7: docs/tui.md was outside the touches, so its key table still lacks a 'd diff' row.
- 1.7: No changeset was added because .changeset/ is outside the task's touches.
- 1.7: packages/tui/src/model/controls.ts (outside touches) does not clear diff in landSettled; in normal flow a land cannot start while the pane is open, but a land already in flight could settle over an open pane.
- 1.5: The spec does not pin --repo + --json together; I filtered the JSON rows, which is the narrower reading of 'restrict the output'.
- 1.5: No dedicated test covers a stopped 'implementing' phase for the absence of the hint; the awaiting-approval and paused paths are asserted, and report() only emits the hint at done.
- 1.8: `bun run changeset status` exits 1 on this repo with `Found mixed changeset …` because `@loomwright/core` is private/ignored. This is pre-existing: removing my changeset and running status fails on `.changeset/quiet-answers-persist.md` the same way. The new changeset itself parses (no frontmatter/parse error).
- 1.8: Did not add new assertions; `test/docs.test.ts` covers the ADR/index constraints and passes (40 tests). Full suite: 1816 pass, 11 skip, 0 fail.
- 1.8: Did not verify against a real OpenSpec 2.2 binary, by design (hermetic tests); the ADR records that 2.x is proven with stubs.
- review:loomwright: Shell was not permitted in this session, so I did not run `bun run check`/`bun run test`; findings rest on reading code, tests and fixtures.
- review:loomwright: tasks.md 1.7's touches list does not name packages/tui/src/model/controls.ts (where startDiff lives) or model/format.ts (the stripControls move); the design already notes the same for view-model.test.ts. Touches are frozen after approval, so this is informational only.
- review:loomwright: A very large change still builds the whole patch string in memory in both the CLI and the TUI pane; no size cap, as design.md says.
- review:loomwright: OpenSpec 2.x rendering/--scope is proven with stubs only; a real 2.2 init was not exercised.
- fix-loomwright-1-1: Ran the full gate locally: bun run format:check, bun run lint, bun run typecheck and bun run test all pass (1817 pass, 11 skip).
- fix-loomwright-1-2: Did not check whether the TUI should use the new options; its only reference to changeDiff is a comment, so no behavior change there.
- fix-loomwright-1-2: The spec text for change-diff-review was left untouched (openspec is outside this task's intent); it still says --repo restricts output, which remains true.
- fix-loomwright-1-3: A failure that resolves while a run panel is open still posts the error notice underneath the panel; only the then-path treats an open panel as stale, matching the finding's requested split.
- fix-loomwright-1-3: The existing `.changeset/add-diff-review-and-openspec2.md` already covers this change, so no new changeset was added.
- fix-loomwright-1-4: Relying on `landSettled` for every return-to-list path; the still-listed branch intentionally keeps the diff pane.
- fix-loomwright-1-4: No changeset added, matching the recent fix-only commits in this change branch.
- fix-loomwright-1-5: Only patch lines are stripped; repo name, target, branch and status in the header still come from config/git unchanged, so a hostile repo name could carry controls. Outside this finding.
- fix-loomwright-1-5: Ran the full suite locally (1824 pass, 11 skip) plus format:check, lint and typecheck; no new changeset because the unreleased add-diff-review-and-openspec2 changeset already covers the TUI diff pane.
- fix-loomwright-1-6: A changeset already exists for the parent change (add-diff-review-and-openspec2.md), so none was added for this test-only fix.
- fix-loomwright-1-6: Full `bun run test` was run before removing an unused helper parameter; the final targeted suite and all static gates were re-run afterwards.
- fix-loomwright-1-7: Only the paused phase is covered; implementing and awaiting-approval are exercised by existing inline `not.toContain` assertions elsewhere in the file.
- fix-loomwright-1-7: No changeset added for this test-only change.
- test-loomwright: The 'no engine imports' test permits the two intake files to reference .factory/ and the entry's changeDiff import; the d-only/on-done gating of that reader is proven separately in views.test.ts and replay.test.ts rather than in the import scan.
- test-loomwright: No implementation files were touched; the newly added/renamed tests passed against the current implementation.
- fix-loomwright-2-1: Only the invalid-JSONC path is covered by the new test; a missing config file goes through the same sync-throw-now-rejected path and is not separately tested.
- fix-loomwright-2-1: Did not manually exercise a real terminal with a broken config; verified via the scripted Ink harness only.
- fix-loomwright-3-1: Did not run `bun run build` (not one of the task gates) and did not add a changeset, since `.changeset/add-diff-review-and-openspec2.md` already covers this feature.
- fix-loomwright-4-1: An unsupported 3.x binary may not accept --scope either; the fix assumes the 2.1+ flag semantics persist into 3.x, which is the safer default versus silently dropping project scoping.
- fix-loomwright-4-1: Did not run the full slow suites excluded by test:fast (pipeline, workspace-install, reword, gates-run, review-loop, init, contract-gate).
- fix-loomwright-5-1: Did not run the full `bun run test` suite locally (docs-only diff); the factory gate will run it.
- fix-loomwright-5-1: Historical transcripts in docs/e2e/*.md and docs/research/tooling.md still mention OpenSpec 1.14.3; they are records of past runs, not install guidance, so they were left untouched.
- fix-loomwright-5-1: No changeset added because the change only touches README.md, not packages/, templates/ or a package.json.
- fix-loomwright-5-2: Did not check the TUI `d` pane directly; it calls changeDiff, so it inherits the fix, but no TUI test was added since the change was scoped to diff.ts and its CLI test.
- fix-loomwright-5-2: No new changeset added: .changeset/add-diff-review-and-openspec2.md already covers this change.
- fix-loomwright-6-1: Did not run bun run build or build:plugin; the plugin/policy bundle is untouched, so the committed plugin bundle should be unchanged.
- fix-loomwright-6-1: Only the patch content is sanitised; the repo header line uses config-provided repo/target/branch names, which are operator-controlled, not change content.

## Open questions

- intake: Should this be delivered as one change or split into three (OpenSpec 2.x support, TUI activity scoping, pre-land diff review)? I assumed one bundled change id for intake.
- intake: For OpenSpec 2.x: is the goal to support 2.x alongside the existing version, or to require 2.x minimum? Which spec/CLI changes are the blockers?
- intake: For the pre-land diff: should it be opt-in per run (flag/config) or always offered as an interactive prompt, and what should it diff against when the base branch is not 'main'?
- intake: For the TUI: does 'task focused' mean the task-detail selection, and should switching focus reset/filter the existing scrollback or only affect new events?
- design: Should OpenSpec 2.x become the hard minimum instead of keeping 1.x support alongside it? The design assumes dual support.
- design: Should the pre-land diff be opt-in via a flag/config instead of always available as a command and a done-run key? The design assumes always available, advertised at done.
- design: Should the TUI show the full unified patch or only a per-file diffstat? The design assumes the full patch in a scrollable pane.
- design: Is 'task focused' the selected task detail, and should switching focus filter the existing scrollback immediately? The design assumes yes to both.
- context-packs: For the openspec-compatibility requirement 'The .agents tree is installed, managed and protected': should `protectedInWorktree` protect the whole `<root>/.agents` (as its scenario asserts) or only `<root>/.agents/skills` (as the requirement sentence and design D3 say)? The answer decides whether task 1.3 may make custom skills under `.agents/` read-only for agents.

## Usage

Total: 165.45M tokens (160.50M cache read, 270.3k out) · cost n/a over 35 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| reviewer | 107.57M | 65% | cost n/a |
| implementer-loomwright | 31.14M | 19% | cost n/a |
| architect | 21.29M | 13% | cost n/a |
| explorer | 3.25M | 2% | cost n/a |
| tester | 2.19M | 1% | cost n/a |
| orchestrator | 10.4k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 107.57M | 65% | cost n/a |
| design | 11.35M | 7% | cost n/a |
| context-packs | 8.65M | 5% | cost n/a |
| 1.7 | 7.85M | 5% | cost n/a |
| 1.5 | 4.55M | 3% | cost n/a |
| explore:loomwright | 3.25M | 2% | cost n/a |
| 1.2 | 3.13M | 2% | cost n/a |
| test-loomwright | 2.19M | 1% | cost n/a |
| fix-loomwright-1-3 | 1.84M | 1% | cost n/a |
| 1.4 | 1.57M | 1% | cost n/a |
| fix-loomwright-1-1 | 1.30M | 1% | cost n/a |
| reword | 1.29M | 1% | cost n/a |
| fix-loomwright-6-1 | 1.28M | 1% | cost n/a |
| fix-loomwright-3-1 | 1.27M | 1% | cost n/a |
| 1.1 | 1.13M | 1% | cost n/a |
| fix-loomwright-1-2 | 1.02M | 1% | cost n/a |
| 1.6 | 1.00M | 1% | cost n/a |
| fix-loomwright-1-4 | 877.9k | 1% | cost n/a |
| 1.8 | 774.1k | 0% | cost n/a |
| fix-loomwright-1-7 | 615.3k | 0% | cost n/a |
| fix-loomwright-2-1 | 539.3k | 0% | cost n/a |
| fix-loomwright-1-6 | 452.4k | 0% | cost n/a |
| fix-loomwright-1-5 | 435.1k | 0% | cost n/a |
| fix-loomwright-4-1 | 404.1k | 0% | cost n/a |
| 1.3 | 392.0k | 0% | cost n/a |
| fix-loomwright-5-2 | 381.5k | 0% | cost n/a |
| fix-loomwright-5-1 | 326.1k | 0% | cost n/a |
| intake | 10.4k | 0% | cost n/a |

Top consumers: review:loomwright (107.57M), design (11.35M), context-packs (8.65M), 1.7 (7.85M), 1.5 (4.55M).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 173.
