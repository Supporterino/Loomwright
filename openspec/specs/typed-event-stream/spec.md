# typed-event-stream Specification

## Purpose
TBD - created by archiving change add-typed-event-stream. Update Purpose after archive.

## Requirements

### Requirement: The baseline is captured before any change

Before the first source edit, the change SHALL capture the stub-runtime `single` and `submodules` scenarios as committed goldens containing stdout, stderr and the process exit code, with timestamps, temporary directories and other run-specific bytes normalised deterministically. It SHALL capture the current `status --json` output for the same fixtures, inventory every place that prints progress or mutates run state (pipeline, scheduler, gates, approval, questions and usage), and record how a second process signals a running run today (`approve`, `answer`, `abort`, `retry`, `resume`) including which of those has no on-disk path. The captured facts SHALL be committed next to the goldens; the test count and the threshold rules SHALL be fixed before the first edit.

#### Scenario: the two stub scenarios are captured

- **WHEN** the baseline capture runs against the `createSingleRepoFixture` and `createSubmoduleFixture` stub scenarios
- **THEN** `packages/cli/test/fixtures/baseline/` contains a stdout file, a stderr file and an exit code for `single` and for `submodules`
- **AND** the files contain no timestamps, temporary paths or process ids that differ between two runs on the same machine

#### Scenario: the status compatibility contract is captured

- **WHEN** `status --json` runs against the baseline fixtures
- **THEN** its parsed top-level keys are `active`, `driverAlive`, `queue`, `workspaceUsage`, `runs` and `corrupt`
- **AND** the captured document is stored with the other baseline fixtures

#### Scenario: the print and mutation inventory is recorded

- **WHEN** the baseline inventory is read
- **THEN** it lists every `Progress` method call site, every `Pipeline.out` banner and every `updateRun`/`saveRun` mutation that the pipeline can perform
- **AND** it maps each `approve`, `answer`, `abort`, `retry` and `resume` action to its on-disk path or records that it has none

#### Scenario: the test count is fixed before the first edit

- **WHEN** the baseline is captured
- **THEN** the exact `bun test` pass count and the `bun run check` result are recorded
- **AND** no later task lowers the pass count below that baseline

### Requirement: A version 1 protocol defines the run event envelope and command union

`packages/protocol` SHALL export `PROTOCOL_VERSION = 1` and a zod `RunEvent` discriminated union on `type`. Every event SHALL carry the envelope `{ v, runId, seq, ts, type, data }`, where `v` is `1`, `runId` is a non-empty change id, `seq` is an integer starting at `1` and increasing by one per run, `ts` is an ISO-8601 UTC timestamp ending in `Z`, and `data` is the payload for that type. The package SHALL also export `RunSnapshot`, a pure `reduce(events) → RunSnapshot`, `emptySnapshot(runId)` and a validated `Command` union containing `approve`, `answer`, `abort`, `retry`, `resume` and `pause`. The package SHALL expose these from its existing root export and SHALL NOT import `@loomwright/core`, `@loomwright/cli` or a path outside `packages/protocol/src`.

#### Scenario: a valid event parses

- **WHEN** `RunEvent.parse` receives `{ v: 1, runId: "add-health", seq: 1, ts: "2026-11-17T10:00:00.000Z", type: "run.started", data: { phase: "design" } }`
- **THEN** it returns the event unchanged

#### Scenario: the envelope is validated

- **WHEN** the parser receives an event with `v: 0`, `seq: 0`, a missing `ts`, a non-UTC timestamp or an empty `runId`
- **THEN** each input is rejected

#### Scenario: seq is monotonic per run

- **WHEN** the emitter writes events for one run
- **THEN** the first event has `seq: 1`
- **AND** every later event has the previous `seq` plus one, with no duplicate and no gap in the persisted stream

#### Scenario: resume continues the sequence

- **WHEN** a process resumes a run whose event log already ends at `seq: 7`
- **THEN** the first new event has `seq: 8`
- **AND** the stream has no duplicate and no gap across the restart
- **AND** no second `run.started` is emitted

