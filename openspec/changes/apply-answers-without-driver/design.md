# Design: answers persist when no driver consumes the inbox

## Context

`Factory.answer` (`packages/core/src/factory.ts:398`) writes one validated `answer` file to
`.factory/commands/<id>/` and returns. `drive()` calls `consumeCommands` before and after each
step; `applyAnswer` (`packages/core/src/pipeline/drive.ts:89`) then updates the run and emits
`question.answered`. Neither path rewrites the clarification files, and a run that is not being
driven never reads the file at all. The TUI's questions pane is the only caller
(`packages/tui/src/model/controls.ts:423`), and it is reachable on `awaiting-approval`, `paused`,
`queued` and dead-lock runs, so the user's "saved" expectation and the persisted run diverge.

The run lock (`updateRun`, `packages/core/src/state/run.ts:203`) serialises writers of
`.factory/runs/<id>.json`. The active lock plus `driverAlive`
(`packages/core/src/state/active.ts:25`,`:35`) is the existing way to know whether a process is
driving a given run. The only emitter today is constructed inside `Pipeline`
(`packages/core/src/pipeline/context.ts:147`) with `JsonlSink` and `TerminalSink`.

ADR-0046 made `answer` an inbox command applied at a safe point. That contract is right while a
driver exists; it has no meaning when nobody will ever run the next step.

## Decisions

### 1. One shared apply function, two entry points

A new `packages/core/src/pipeline/answer.ts` owns the state transition, the unrecorded-question
fallback, the idempotency rule and the clarification-file rewrite. `consumeCommands` calls it
with `onApplied: () => p.emit("question.answered", …)`; `Factory.answer` calls it with a
standalone JSONL writer. The function returns `applied`, `unchanged` (already answered),
`deferred` (a driver appeared) or `missing-run`.

The function takes the run lock through a new `withRunLock(root, id, fn)` in `state/run.ts`;
`updateRun` is refactored onto that helper, so the direct path can load, decide and save under one
lock without going through the mutate-and-always-save shape of `updateRun` (which would bump
`updatedAt` even on the deferred path).

Rejected: implementing the update again in `factory.ts`. That is exactly how root cause 2
returned, and it would leave two idempotency rules.

Rejected: constructing a `Pipeline` inside `Factory.answer`. It needs the install config, a
runtime and a signal, and would make a control write look like a driving command.

### 2. Liveness decides the path, checked twice

`Factory.answer` first parses the command with `Command.parse`. It reads the active lock and
treats a driver as live only when `active.changeId === runId && driverAlive(active)`. A live
driver gets today's path: one inbox file, no state change. Otherwise the direct path calls the
shared function with a `whenLocked` predicate that re-reads the active lock inside the run lock;
if a driver appeared in between, the function returns `deferred` and `Factory.answer` writes the
inbox file instead. A corrupt active lock is treated as "no driver", the way `status` reports it.

The double check is the "one writer per run" rule: while the run lock is held, a driver cannot
also be applying this answer, and a driver that arrives afterwards finds no inbox file and an
already-answered record.

Residual race: a driver can claim the active lock and append its own event between the direct
path's re-check and its append of `question.answered`. Both writers would allocate the same `seq`;
the state remains correct and the answer is emitted once, but a tailer reports a sequence gap.
Mitigation: the answer is idempotent, the direct path leaves no inbox file and the window is one
event append wide. Accepted for this change; a future writer-side sequence lock would close it.

After an `applied` or `unchanged` result the direct path removes every `answer` file in the
inbox whose `question` matches the command, so an outdated answer cannot be applied by a driver
that starts later. The driver removes its own current file after consumption, as today.

Rejected: always applying immediately. It would let a TUI write race a live driver's own apply
and break ADR-0046's safe-point contract for driven runs.

Rejected: always writing the inbox. That is the reported bug.

### 3. Already-answered records are immutable and self-healing

When the target record is already `answered`, the shared function returns `unchanged`: it does
not emit, does not change `answer` or `at`, and does not append a second fallback. It still
rewrites both clarification files, so a re-delivered stale answer repairs a `questions.md` that
an earlier crash left behind. A record with status `skipped` or `unanswered` is answered normally.

The unrecorded-question fallback keeps the existing shape `{ step: "answer", question, status:
"answered", answer, at }` and is matched by its `question`, so a second delivery does not append
another record.

Rejected: overwriting an answered record. A duplicate delivery could silently replace the text
the user saw, and the requirement fixes the answer text on re-delivery.

### 4. The direct path writes the stream through the JSONL sink only

