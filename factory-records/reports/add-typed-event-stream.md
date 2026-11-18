# add-typed-event-stream: done

Introduce a versioned, typed event stream and a library-level command API so the CLI, a future TUI and a later node agent all consume one source of truth for run progress and control. The work captures baseline goldens (stub-runtime single and submodules stdout/stderr/exit codes, status --json, an inventory of progress prints and state mutations) before any change, then adds RunEvent/RunSnapshot/reduce/Command schemas to packages/protocol, an orchestrator-owned emitter with JSONL, terminal and in-memory sinks plus readEvents/tailEvents readers in core, a Factory.open(workspace) command API preserving today's locking and approval-hash rules and on-disk cross-process control (adding a minimal file inbox only where a TUI-needed command has no path today), and rewires every existing CLI command as a thin wrapper with unchanged output, exit codes and --json shapes. status --watch moves from 2s polling to tailEvents, and a new events <runId> [--follow] [--from N] [--json] command prints JSONL, documented in docs/cli.md and --help. Tests add golden event sequences with normalised timestamps, reduce-equals-persisted-state checks at each step, JSONL robustness (partial last line, concurrent tail, seq gaps) and payload cap/redaction, plus docs/events.md and an ADR on JSONL, seq, versioning and single-writer.

## Branches (local only; nothing was pushed)

- loomwright: `change/add-typed-event-stream` at f373360eff7f (49 commits)
- AI repo: `change/add-typed-event-stream` (archive commit f373360eff7f)

## Tasks