#### Scenario: the command union is closed

- **WHEN** `Command.parse` receives `{ command: "approve", runId: "add-health" }` and `{ command: "pause", runId: "add-health" }`
- **THEN** both are accepted
- **AND** `clean`, an unknown command name and a missing `runId` are rejected

#### Scenario: protocol stays a leaf package

- **WHEN** every file under `packages/protocol/src` is scanned for imports
- **THEN** none imports `@loomwright/core`, `@loomwright/cli` or a relative path outside the package

### Requirement: Event families cover what the pipeline really does

The `RunEvent` union SHALL derive from the existing pipeline sources and SHALL cover the `run` family (`started`, `finished` with an outcome, `paused`, `resumed`, `aborted`, `branches`, `pause-requested`), `phase.changed`, the `task` family (`queued`, `started`, `passed`, `failed`, `retried`, `blocked`, `skipped`, plus the merge and retry transitions the terminal already prints: `merging`, `merged`, `conflict`, `requeued`, `transient`, `interrupted`, `waiting`), the `gate` family (`planned`, `started`, `finished` with name, result, duration and an output reference, `report`), the `agent` family (`started`, `finished` with role and session id, `activity`, `retry`), the `install` family, `question.raised` and `question.answered`, `approval.requested` with the spec hash and `approval.granted` with the approver, `usage.delta`, `progress.line` for a banner or note that has no structured family, and `heartbeat`. Event names SHALL use the dotted lowercase form shown here; no event SHALL carry a raw token, credential, environment value or full tool output.

#### Scenario: task transitions map to events

- **WHEN** the scheduler reports a task started, a retry, a merge and a merge conflict
- **THEN** the stream contains `task.started`, `task.retried`, `task.merged` and `task.conflict` with the task id and repo
- **AND** `task.failed` carries the reason and `task.skipped` names the cancelled dependent

#### Scenario: gate and agent events carry what the terminal needs

- **WHEN** a gate finishes and an agent session finishes
- **THEN** `gate.finished` carries the gate name, status, duration and an output reference rather than the output text
- **AND** `agent.finished` carries the role, outcome, duration, usage and session id

#### Scenario: approval events carry the hash and the approver

- **WHEN** a change is approved
- **THEN** `approval.requested` carries `specHash` and `specCommit`
- **AND** `approval.granted` carries the approver, the spec hash and the spec commit

#### Scenario: free-form progress uses the note channel

- **WHEN** the pipeline prints a banner or a note that has no structured event family
- **THEN** it emits `progress.line` with a `level` of `always`, `normal` or `verbose` and the rendered text
- **AND** the text is capped and redacted like every other payload

### Requirement: Payloads are bounded and redacted

Every event payload SHALL be capped at 8 KiB of JSON. A payload that would exceed the cap SHALL be replaced by its truncated form with `truncated: true` and a reference `{ path, offset, bytes }` into `.factory/logs/` that identifies where the full, already-redacted value lives. Events MUST NOT contain secrets, environment values, raw credentials or full tool, gate or agent output. Strings SHALL pass the existing `redact`/`secretEnvValues` logic and the existing 100-character tool-description cap before they are written.

#### Scenario: a large payload is truncated with a reference

- **WHEN** an event payload serialises to more than 8 KiB
- **THEN** the stored event says `truncated: true`
- **AND** it carries a `.factory/logs/` path, offset and byte count for the full value
- **AND** the stored line is no larger than 8 KiB plus the envelope

#### Scenario: a secret is redacted before it reaches the file

- **WHEN** a gate output, tool detail or question answer contains a provider key or an environment value
- **THEN** the stored event contains the redacted placeholder, not the value

#### Scenario: full gate output is never inlined

- **WHEN** a gate finishes
- **THEN** `gate.finished` carries an output reference or nothing, never the full compacted output
- **AND** the full output remains in the existing gate log or report