`Factory.answer` opens an `EventEmitter` with only `JsonlSink`. If the log is empty it emits
`run.started` with the run's current phase before `question.answered`, matching `bindStream`'s
rule for a run whose first writer appears late. It does not construct a `TerminalSink` or a
`Progress`: the TUI already owns the screen, there is no CLI `answer` command to print to, and
the TUI and `status --watch` read the JSONL.

The writer deliberately does not call `config()`: `openReadOnly` supplies the install config
lazily and the questions pane works in an uninstalled workspace. The emitter's default redaction
is therefore used, which is stricter than `logs.redact: false`.

Rejected: adding a terminal sink. A control write from a TUI would corrupt the frame.

Rejected: writing only run state and no event. The stream would no longer be the projection of the
run, `status --watch` and replay would miss the answer, and the TUI would have to prefer
`run.clarifications` over its snapshot for answered records. Emitting keeps the one-writer model
and needs no TUI change.

Rejected: requiring the install marker to read `logs.redact`. It would make the fix fail exactly
where the pane already opens.

### 5. The questions file follows `specDir`

`specDirFor(root, draft)` moves the one-line rule from `design.ts::specDir` into `clarify.ts`;
`specDir(p, draft)` delegates. The shared function calls `writeClarifications` with the updated
run's records and `specDirFor(root, run.draft)`, so the driver path gains the rewrite it lacked
and the direct path writes the draft's copy when one exists.

Rejected: importing `design.ts` into the answer module. That pulls prompts and the pipeline into a
state write and creates a cycle.

### 6. Documentation and the ADR

ADR-0050 records the immediate path as an extension of ADR-0046 and names ADR-0046 as the
decision it extends; the historical ADR-0046 text stays unchanged because `test/docs.test.ts`
pins every historical decision against the change base. `docs/events.md` describes the split,
`docs/tui.md` and `docs/cli.md` describe when the row reads `recorded` and when it reads
`answered`, and `ARCHITECTURE.md`'s `.factory/commands/<id>/` row names the live-driver path.
`docs/tui.md` keeps the phrases `recorded — applies at the next step` and `never claims the answer
was applied`, which the docs suite asserts, and states that an answer applied at
`awaiting-approval` or `paused` changes only the Q&A: no phase change, no approval, no task and no
redesign; an approved spec stays approved until `reword` or `reapprove`. The changeset is a patch
for `@loomwright/core` and `@loomwright/cli`: the published CLI bundle embeds core and ships the
changed docs.

## Contract changes

None configured. `Factory.answer` keeps its signature. No event type, payload, command schema,
API schema or Helm value changes. The `Clarification` schema is unchanged; the step-`answer`
fallback remains schema-valid.

## Risks

- **Sequence race.** A driver that claims the active lock between the direct path's re-check and
  its event append can allocate the same `seq`. The answer is written once and the state is
  correct, but the tailer reports a gap until a future writer-side lock exists.
- **Clarification-file failure after the event.** The run and event are already durable when
  `writeClarifications` runs. A filesystem error surfaces to the caller and can leave the files
  stale; a re-delivered answer rewrites them (`unchanged`) without a second event.
- **Cross-host lock.** `driverAlive` trusts a lock from another host, so an answer there stays in
  the inbox even if the driver is gone. That is the existing active-lock rule.
- **Missing run file.** `Factory.answer` keeps today's inbox write rather than throwing when the
  run file does not exist; a later run with that id can consume it. A corrupt run file, by
  contrast, surfaces `CorruptStateError` from the direct path instead of leaving an inbox file
  that could never be applied.
- **Updated test expectation.** The "no listener is started" case in
  `packages/core/test/factory-commands.test.ts` currently expects two inbox files for `pause` and
  `answer`; after the fix only `pause` is left. The unrecorded-question fallback test also calls
  `readdirSync(inboxOf())`, but the direct path never creates that directory; the assertion must
  treat a missing inbox as empty (or assert its absence). The tests are updated, not weakened.
- **Docs-test pins.** `test/docs.test.ts` compares every historical `docs/decisions` file against
  the change base, so ADR-0046 must not be edited; ADR-0050 carries the new decision. The same
  suite asserts the exact TUI phrases `recorded — applies at the next step` and
  `never claims the answer was applied` and the words `in-process` and `detached CLI children`,
  so the docs edit must keep them. A new ADR-0050 case is added to that suite.
- **Out of scope.** The stale `port-agent-runtime` run, pasted text whose `Enter` is dropped, and
  slow-terminal frame stalls are untouched.