- [x] 1.1 (loomwright, task): Capture the baseline goldens and the progress/control inventory
- [x] 2.1 (loomwright, task): Add the version 1 event protocol, snapshot/reducer and command union (including pause) to `packages/protocol`
- [x] 3.1 (loomwright, task): Add the event sink interface, emitter, JSONL/terminal/in-memory sinks and land retention reporting
- [x] 3.2 (loomwright, task): Wire run, phase, approval, question, note and agent events through the terminal sink
- [x] 3.3 (loomwright, task): Wire task, gate, install, usage and heartbeat events through the terminal sink
- [x] 4.1 (loomwright, task): Add `readEvents` and `tailEvents` with partial-line and gap handling
- [x] 4.2 (loomwright, task): Add the `RunSnapshot` state projection and reducer parity helpers
- [x] 5.1 (loomwright, task): Add the `Factory.open` read API for `status`, `listRuns` and `events`
- [x] 5.2 (loomwright, task): Add the `Factory` command methods, the answer/pause inbox and the pause safe point
- [x] 5.3 (loomwright, task): Rewire `run`, `approve`, `resume`, `status`, `abort` and `retry` as thin `Factory` wrappers
- [x] 5.4 (loomwright, task): Add the `events` command and drive `status --watch` from `tailEvents`
- [x] 6.1 (loomwright, task): Add the golden event sequences and reducer parity tests for `single` and `submodules`
- [x] 6.2 (loomwright, task): Add the JSONL robustness and payload cap/redaction tests
- [x] 6.3 (loomwright, task): Write `docs/events.md`, ADR-0046 and the architecture/README updates
- [x] 6.4 (loomwright, task): Confirm acceptance and report follow-ups and protected-file edits (edits nothing)
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/events.ts:60): `land` deletes the run file but keeps the event log (land.ts:484-491, land.test.ts:127-128), so after `land` the kept st
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/context.ts:385): `Progress` used to add each step's usage to the running session, so a 30 s heartbeat line ended with `N tok`; live heart
- [x] fix-loomwright-1-3 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/design.ts:133): `reduce().questions` only sees emitted events, so any run whose intake asked a question projects fewer questions than `p
- [x] fix-loomwright-1-4 (loomwright, review-fix): Fix review finding (packages/core/src/factory.ts:268): The tailer re-parses each line, so zod strips unknown/optional fields and reorders keys; `events --follow` then prints a — 1 failed attempt
- [x] fix-loomwright-1-5 (loomwright, review-fix): Fix review finding (packages/protocol/src/command.ts:3): `Factory.pause("../../x")` writes a file outside `.factory`, and `approve`/`abort`/`retry`/`resume` are never parsed as 
- [x] fix-loomwright-1-6 (loomwright, review-fix): Fix review finding (test/architecture.test.ts:303): Root `private`/`workspaces`, the three package identities, and the core subpath export have no assertion (only the proto
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (packages/core/src/events/emitter.ts:135): Only all-optional payloads (run.pause-requested) accept that replacement. question.answered, question.raised, task.block
- [x] fix-loomwright-2-2 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/pipeline-commands.ts:115): Factory.open only calls findWorkspaceRoot when no workspace is passed. From a workspace subdirectory (or a submodule che
- [x] fix-loomwright-2-3 (loomwright, review-fix): Fix review finding (packages/core/src/factory.ts:122): Nothing validates the id against the protocol RunId. Factory.status('../../x') and Factory.events('../../x') read outsid
- [x] fix-loomwright-2-4 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/design.ts:148): uniqueId checks run state and openspec/changes/<id>, both gone after land, so a later change can pick the same id. bind 
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/state-commands.ts:239): Before the rewiring these three commands only called `findWorkspaceRoot` and read run state, so they worked in a git rep
- [x] fix-loomwright-3-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/implement.ts:75): When the retry budget is exhausted, `Scheduler.#spend` increments `failures` and then calls `#fail`, so the run file rec
- [x] fix-loomwright-3-3 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/implement.ts:232): The 'gates passed in <duration>' line now prints the sum of gate runtimes instead of the elapsed time, so it changes on 
- [x] fix-loomwright-3-4 (loomwright, review-fix): Fix review finding (packages/cli/test/baseline-capture.ts:212): The baseline scenarios print `loomwright 1.0.2 in <root>` and `chore(factory): init v1.0.2`, and the status documents ca
- [x] fix-loomwright-3-5 (loomwright, review-fix): Fix review finding (.changeset/config.json:9): The change adds a user-visible CLI command (`events`), changes `status --watch` and rewrites six commands, but the relea
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/core/src/factory.ts:207): A library process driving change A that then runs `Factory.run`/`approve` for B releases A's driver. Another process can
- [x] fix-loomwright-4-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/drive.ts:173): Resuming deletes `pausedReason` from the run file, but `reduce` only clears it on `run.resumed`. A stream consumer keeps — 3 failed attempts
- [x] fix-loomwright-4-3 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/implement.ts:493): `single.jsonl`/`submodules.jsonl` contain no `gates after rebase` or `implement: N/N merged` lines, while the baseline s
- [x] fix-loomwright-4-4 (loomwright, review-fix): Fix review finding (packages/core/src/events/tailer.ts:49): `events <id> --follow` does not print appended corrupt/unknown lines, while a fresh `events` prints them. The command co
- [x] fix-loomwright-4-5 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/design.ts:152): A run with no event log (created before this feature or crashed before `run.started`) resumes at seq 1 without `run.star
- [x] fix-loomwright-4-6 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/contracts.ts:47): `reduce` defaults the attempt to 0, while `projectRunState` says `failures + 1` = 1, so a replay diverges from the run f
- [x] fix-loomwright-4-7 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/implement.ts:872): `reduce` keeps the deleted task as failed, so a spec-routed review finding (a normal outcome of this pipeline) makes the
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/drive.ts:310): The run file says phase 'paused' with a pausedReason while the stream has no phase.changed/run.paused, so reduce() keeps
- [x] fix-loomwright-5-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/approve.ts:23): A change that is approved before it was ever bound (loomwright adopt creates run state without a log; a run whose log wa
- [x] fix-loomwright-5-3 (loomwright, review-fix): Fix review finding (packages/cli/src/commands/state-commands.ts:342): When the watched change's run file disappears (loomwright land in another terminal) or is corrupt, requireRun throws ins
- [x] fix-loomwright-5-4 (loomwright, review-fix): Fix review finding (packages/cli/test/state-commands.test.ts:132): The read-only guarantee that the whole design rests on (only the orchestrator appends) and the 'pruneLogs does not delet
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/core/src/events/tailer.ts:96): After a crash the next bind truncates the partial tail and appends a new line. When that new line is at least as long as
- [x] fix-loomwright-6-2 (loomwright, review-fix): Fix review finding (packages/core/src/pipeline/implement.ts:146): The persisted stream now carries agent activity no agent produced (3+ per gate per task), and docs/events.md documents `

## Spec

Archived as `openspec/changes/archive/2026-11-18-add-typed-event-stream`.

## Review findings

- review:loomwright: [should] packages/core/src/events/tailer.ts:96 After a crash the next bind truncates the partial tail and appends a new line. When that new line is at least as long as the discarded partial, the file does not shrink below cursor.offset, so no reset happens: remainder (stale partial) is concatenated with the bytes read from inside the new line, yielding one corrupt `raw` line and losing the new event for that follower.
- review:loomwright: [should] packages/core/src/pipeline/implement.ts:146 The persisted stream now carries agent activity no agent produced (3+ per gate per task), and docs/events.md documents `agent.activity` as tool/step detail of a session, so a consumer cannot tell the marker from a real step start. The terminal's step label also depends on an undocumented synchronous ordering between markStep and the gate event.
- review:loomwright: [nice] openspec/changes/add-typed-event-stream/specs/typed-event-stream/spec.md:333 Only `status --json` goes through Factory.status; the text view still reads state itself (renderStatus/scanRuns) and duplicates `worktreesOf` and `requireRun` with packages/core/src/factory.ts. The one-source sentence is not implementable as written, because StatusDocument.corrupt drops the `fix` text the text view prints and adding it would change the frozen `--json` shape.
- review:loomwright: [nice] packages/core/src/events/factory.ts:284 A log with seq 1, 2, 4 yields 1, 2, 4 through Factory.events with no signal, so a library consumer sees a silent jump; readEvents reports `missing` but is a different call.
- review:loomwright: [nice] packages/core/src/factory.ts:398 `Factory.pause("typo")` / `Factory.answer("typo", ...)` create `.factory/commands/typo/…json` that nothing will ever consume (`land` does not remove it either), and the caller gets no error.