### Requirement: The protocol evolves additively

The event protocol SHALL evolve additively: a release MAY add an event type, add an optional field to an existing event, or add an optional field to an existing payload. A release MUST NOT remove or rename an event type or field, change an existing field's meaning, or make an optional field required without incrementing `PROTOCOL_VERSION` and the envelope `v`. Consumers SHALL ignore an unknown `type` and unknown optional fields. A reader SHALL validate the envelope of every line, skip a line with an unknown type or a payload that does not validate, and continue with the rest rather than failing the whole stream. `docs/events.md` SHALL state this rule and the checklist for adding an event.

#### Scenario: an unknown event type is skipped

- **WHEN** a log contains a well-formed envelope with `type: "future.thing"` between two known events
- **THEN** `readEvents` returns the known events and reports the unknown type as skipped
- **AND** `reduce` is unchanged as if the line were absent

#### Scenario: an added optional field is accepted

- **WHEN** a known event carries an extra optional field from a newer release
- **THEN** the parser accepts it and the reducer ignores it
- **AND** `PROTOCOL_VERSION` is unchanged for that addition

#### Scenario: a removed field is a version change

- **WHEN** a change would remove or rename an existing event type or field
- **THEN** the protocol version and the envelope `v` are incremented in the same change

### Requirement: Only the orchestrator writes events

The process that drives a run SHALL own the emitter. Only that process SHALL append to `.factory/events/<runId>.jsonl`; the opencode plugin, a reader, `status --watch`, `events` and `Factory` read methods MUST NOT write an event file. The JSONL sink SHALL append one complete line per event and flush per event, and writes SHALL be serialised so two concurrent calls cannot interleave a line. A crash MAY leave a truncated last line. On bind the writer SHALL truncate an incomplete trailing line back to the last newline before appending, so the new stream stays line-delimited; it MUST NOT rewrite or delete an earlier complete line.

#### Scenario: a second process only reads

- **WHEN** `events <id> --follow` and `status --watch` run while a pipeline drives the same change
- **THEN** neither process writes `.factory/events/<id>.jsonl`
- **AND** both see the lines the orchestrator wrote

#### Scenario: the plugin does not write events

- **WHEN** the bundled plugin source is inspected
- **THEN** it does not import the event writer, the JSONL sink or `Factory`
- **AND** no event file is created by a plugin run

#### Scenario: a crash leaves the complete prefix intact

- **WHEN** the writer stops between two events
- **THEN** every line before the stop is complete and parseable
- **AND** at most the last line is partial
- **AND** the next bind truncates only that partial line before appending

### Requirement: Core writes and renders the event stream through sinks

Core SHALL define an `EventSink` interface and an emitter owned by the orchestrator. It SHALL provide three sinks: an append-only JSONL sink at `.factory/events/<runId>.jsonl`, a terminal sink that reproduces today's terminal lines byte-identically for the `normal`, `quiet` and `verbose` verbosities, and an in-memory sink for tests. The terminal sink SHALL render the same `Progress` line for the same event, including the icons, durations, token counts and indentation. The emitter SHALL bind to a run after intake creates `.factory/runs/<id>.json`, SHALL start a new persisted stream at `seq: 1` with `run.started`, SHALL continue a resumed stream from the last complete `seq`, and SHALL keep terminal output before that binding terminal-only.

#### Scenario: the JSONL sink writes one event per line

- **WHEN** the emitter receives three events for one run
- **THEN** `.factory/events/<id>.jsonl` has three lines
- **AND** each line parses with `RunEvent.parse` and carries `seq` 1, 2 and 3

#### Scenario: the terminal sink is byte-identical

- **WHEN** the baseline `single` scenario runs with the event-sourced terminal sink
- **THEN** its stdout and stderr equal the baseline goldens
- **AND** the same holds for `submodules`

#### Scenario: quiet and verbose remain unchanged

- **WHEN** a pipeline runs with `--quiet` or `--verbose`
- **THEN** the terminal sink suppresses or adds exactly the lines the current `Progress` implementation does
- **AND** the existing progress tests pass without changing their expected text

#### Scenario: intake lines before the run exist are terminal-only

- **WHEN** `run` prints the intake banner and asks an intake question before the change id exists
- **THEN** those lines appear on the terminal exactly as today
- **AND** the persisted stream starts at `run.started` once the run state is created

### Requirement: Event logs follow the run's retention

`.factory/events/<runId>.jsonl` SHALL be treated as run progress data, like `.factory/logs/<id>`. `land` SHALL keep it and list it under `kept`; `land` still deletes run state and approvals. This change SHALL NOT add or change a retention policy: `pruneLogs` keeps applying `logs.retentionDays` to the log tree, and a future `clean` command deletes the event log with the logs.

#### Scenario: land keeps the event log

- **WHEN** `land` completes for a finished change
- **THEN** `.factory/events/<id>.jsonl` still exists
- **AND** `land` reports it under `kept`
- **AND** `.factory/runs/<id>.json` and `.factory/approvals/<id>.json` are removed

#### Scenario: no new retention knob is added

- **WHEN** `factory.config.jsonc` and `config/schema.ts` are read
- **THEN** the only retention setting is the existing `logs.retentionDays`
- **AND** `pruneLogs` does not delete event files

#### Scenario: a missing event log is not an error

- **WHEN** a change landed before this feature or has no event log
- **THEN** `status`, `events` and `Factory.events` treat the stream as empty
- **AND** no cleanup fails

### Requirement: Readers tolerate partial writes and report gaps

Core SHALL export `readEvents(root, runId, { fromSeq })` returning the complete events with `seq >= fromSeq` (inclusive, default `1`), the missing sequence numbers and the skipped lines, and `tailEvents(root, runId, { fromSeq, signal })` returning an async iterator of events and gap markers. The reader SHALL ignore a trailing line with no newline until it is complete, SHALL tolerate a missing file as an empty stream, and SHALL use `fs.watch` with a polling fallback so a filesystem without watch support still tails. `tailEvents` SHALL end when `signal` aborts.

#### Scenario: a partial last line is ignored

- **WHEN** the log ends with `{"v":1,"runId":"add-health","seq":3` and no newline
- **THEN** `readEvents` returns events 1 and 2
- **AND** it reports no gap and no error

#### Scenario: a concurrent tail sees appended events

- **WHEN** `tailEvents` is iterating while the orchestrator appends event 4
- **THEN** the iterator yields event 4 after it is flushed
- **AND** it does not yield event 3 twice

#### Scenario: a sequence gap is reported

- **WHEN** the log contains `seq` 1, 2 and 4
- **THEN** `readEvents` returns events 1, 2 and 4
- **AND** it reports `3` as missing
- **AND** `tailEvents` yields a gap marker before event 4

#### Scenario: `fromSeq` is inclusive

- **WHEN** `readEvents` is called with `fromSeq: 2` on a stream starting at 1
- **THEN** the first returned event has `seq: 2`
- **AND** `fromSeq: 1` returns the whole stream

#### Scenario: an abort ends the tail

- **WHEN** the caller aborts the `signal` passed to `tailEvents`
- **THEN** the async iterator completes without error

### Requirement: `reduce` produces the snapshot the state implies

`reduce(events)` SHALL be pure, deterministic and total over the known event types. It SHALL return a `RunSnapshot` containing `v`, `runId`, `lastSeq`, `phase`, `pausedReason`, `abortRequested`, `branches`, per-task status and attempt, the answered and unanswered questions, the approval (spec hash, spec commit, approver), the aggregated usage, and the last result per gate. It SHALL ignore unknown event types and unknown optional fields, and SHALL NOT read the filesystem. It SHALL aggregate usage only from `usage.delta`; the usage on `agent.finished` is display data and MUST NOT be counted twice. The `run.pause-requested` event is informational and SHALL NOT change the snapshot; only `run.paused` changes `phase` and `pausedReason`. In the golden scenarios, `reduce` over the complete stream SHALL equal the projection of the persisted `RunState` at every checkpoint the pipeline records, and the aggregated usage SHALL equal the usage ledger.