## Risks and things not checked

- intake: Precondition (packages protocol/core/cli exist, cli -> core -> protocol enforced) was not verified: intake is read-only and runs no commands. The design task must confirm it first and pause with a report if absent.
- intake: Gates protect package.json scripts and the dependency-rule check; the change must stay additive to scripts and not relax that check.
- intake: Protected paths (factory.config.jsonc, AGENTS.md, .opencode/, .factory/, openspec/specs/) may need edits for docs/wiring; these must be listed in the final report rather than applied.
- intake: Terminal-printer byte-identical output and unchanged status --json are hard constraints; the baseline goldens are the only proof, so baseline capture must genuinely precede any source edit.
- intake: Acceptance mentions 'ai-factory events' while the CLI command is 'loomwright'; the deprecated alias is expected to cover it, to be confirmed in design rather than assumed.
- design: The preserved scenario name still says 'skeleton' although packages/protocol now exports the event protocol. The name is kept only to satisfy the archive replacement rule; renaming it is a separate spec cleanup.
- design: Task 6.4 still uses touches: none as a report-only task; that was already in the approved task list and is unchanged by this fix.
- context-packs: Shell and graphify were permission-denied in this session, so symbols and line hints come from direct file reads rather than the knowledge graph; line numbers are hints only, symbol names are authoritative.
- context-packs: 3.3 depends on a small progress.ts change owned by 3.2 (the heartbeat hook); if 3.2 omits it, 3.3 cannot comply within its touches and should report instead of editing progress.ts.
- context-packs: 6.2's cap tests require the 2.1 schemas to already allow truncated/ref on payloads; if they do not, 6.2 is blocked because packages/protocol is outside its touches.
- context-packs: 6.1's byte-exact `events` replay depends on 5.1 exposing raw lines; the dependency is written into the 5.1 pack but is a cross-task contract, not a compile-time one.
- context-packs: The repo convention needs a changeset for packages/ changes, but release mechanics are human; 6.3/6.4 are told to report it rather than run bunx changeset.
- context-packs: I did not verify that every existing test file's declared-test count matches the architecture table for files this change edits; the packs require keeping those counts, and 6.4 re-checks the total.
- 1.1: No changeset was added: the task restricts changes to the baseline fixtures, the capture script and test files.
- 1.1: Later tasks must compare status via the normaliser: status.json/status-id.json have sorted keys and <tokens>/<cost> placeholders rather than raw production layout/numbers.
- 1.1: thresholds.json records 980 passed tests across 61 files on this machine/date; it is a point-in-time record and must not be lowered.
- 1.1: The submodule golden edits only backend; parallel multi-repo implementation ordering is still covered by pipeline.test.ts, not by the golden.
- 2.1: No changeset was added; .changeset/** is outside this task's touch globs although the repo convention asks for one on packages/ changes.
- 2.1: PROTOCOL_VERSION is exported from the root but its literal is declared in events.ts, not index.ts, to avoid a module cycle.
- 2.1: gate.started's data is interpreted as a single { name, type, command? } object (the 'same shape for one gate' wording).
- 2.1: RunSnapshot is a TypeScript interface, not a zod schema; only parsing (RunEvent/EventEnvelope/Command) is schema-backed.
- 2.1: The full bun run check was run before the final test-only and Bounded-schema tweaks; targeted typecheck, lint, format and the affected suites were re-run green afterwards.
- 3.1: Gate payloads have no step field; full-suite gates emitted before any agent/install event render with an empty step. Task 3.3/6.1 may need a step-bearing event or another handoff.
- 3.1: agent.activity has no usage or error field, so step-done token accumulation is zero and tool-done error text cannot be reconstructed; agent.finished still prints usage.
- 3.1: A capped payload is replaced by the marker, so an event with required payload fields (e.g. progress.line) that exceeds 8 KiB would fail RunEvent.parse. Current large payloads should use a Bounded-capable event.
- 3.1: No changeset was added because .changeset/** is outside the task's touches; the release step may need one.
- 3.1: bun run build was not run; no plugin or policy files changed, and the task gates only require check.
- 3.2: The 3.1 terminal sink replays step-done with ZERO_USAGE, so heartbeat token accumulation stops for bound sessions (heartbeat lines still print unchanged until 3.3 emits `heartbeat`); no test covers a >30s session heartbeat.
- 3.2: Banner text now passes through the emitter's redaction before printing; a banner containing a secret-looking string would redact where it previously printed verbatim.
- 3.2: Legacy/adopted runs that never call intake may start their stream with a non-`run.started` event (no log seeding); the intake path itself always starts at seq 1 with run.started.
- 3.2: `drive` emits run.finished(done) in the closing stop and again in the idempotent `done` stop; a direct drive of an already-done run would append a second one (the CLI resume short-circuits before that).
- 3.2: Only the CLI pipeline suites and the new unit/integration tests were exercised; no real-opencode E2E run.
- 3.3: Heartbeat events are not wired: progress.ts exposes onHeartbeat and suppresses the direct print when it is set, but context.ts constructs Progress without the hook and is outside this task's touches. The terminal heartbeat line is unchanged; no heartbeat event reaches sinks.
- 3.3: Gate events are replayed only for plain task gates and full-suite gates; rebase re-gates stay direct because the protocol gate family has no stage field.
- 3.3: task.queued is not emitted for approve() or human retryTask, which happen without the pipeline's emitter and are outside the approved touches.
- 3.3: The silent agent.activity step-start markers are valid protocol events but are display plumbing, not real session activity; the future golden event-sequence task may want to account for them.
- 4.1: No changeset added: `.changeset/` is outside the task's allowed paths, and recent feature commits in this worktree also omit one.
- 4.1: Skipped lines (unknown type / invalid payload) are treated as absent when computing `missing`, so their seq can appear in `missing`; this follows the task's 'walk the retained events' rule.
- 4.1: A same-inode in-place rewrite that grows the file is not detected by the cursor (only size shrink or inode change resets); the log is append-only by contract, so this is out of scope.
- 4.1: Filesystem watch reliability on network/unsupported filesystems is only covered through the polling-fallback test, not on real remote mounts.
- 4.2: The first full parallel test run hit the pre-existing events-reader tailer 2s timeout flake; the rerun was fully green.
- 4.2: No changeset was added because that file is outside this task's allowed touches; the factory/release step may still require one.
- 4.2: usageFromLedger reads only the live .factory/usage ledger, not committed factory-records artifacts, matching the task contract.
- 5.1: FactoryOptions.out/err defaults are not resolved yet; read methods do not print, and 5.2 can wire the defaults when the write bodies land.
- 5.1: No changeset was added because .changeset/** is outside the task's allowed file globs; the repo convention asks for one for packages/ changes.
- 5.1: Follow-phase `line` is re-serialized from the parsed event (allowed by the task); if 6.1's byte-exact replay compares follow output to raw bytes, it should confirm JSON.stringify matches the sink output (it does for orchestrator-written lines).
- 5.2: `bun run test` flaked once in `packages/core/test/events-reader.test.ts` (tailer timeout under 10x parallel); that file passes alone and the full suite plus `bun run check` passed on rerun.
- 5.2: A pause request consumed before a queued run is activated returns through the `paused` resume path (`implementing` for runs with tasks) rather than running `activate`; this follows the specified top-of-loop safe point but is an untested edge.
- 5.2: No changeset was added because `.changeset/**` is outside this task's allowed paths.
- 5.2: `bun run check` is green: 1087 pass, 5 skip, 0 fail.
- 5.3: `status --json`, `abort` and `retry` now require an installed workspace (`factory.lock.json`); previously they worked in a bare git repo. The spec defines `Factory.open` for an initialised workspace, and all baseline scenarios install first.
- 5.3: `arrived` exit-code parity relies on `approve` being split into approve + resume; this keeps the drive outcome but creates a second pipeline/runtime for the continue path.
- 5.3: No changeset was added because only CLI/test files are in this task's edit scope.
- 5.4: The full parallel suite showed pre-existing fs.watch timing flakes during development; the final `bun run check` run was fully green.
- 5.4: No changeset was added because .changeset is outside the task's allowed files; release mechanics are handled separately.
- 5.4: Malformed stored lines without a parseable seq are printed even with --from, matching Factory.events' stored-line behavior.
- 6.1: No changeset added: .changeset/ is outside this task's edit scope, though the repo convention asks for one for packages/ changes.
- 6.1: The literal <ts> placeholder could not be used because the fixture must parse with RunEvent.parse; acceptance should expect a fixed valid timestamp.
- 6.1: The full parallel suite showed a one-off 2 s timeout in events-reader's tail test; that suite and a full bun run test rerun were green afterwards.
- 6.1: For adopted changes, approve emits task.merged with commit falling back to specCommit when the adopted task has no commit.
- 6.2: Latent contract gap, not exercised: EventEmitter#cap replaces data with `{truncated, ref}` for every type. Large progress.line/question.answered/install.finished payloads (required fields) then fail RunEvent.parse with ZodError. Fixing it needs either per-type required-field retention or a protocol escape, outside this task's touches; ran a scratch check to confirm it throws.
- 6.2: The gate-output test constructs the real emission path (emitGateEvent/emitGateReport on a Pipeline) rather than invoking runGates.
- 6.3: No changeset was added: docs-only task, and changesets are release mechanics handled by a human.
- 6.3: docs/events.md is intentionally longer than a one-liner because the spec requires 12 sections and one table per event family.
- 6.3: No executable test for 'a removed field is a version change'; the spec explicitly says none is needed.
- 6.4: `factory.lock.json` has a branch diff (factoryVersion 1.0.1 -> 1.0.2, opencode maxExclusive 2.3.0 -> 3.0.0, 29 templateVersion bumps) from commit 4340bf5 `chore(factory): update to v1.0.2`, which is the workspace's own update and not a task edit; the literal protected-path scenario is therefore not satisfied against origin/main unless that commit is accepted or moved to the base.
- 6.4: No changeset exists for the change; convention and the CI changeset-status step expect one (`minor` for @loomwright/cli). I did not run `bunx changeset` per the task constraints.
- 6.4: Manual run 1 did not exercise a real opencode turn (stub runtime only); real-agent behaviour remains covered only by the opt-in AI_FACTORY_E2E suite, which I did not run.
- 6.4: Not checked: `.factory/` artifacts from the factory's own dogfood runs, release/publish mechanics, and any behaviour of an older pre-change binary beyond the committed baseline/status fixture.
- review:loomwright: Gates were not run (no shell): `bun run check`, `bun run build` and the 980-test baseline in packages/cli/test/fixtures/baseline/thresholds.json are unverified.
- review:loomwright: Diff-level scenarios (protected paths have no diff, no gate-script edit, one-shot commands untouched) could not be checked without a diff; I only verified that packages/protocol, packages/core/src/events and packages/cli/src/commands changed consistently in the working tree.
- review:loomwright: Byte-identical terminal output is asserted by tests and the goldens, but I could not execute them; localisation of gate output depends on the fake `agent.activity` step marker (finding 2) staying synchronous.
- review:loomwright: I did not re-read every test body: coverage was checked by test name against each scenario name.
- fix-loomwright-1-1: No changeset added: the fix is part of the unlanded add-typed-event-stream change, and release mechanics stay human.
- fix-loomwright-1-1: Only the events command's precondition changed; status/completion still derive known changes from run state, so a landed change is not offered by completion.
- fix-loomwright-1-2: packages/core/test/events-reader.test.ts 'a concurrent tail sees appended events' timed out once under 10x parallel load and passes in isolation; it is untouched by this change and looks timing-flaky.
- fix-loomwright-1-2: No changeset added: the add-typed-event-stream branch carries none, and release mechanics are human-owned.
- fix-loomwright-1-2: Did not re-record golden event fixtures: they contain no step-done activities, so the new optional field does not change them.
- fix-loomwright-1-3: Did not run the full `bun run test`; only the directly affected core/CLI event, reduce, factory-command and pipeline suites were run.
- fix-loomwright-1-3: If an id is reused after `land` (run file deleted, event log kept), the replay appends questions to the retained log; that id-reuse behavior predates this change and is not addressed here.
- fix-loomwright-1-4: The poll safety net has no dedicated failing-without-it test: simulating a silently lost fs.watch event needs a seam the code does not have. It is covered indirectly by every tail test (including the previously flaky fs.watch one) and by docs/events.md, which now states the poll guarantee.
- fix-loomwright-1-4: docs/events.md changed to describe watch+poll; if the spec's wording ('fs.watch with a polling fallback') is read as poll-only-on-failure, reviewers may want the sentence reworded instead.
- fix-loomwright-1-4: Default poll period stays 250 ms, so a follow now wakes 4x/s; negligible file reads, but it keeps a timer alive for any abandoned iterator.
- fix-loomwright-1-5: Did not run the full `bun run test` including every heavyweight suite; ran `test:fast`, targeted suites and the full CLI pipeline suite instead.
- fix-loomwright-1-5: No changeset added; this is a bug fix inside an existing feature change, and no changeset gate is configured.
- fix-loomwright-1-5: Factory.events(runId) still builds a path from its argument; out of scope for this control-command finding but worth a follow-up if untrusted ids can reach it.
- fix-loomwright-1-6: test/config.test.ts already had near-identical tests for these three scenarios; they are now duplicated by design (the finding asked for the assertions in the architecture suite). Removing them was not an option without tripping the BASELINE_TEST_CASES count check in the same file.
- fix-loomwright-1-6: Only edge-case behaviour of the root/core manifests is covered; nested `exports` conditional objects and non-existent subpaths are not, since the spec does not require them.
- test-loomwright: The full `bun run test` suite was green (1141 pass, 5 skip, 0 fail) before the last small test-only additions; after those additions the affected suites (architecture, config, docs, plugin, cli-usage, pipeline-events, events-robustness) were re-run green, but a final whole-suite rerun after the very last edit was not completed in this session.
- test-loomwright: 'The protected paths have no diff' and 'the report lists the follow-ups' are one-time acceptance/report requirements for the change rather than repo behaviour; no unit test asserts them.
- test-loomwright: No implementation files were changed; tests were only added or strengthened. Existing tests were not weakened, skipped or deleted.
- fix-loomwright-2-1: Known limit documented as a shortcut comment: a payload whose structure alone fills 8 KiB (hundreds of run.branches entries) can lose trailing keys; every listed event class up to that size now emits a valid event. Verified manually, not covered by a test.
- fix-loomwright-2-1: No changeset added: .changeset/ has no pending entries in this branch, so the in-flight change is assumed to carry its own.
- fix-loomwright-2-1: Did not run `bun run build`/`build:plugin`; the change is in packages/core/src/events only, not in plugin or policy, so the committed plugin bundle is unaffected.
- fix-loomwright-2-2: Full `bun run test` was not run; only the affected CLI suites (state-commands, events-command, pipeline, cli-usage, completion, 69 tests total) plus format/lint/typecheck passed.
- fix-loomwright-2-2: Write commands (run/approve/resume/abort/retry) share the fixed helper but are covered indirectly; no new subdirectory test drives them because they need a scripted runtime and active state.
- fix-loomwright-2-3: Factory.events is an async generator, so the rejection surfaces when the iterable is first consumed rather than when the method is called; tests consume it as callers do.
- fix-loomwright-2-3: Lower-level exported modules (readEventLines, tailEvents, JsonlSink.bind) still accept raw ids and build paths themselves; only the reviewed public boundaries and the emitter were hardened.
- fix-loomwright-2-3: Full local gates ran clean: biome check/format, tsc --noEmit, and bun run test (1151 pass, 5 skip, 0 fail).
- fix-loomwright-2-4: Did not run the full `bun run test` suite; only the directly affected pipeline-events and events-golden suites were run.
- fix-loomwright-2-4: Behavior change: after a change lands, requesting the same change id yields `<id>-2` while its kept event log exists; this persists until a future clean command removes the log.
- fix-loomwright-3-1: openReadOnly exposes run/resume/approve too; those still throw the original PreconditionError/ConfigError lazily, but a caller could now construct the factory before init and only see the error on the write call.
- fix-loomwright-3-1: Did not verify the TUI/other library consumers; grep showed only the CLI uses open().
- fix-loomwright-3-2: Did not check the golden-stream fixtures for `task.failed` events without `attempt`; the field is optional in the protocol schema and reduce falls back to the prior attempt, so no fixture rewrite should be needed, but a golden fixture recorded from this path would differ on the next re-record.
- fix-loomwright-3-2: No check that downstream TUI renderers display the new attempt; terminal.ts ignores the field on `task.failed`, so rendering is unchanged.
- fix-loomwright-3-3: No changeset added: the fix touches packages/ but no pending changeset exists on the branch; the change-level changeset task is expected to own it.
- fix-loomwright-3-3: The old-stream fallback (durationMs absent → sum) is covered by a unit test, but no real pre-existing log fixture was replayed.
- fix-loomwright-3-3: fullSuite's elapsed duration is exercised by integration tests indirectly (presence only); its exact value is not asserted against wall-clock time.
- fix-loomwright-3-4: A prerelease version (e.g. `1.1.0-beta.0`) would normalise only the core `1.1.0` and leave `-beta.0`; the repo has no prerelease changesets config today, so this is untested.
- fix-loomwright-3-4: I ran the two affected suites (`baseline.test.ts`, `events-golden.test.ts`), `format:check`, `lint` and `typecheck`; the full `bun run test` was left to the gate.
- fix-loomwright-3-4: No changeset added, matching the earlier fix commits in this change branch.
- fix-loomwright-3-5: Did not verify the changeset against a real `changeset version` run (release mechanics stay human per AGENTS.md); frontmatter matches existing changesets and `release-notes.test.ts` passes.
- fix-loomwright-3-5: Skipped a dedicated test: changesets have no runtime behaviour, and `release-notes.test.ts`/`test/config.test.ts` already cover `.changeset` parsing.
- fix-loomwright-4-2: No separate changeset: the parent change's `.changeset/typed-event-stream.md` already covers this unreleased feature, matching how earlier fix tasks in this change were handled.
- fix-loomwright-4-2: A crash between `phase.changed` to `paused` and `run.paused` can still diverge (the snapshot ignores the reason carried on `phase.changed`); pre-existing and out of scope for this finding.
- fix-loomwright-4-2: Full `bun run test` (1159 pass, 5 skip, 0 fail), `format:check`, `lint` and `typecheck` were run in this worktree; build/plugin bundle was not touched.
- fix-loomwright-4-3: Old or third-party streams without `stage` keep defaulting to `gates` in the terminal sink; no protocol version bump is needed because the fields are optional and schemas are non-strict.
- fix-loomwright-4-3: The golden fixtures now normalise log offsets/bytes to 0, so goldens no longer pin those run-specific numbers (the live-stream test still verifies outputRef integrity).
- fix-loomwright-4-3: Did not add a dedicated TUI consumer; the change only guarantees the terminal replay path sees the re-gate and summary.
- fix-loomwright-4-4: Deduping unsequenced raw prefix lines uses a line count; if the log is rewritten between the stored read and the tail's first read, an appended corrupt line in that window could be skipped once.
- fix-loomwright-4-4: Full `bun run test` passed (1164 pass, 5 skip) before a final rename of a local variable in tailer.ts; after that rename format, lint, typecheck and the three affected suites were re-run and pass.
- fix-loomwright-4-4: No new changeset: `.changeset/typed-event-stream.md` already covers this change.
- fix-loomwright-4-5: Only the two bind sites in drive are covered; intake already emitted run.started and design/approve bind runs that came through intake. A legacy logless run bound solely by approve/design (not via drive) still lacks run.started — out of this finding's scope.
- fix-loomwright-4-5: The queued-next path (drive closing → bindStream(next)) is fixed but not separately tested, since it needs a full close plus a queued change to reach.
- fix-loomwright-4-5: All gates run locally: format:check, lint, typecheck and full `bun run test` (1165 pass, 5 skip, 0 fail).
- fix-loomwright-4-6: Ran only the targeted suites (`contract-gate`, `events`, `events-reduce`), the format/lint/typecheck gates; the full `bun run test` and the committed plugin bundle were not rerun (no plugin/policy code touched).
- fix-loomwright-4-6: No changeset was added; repo convention normally wants one for `packages/` changes.
- fix-loomwright-4-7: Older readers (previous protocol consumer builds) skip task.removed as an unknown type, so their replay still shows the routed task as failed until upgraded; no version bump is required by the additive rule.
- fix-loomwright-4-7: A crash between the run-file update and the emit leaves that run's stream one removal short; a retry cannot re-emit it because the task is already gone from the run file. Same failure direction as before the fix, but not closed.
- fix-loomwright-4-7: Terminal output is unchanged (task.removed is silent), so the committed baseline goldens were not regenerated.
- fix-loomwright-5-1: The phase.changed event now carries from: "paused" to: "paused" because Scheduler.run() already persisted the phase; it still makes replay match the run, but the transition origin is not "implementing".
- fix-loomwright-5-1: Ran format:check, lint, typecheck plus pipeline-events, factory-commands, scheduler, review-loop, events-golden and cli pipeline suites; the full `bun run test` was left to the gate.
- fix-loomwright-5-1: No new changeset: the change already carries .changeset/typed-event-stream.md.
- fix-loomwright-5-2: Same class of gap remains in design.ts (line 193): an adopted change normalized via `adopt --normalize` binds a logless run without emitting run.started; out of this finding's scope.
- fix-loomwright-5-2: The new test duplicates a small, valid OpenSpec change fixture locally instead of moving adopt.test.ts's helper into test/fixtures, to keep the change scoped.
- fix-loomwright-5-3: The same guard also catches unexpected programming errors in renderStatus and reports them as clean exits instead of uncaught crashes; only the corrupt/missing run-file path is covered by a test.
- fix-loomwright-5-3: Did not add a changeset (task scope is a bug fix under packages/; repo convention may want one before landing).
- fix-loomwright-5-4: The concurrent read-only test uses a seeded log with no live orchestrator appending during the window; the existing 'a new event produces a frame' test still covers appends being seen.
- fix-loomwright-5-4: mtime equality relies on the filesystem's mtime resolution; no writes happen so the value is read twice unchanged.
- fix-loomwright-5-4: Tests only; no new changeset added because the change already ships .changeset/typed-event-stream.md.
- fix-loomwright-6-1: An unfinished tail is now re-read on every poll; bounded by that line's length, but a writer that leaves a very large newline-free tail will re-read it each poll.
- fix-loomwright-6-1: No changeset added: the change branch already carries .changeset/typed-event-stream.md for this feature.
- fix-loomwright-6-1: Full suite (bun run test: 1174 pass, 5 skip) was run before the final comment-only and test-rename edits; format, lint, typecheck and the events-reader suite were re-run afterwards.
- fix-loomwright-6-2: Golden fixtures shrink noticeably (214→144 events for single); expected from deleting 3+ synthetic activity events per gate.
- fix-loomwright-6-2: No changeset added, matching earlier review-fix commits; the feature changeset .changeset/typed-event-stream.md already covers the package change.

## Open questions

- 6.4: Should the pre-existing `factory.lock.json` v1.0.2 bump be accepted as part of this change branch, or moved to the base before landing?

## Shortcuts (Ponytail)

- loomwright:packages/core/src/events/emitter.ts:143 — a payload whose structure alone fills the cap (hundreds of record entries) loses
- loomwright:packages/core/src/events/tailer.ts:82 — a rewrite that leaves the file longer than `completeOffset` while changing bytes already

## Usage

Total: 267.33M tokens (259.22M cache read, 629.7k out) · cost n/a over 62 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| implementer-loomwright | 156.87M | 59% | cost n/a |
| reviewer | 73.63M | 28% | cost n/a |
| architect | 27.03M | 10% | cost n/a |
| tester | 8.80M | 3% | cost n/a |
| explorer | 988.3k | 0% | cost n/a |
| orchestrator | 9.4k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 73.63M | 28% | cost n/a |
| 6.1 | 18.72M | 7% | cost n/a |
| design | 17.78M | 7% | cost n/a |
| 1.1 | 15.93M | 6% | cost n/a |
| 3.3 | 13.68M | 5% | cost n/a |
| 3.2 | 13.28M | 5% | cost n/a |
| context-packs | 9.26M | 3% | cost n/a |
| test-loomwright | 8.80M | 3% | cost n/a |
| 5.4 | 8.59M | 3% | cost n/a |
| 5.2 | 8.29M | 3% | cost n/a |
| 5.3 | 7.93M | 3% | cost n/a |
| fix-loomwright-4-3 | 7.52M | 3% | cost n/a |
| 3.1 | 6.21M | 2% | cost n/a |
| 2.1 | 5.04M | 2% | cost n/a |
| fix-loomwright-1-2 | 3.32M | 1% | cost n/a |
| fix-loomwright-1-4 | 3.08M | 1% | cost n/a |
| 5.1 | 2.71M | 1% | cost n/a |
| 6.3 | 2.69M | 1% | cost n/a |
| 6.2 | 2.53M | 1% | cost n/a |
| fix-loomwright-4-4 | 2.47M | 1% | cost n/a |
| fix-loomwright-4-7 | 2.36M | 1% | cost n/a |
| fix-loomwright-2-1 | 2.16M | 1% | cost n/a |
| fix-loomwright-4-1 | 2.09M | 1% | cost n/a |
| fix-loomwright-4-2 | 2.02M | 1% | cost n/a |
| fix-loomwright-3-3 | 1.99M | 1% | cost n/a |
| fix-loomwright-2-4 | 1.82M | 1% | cost n/a |
| fix-loomwright-5-2 | 1.73M | 1% | cost n/a |
| 6.4 | 1.61M | 1% | cost n/a |
| fix-loomwright-5-1 | 1.53M | 1% | cost n/a |
| fix-loomwright-3-4 | 1.46M | 1% | cost n/a |
| 4.1 | 1.45M | 1% | cost n/a |
| fix-loomwright-6-2 | 1.45M | 1% | cost n/a |
| fix-loomwright-1-3 | 1.37M | 1% | cost n/a |
| fix-loomwright-3-1 | 1.36M | 1% | cost n/a |
| 4.2 | 1.34M | 0% | cost n/a |
| fix-loomwright-1-5 | 1.18M | 0% | cost n/a |
| fix-loomwright-6-1 | 1.06M | 0% | cost n/a |
| fix-loomwright-4-5 | 1.04M | 0% | cost n/a |
| explore:loomwright | 988.3k | 0% | cost n/a |
| fix-loomwright-1-1 | 978.6k | 0% | cost n/a |
| fix-loomwright-2-2 | 793.8k | 0% | cost n/a |
| fix-loomwright-2-3 | 751.7k | 0% | cost n/a |
| fix-loomwright-4-6 | 748.8k | 0% | cost n/a |
| fix-loomwright-5-4 | 723.6k | 0% | cost n/a |
| fix-loomwright-5-3 | 552.3k | 0% | cost n/a |
| fix-loomwright-3-2 | 536.9k | 0% | cost n/a |
| fix-loomwright-1-6 | 509.1k | 0% | cost n/a |
| fix-loomwright-3-5 | 254.0k | 0% | cost n/a |
| intake | 9.4k | 0% | cost n/a |

Top consumers: review:loomwright (73.63M), 6.1 (18.72M), design (17.78M), 1.1 (15.93M), 3.3 (13.68M).
Retry overhead: 4.51M tokens (2%).
Wasted re-reads of unchanged files: 114.