#### Scenario: the initial snapshot is empty

- **WHEN** `emptySnapshot("add-health")` is called
- **THEN** `lastSeq` is `0`, `phase` is `null`, `tasks` is `{}` and `usage` is all zero

#### Scenario: replaying the golden stream equals the persisted state

- **WHEN** `reduce` runs over the complete `single` or `submodules` golden stream
- **THEN** `phase`, `tasks`, `branches`, `questions` and `approval` equal the projection of the final `.factory/runs/<id>.json`
- **AND** the same equality holds at every recorded checkpoint, not only at the end

#### Scenario: the reducer is pure

- **WHEN** `reduce` is called twice with the same events
- **THEN** both results are deep-equal
- **AND** no file under `.factory/` changed

### Requirement: `Factory.open` is the library command API

Core SHALL export `Factory.open(workspace, options)` returning an object with `run`, `resume`, `approve`, `retry`, `abort`, `answer`, `pause`, `status`, `listRuns` and `events`. `Factory.events(runId, { fromSeq, follow, signal })` SHALL expose the same `readEvents`/`tailEvents` semantics as the CLI command. `Factory.pause(runId)` SHALL write a validated `pause` command to the inbox, or set the equivalent request when it is the driving process, and SHALL return without blocking on the pipeline. `Factory` SHALL accept the workspace root and the injectable `out`, `err`, `signal`, `runtime`, `ask` and verbosity options that `Pipeline` already takes, so a caller can capture output and drive a scripted runtime. Every control command (`approve`, `answer`, `abort`, `retry`, `resume`, `pause`) SHALL be validated with the protocol `Command` schema. The read methods (`status`, `listRuns`, `events`) MUST NOT take the active-change lock or write run state. `Factory.status()` SHALL return the same data document that `status --json` serialises, so the CLI can render both the text and the JSON view from one source. The write methods SHALL keep today's rules: `claimActive`/`ensureDriver` before driving, the run lock around updates, `specHash` over the checkbox-normalised spec for `approve`, the `verifyApproval` hash-and-commit check, and the same precondition errors. `Factory` MUST NOT start a daemon, socket or network listener.

#### Scenario: the API surface is complete

- **WHEN** `Factory.open(root)` is called on an initialised workspace
- **THEN** the returned object exposes exactly the ten methods named in this requirement
- **AND** `run`, `resume`, `approve`, `retry`, `abort`, `answer` and `pause` return a promise

#### Scenario: approve keeps the hash and commit rules

- **WHEN** `approve(id)` runs through `Factory`
- **THEN** the spec is committed on `change/<id>`, the approval records the git `user.email`, the spec commit and the checkbox-normalised `specHash`
- **AND** an edited spec fails the same `verifyApproval` check as the CLI does today

#### Scenario: a second driver is rejected

- **WHEN** one process drives a change and another calls `Factory.run` or `Factory.resume` for it
- **THEN** the second call fails with the existing `PreconditionError` for a live driver
- **AND** the first process keeps the lock

#### Scenario: read methods do not mutate

- **WHEN** `status`, `listRuns` or `events` is called
- **THEN** no lock is taken, no run file is rewritten and no event is appended
- **AND** a corrupt state file is reported the way `status --json` reports it today

### Requirement: Commands without a path use a validated file inbox

Commands the TUI needs that have no on-disk path today SHALL be delivered through `.factory/commands/<runId>/`, one JSON file per command, validated with the protocol schema. The inbox SHALL carry `answer` and `pause`. The orchestrator SHALL consume the files at a safe point, apply the accepted command and remove it; an invalid file SHALL be rejected with a diagnostic and SHALL NOT fail the run. A writer SHALL write a temporary file and rename it into place; the orchestrator SHALL ignore an unreadable or partial file until the next safe point. No daemon, socket or network listener SHALL be added. `approve`, `abort`, `retry` and `resume` keep their existing files (`approvals/<id>.json`, run state, queue).

A `pause` command SHALL make the orchestrator stop at its next safe point without aborting and without changing the persisted run-state schema: it SHALL persist `phase: "paused"` with a `pausedReason` of `pause requested`, emit `run.pause-requested` when it consumes the file and `run.paused` when it stops, release the driver, keep branches, worktrees and task progress, and only then remove the file. `resume` continues from the paused phase through the existing resume path. Keeping the request file until the pause is persisted makes a crash between consumption and pause safe: the next process consumes it again.

#### Scenario: an answer is delivered and consumed

- **WHEN** a reader writes a valid `answer` command for a run that is between questions or has no TTY
- **THEN** the orchestrator applies the answer at the next safe point, records it in the clarification list and removes the file
- **AND** the stream contains `question.answered`

#### Scenario: a pause is requested and consumed

- **WHEN** a reader writes a valid `pause` command for a running change
- **THEN** the orchestrator stops at its next safe point with `phase: "paused"` and `pausedReason` set
- **AND** it emits `run.pause-requested` when it consumes the command and `run.paused` when it stops
- **AND** it releases the driver, keeps the branches and worktrees, and removes the request file only after the pause is persisted
- **AND** `resume` continues from the paused phase through the existing resume path

#### Scenario: an invalid command file is rejected

- **WHEN** `.factory/commands/<runId>/` contains a file that does not parse or names an unknown command
- **THEN** the orchestrator reports it on stderr and leaves the run running
- **AND** the file is not applied

#### Scenario: no listener is started

- **WHEN** `Factory.open` and the CLI run
- **THEN** no TCP port is opened and no process is spawned to serve commands
- **AND** the only cross-process paths are files under `.factory/`

### Requirement: Existing CLI commands are thin Factory wrappers with unchanged behaviour

The run-state CLI commands (`run`, `approve`, `resume`, `status`, `abort`, `retry`) SHALL become thin wrappers over the matching `Factory` methods. Their stdout, stderr, exit codes and `--json` documents MUST stay identical to the baseline: `status --json` keeps its `{ active, driverAlive, queue, workspaceUsage, runs, corrupt }` shape, `abort` keeps `0`, `retry` keeps `0` and its usage errors, and `run`/`approve`/`resume` keep `0`, `2`, `4` and `6` where they use them today. One-shot commands without a `Factory` method (`init`, `update`, `doctor`, `detect`, `refine`, `quick`, `reword`, `reapprove`, `usage`, `gate`, `graph`, `repoint`, `land`, `artifacts`, `bench`, `completion`) keep their implementation and output; they read or write the same files as before.

#### Scenario: the baseline output is unchanged

- **WHEN** the `single` and `submodules` baseline scenarios run after the rewiring
- **THEN** stdout, stderr and the exit code equal the goldens
- **AND** `status --json` is deep-equal to the captured document

#### Scenario: the existing exit codes still hold

- **WHEN** `status --watch --json`, `retry` without `--task`, an unknown change id and a paused run are invoked
- **THEN** they return the same `Usage`, `Precondition` and `Paused` codes as the baseline

#### Scenario: one-shot commands are untouched

- **WHEN** `init`, `doctor`, `quick`, `reword`, `land` and the other commands without a `Factory` method run
- **THEN** their stdout, stderr and exit codes are unchanged
- **AND** they still read and write the same workspace files

### Requirement: `status --watch` follows the event stream

`status --watch` SHALL subscribe to `tailEvents` for the watched change and re-render the existing view after each event, instead of polling run state every two seconds. Event bursts SHALL be coalesced so at most one frame is drawn every 10 ms. It SHALL also re-render at least once per `--interval` so an idle run still shows a fresh timestamp. It SHALL keep the current frame format (`updated <time> · Ctrl-C to stop` followed by the same view), the terminal clear and the piped separator, and the `--watch`/`--json` exclusion with `ExitCode.Usage`. When no event log exists for the change (an older run or a run that never bound), it SHALL fall back to the current interval poll. `--interval` SHALL stay accepted as the heartbeat period and the fallback poll interval; it SHALL NOT delay a frame that an event triggers.

#### Scenario: a new event produces a frame

- **WHEN** the watched run appends a `task.merged` event
- **THEN** `status --watch` prints one new frame containing the updated task state
- **AND** it does not wait for the next fixed interval

#### Scenario: the frame format is unchanged

- **WHEN** `status --watch` runs on a terminal
- **THEN** it clears the screen and starts the frame with `updated <time> · Ctrl-C to stop`
- **AND** when piped it separates frames with a blank line
- **AND** the view body is the same `renderStatus` output as before

#### Scenario: a missing log falls back to polling

- **WHEN** the change has no `.factory/events/<id>.jsonl`
- **THEN** `status --watch` keeps reprinting at `--interval` like today
- **AND** it does not fail

#### Scenario: the existing guards still apply

- **WHEN** `status --watch --json` is invoked
- **THEN** it returns `ExitCode.Usage` with the existing message
- **AND** an invalid `--interval` still returns `ExitCode.Usage`

### Requirement: The `events` command prints a run's stream

The CLI SHALL add `events <runId> [--follow] [--from N] [--json]`. It SHALL always print the stored JSONL stream verbatim, one stored line per line; `--json` SHALL be accepted as the explicit form of the same canonical output and MUST NOT wrap or reformat it. `--follow` SHALL keep printing new events until interrupted, `--from N` SHALL start at `seq >= N` (default `1`), and the command SHALL accept the change id for completion. An unknown run id SHALL exit `4`, a non-integer or non-positive `--from` SHALL exit `2`, an empty stream SHALL exit `0`, and a malformed line SHALL be reported on stderr while the rest of the stream still prints. `docs/cli.md` and `loomwright events --help` SHALL document the command, and `loomwright --help` SHALL list it.

#### Scenario: a finished run replays completely

- **WHEN** `loomwright events <id> --json` runs on a finished stub run
- **THEN** every line parses as a `RunEvent`
- **AND** the sequence is gap-free from `1` to the last event
- **AND** `reduce` over the printed events equals the final state

#### Scenario: the default output is already JSONL

- **WHEN** `loomwright events <id>` and `loomwright events <id> --json` run on the same stream
- **THEN** both print the same stored JSONL lines
- **AND** `--json` adds no wrapper object and no field

#### Scenario: `--from` selects a tail

- **WHEN** `events <id> --from 3 --json` runs
- **THEN** the first printed event has `seq: 3`
- **AND** a `--from 0` or `--from abc` exits `2`

#### Scenario: `--follow` prints new events

- **WHEN** `events <id> --follow --json` is interrupted after a new event is appended
- **THEN** it printed the existing stream and the appended event
- **AND** it exited `0`

#### Scenario: help and completion include the command

- **WHEN** `loomwright --help`, `loomwright events --help` and shell completion run
- **THEN** the command is listed and completed
- **AND** `--follow`, `--from` and `--json` appear in the command help

#### Scenario: a corrupt line does not stop the stream

- **WHEN** the log contains a malformed complete line between two valid events
- **THEN** stderr reports the line and the valid events still print
- **AND** the exit code is `0`

### Requirement: Tests prove parity, robustness and payload hygiene

The suite SHALL contain golden event sequences for `single` and `submodules` with timestamps and run-specific values normalised, a check that `reduce` equals the persisted state projection at every checkpoint, a check that the terminal output and `status --json` equal the baseline, JSONL robustness tests (partial last line, concurrent tail, sequence gap), and payload cap and redaction tests. The number of passing tests SHALL NOT be lower than the baseline. Every task SHALL leave `bun run check` green, and the final acceptance SHALL also run `bun run build`.

#### Scenario: the goldens are committed and normalised

- **WHEN** the event goldens are regenerated
- **THEN** they contain no wall-clock timestamp, temporary path, pid or random id
- **AND** re-running the capture on the same machine produces the same bytes

#### Scenario: reduce parity is checked at every checkpoint

- **WHEN** the parity test replays a golden scenario
- **THEN** it compares `reduce(events-so-far)` with the persisted state projection at each checkpoint
- **AND** it fails at the first divergence with the checkpoint name

#### Scenario: the robustness cases are covered

- **WHEN** the robustness tests run
- **THEN** they cover a partial last line, a reader tailing during an append and a sequence gap
- **AND** they cover a payload over 8 KiB, a secret in a payload and a full gate output that must not be inlined

#### Scenario: the gate and the test count hold

- **WHEN** the acceptance runs `bun run check` and `bun run build`
- **THEN** both pass
- **AND** the passing test count is not below the baseline recorded by the first task

### Requirement: Documentation records the format and the decision

`docs/events.md` SHALL document the envelope, the sequence rule, the event families, the 8 KiB cap with truncation references, the redaction rule, the single-writer rule, the reader semantics (`fromSeq`, partial line, gaps), the `events` command, the command inbox (`answer`, `pause`) and the additive evolution checklist. ADR-0046 SHALL record the JSONL log, the sequence numbers, the versioning, the single writer and the minimal pause request with `## Context`, `## Decision` and `## Consequences`, and SHALL be listed in `docs/decisions/README.md`. `ARCHITECTURE.md` SHALL add `.factory/events/<id>.jsonl` to the workspace file table and an event module row to the module table, and `README.md` SHALL mention the `events` command. The ADR and the other files under `docs/decisions/` MUST NOT contain the capitalised product name, so the historical scan stays valid.

#### Scenario: the event docs cover the contract

- **WHEN** `docs/events.md` is read
- **THEN** it states the envelope, `seq`, the families, the cap and redaction, the single writer, the reader semantics and the additive rule
- **AND** it shows `events <runId> --json` and `status --watch` as the two consumers

#### Scenario: the ADR is valid and indexed

- **WHEN** `docs/decisions/0046-typed-event-stream.md` and the decisions index are read
- **THEN** the ADR starts `# 0046 — `, has the three required sections and is name-free
- **AND** the index has a row for it

#### Scenario: the architecture and README mention the stream

- **WHEN** `ARCHITECTURE.md` and `README.md` are read
- **THEN** the file table lists `.factory/events/<id>.jsonl` and the module table lists the event module
- **AND** the README mentions `loomwright events`

### Requirement: Protected files and out-of-scope work are reported

This change MUST NOT edit `factory.config.jsonc`, `factory.lock.json`, `.opencode/**`, `openspec/specs/**`, `AGENTS.md` or `factory-records/**`. The final report SHALL name every protected-file edit the change would need, or say there is none, and SHALL list the follow-ups. It SHALL NOT rename anything, upgrade a dependency, change a retention policy beyond keeping event logs with the logs, change pipeline semantics beyond the minimal `pause` request defined above, or add a TUI, web UI, node agent, daemon, server or auth.

#### Scenario: the protected paths have no diff

- **WHEN** the change's diff is inspected
- **THEN** it contains no edit under `factory.config.jsonc`, `factory.lock.json`, `.opencode/`, `openspec/specs/`, `AGENTS.md` or `factory-records/`

#### Scenario: the report lists the follow-ups

- **WHEN** the final report is read
- **THEN** it lists the TUI, web UI, node agent, daemon, auth and the plugin writer as out of scope
- **AND** it names any protected-file edit that must be done after landing, or says there is none

#### Scenario: no gate script is edited

- **WHEN** the root `package.json` is read
- **THEN** `format:check`, `lint`, `typecheck` and `test` keep their exact commands
- **AND** no gate script is renamed or repointed
