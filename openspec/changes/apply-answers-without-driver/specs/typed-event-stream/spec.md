# typed-event-stream Specification

## MODIFIED Requirements

### Requirement: `Factory.open` is the library command API

Core SHALL export `Factory.open(workspace, options)` returning an object with `run`, `resume`, `approve`, `retry`, `abort`, `answer`, `pause`, `status`, `listRuns` and `events`. `Factory.events(runId, { fromSeq, follow, signal })` SHALL expose the same `readEvents`/`tailEvents` semantics as the CLI command. `Factory.pause(runId)` SHALL write a validated `pause` command to the inbox, or set the equivalent request when it is the driving process, and SHALL return without blocking on the pipeline. `Factory.answer(runId, answer, question?)` SHALL persist the answer before it resolves when no live driver owns the run, through the shared apply path defined by "Commands without a path use a validated file inbox"; when a live driver owns the run it SHALL write one validated `answer` command and change no run state. `Factory.answer` MUST NOT load the install config or the install marker, so `Factory.openReadOnly` can answer a run whose questions pane already opens. `Factory` SHALL accept the workspace root and the injectable `out`, `err`, `signal`, `runtime`, `ask` and verbosity options that `Pipeline` already takes, so a caller can capture output and drive a scripted runtime. Every control command (`approve`, `answer`, `abort`, `retry`, `resume`, `pause`) SHALL be validated with the protocol `Command` schema. The read methods (`status`, `listRuns`, `events`) MUST NOT take the active-change lock or write run state. `Factory.status()` SHALL return the same data document that `status --json` serialises, so the CLI can render both the text and the JSON view from one source. The write methods SHALL keep today's rules: `claimActive`/`ensureDriver` before driving, the run lock around updates, `specHash` over the checkbox-normalised spec for `approve`, the `verifyApproval` hash-and-commit check, and the same precondition errors. `Factory` MUST NOT start a daemon, socket or network listener.

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

#### Scenario: an answer needs no install marker

- **WHEN** `Factory.openReadOnly` opened a git workspace without `factory.lock.json`, a run is
  `awaiting-approval` with one unanswered question, and `answer` is called
- **THEN** the answer is persisted and one `question.answered` is appended
- **AND** the call does not throw because the config or the install marker is missing

### Requirement: Commands without a path use a validated file inbox

Commands the TUI needs that have no on-disk path today SHALL be delivered through `.factory/commands/<runId>/`, one JSON file per command, validated with the protocol schema. The inbox SHALL carry `answer` and `pause`. An `answer` SHALL be written to the inbox only while a live driver owns the run: the active lock names that run and `driverAlive` is true. The orchestrator SHALL consume that file at a safe point, apply the answer and remove it; an invalid file SHALL be rejected with a diagnostic and SHALL NOT fail the run. When no live driver owns the run, `Factory.answer` SHALL apply the answer immediately instead of leaving it for a later reader: it SHALL take the run's state lock and re-check liveness there, mark the matching clarification answered, or append the unrecorded-question fallback at step `answer`, emit exactly one `question.answered` with the record's real `step` and `question` from the process that writes it, rewrite `.factory/clarifications/<id>.md` and the change's `questions.md` (the draft's copy when the run has a `draft`), and leave no `answer` file behind. It SHALL remove stale `answer` files for the same question so a later driver cannot apply an outdated answer. The state application, the fallback and the clarification-file rewrite SHALL be one shared function used by the driver and the direct path, so a driver that consumes an inbox answer also rewrites `questions.md`. A record that is already answered SHALL be idempotent: a re-delivered or stale answer MUST NOT emit a second `question.answered` and MUST NOT change the recorded answer text, though it MAY rewrite the clarification files. A writer SHALL write a temporary file and rename it into place; the orchestrator SHALL ignore an unreadable or partial file until the next safe point. No daemon, socket or network listener SHALL be added. `approve`, `abort`, `retry` and `resume` keep their existing files (`approvals/<id>.json`, run state, queue).

A `pause` command SHALL make the orchestrator stop at its next safe point without aborting and without changing the persisted run-state schema: it SHALL persist `phase: "paused"` with a `pausedReason` of `pause requested`, emit `run.pause-requested` when it consumes the file and `run.paused` when it stops, release the driver, keep branches, worktrees and task progress, and only then remove the file. `resume` continues from the paused phase through the existing resume path. Keeping the request file until the pause is persisted makes a crash between consumption and pause safe: the next process consumes it again.

#### Scenario: an answer is delivered and consumed

- **WHEN** a reader writes a valid `answer` command for a run that is between questions or has no TTY
- **THEN** the orchestrator applies the answer at the next safe point, records it in the clarification list and removes the file
- **AND** the stream contains `question.answered`

#### Scenario: a live driver owns the answer

- **WHEN** a live driver owns the run and `Factory.answer` is called with the question and answer
- **THEN** `.factory/commands/<id>/` holds one validated `answer` file and the run state is unchanged
- **AND** no `question.answered` is appended before the driver consumes it
- **AND** the driver applies it at its next safe point: the record is answered, exactly one `question.answered` is appended, both clarification files are rewritten, and the file is removed

#### Scenario: an answer with no driver is persisted immediately

- **WHEN** no live driver owns a run with an unanswered `design` question and `Factory.answer` is
  called with that question and an answer
- **THEN** the run file records the answer under the run lock
- **AND** `.factory/events/<id>.jsonl` gains exactly one `question.answered` whose `step` is
  `design` and whose `question` is the record's text
- **AND** `.factory/clarifications/<id>.md` and `openspec/changes/<id>/questions.md` carry the answer
- **AND** `.factory/commands/<id>/` holds no `answer` file
- **AND** the phase, approvals and tasks are unchanged

#### Scenario: the draft's questions file is the one rewritten

- **WHEN** the run has a `draft` and an answer is applied with no driver
- **THEN** `<draft>/openspec/changes/<id>/questions.md` is rewritten
- **AND** this answer does not create or rewrite the workspace-root copy

#### Scenario: a re-delivered answer is a no-op

- **WHEN** a record is already answered and a stale `answer` file for the same question is consumed
- **THEN** `.factory/events/<id>.jsonl` still holds exactly one `question.answered` for that record
- **AND** the recorded answer text is unchanged
- **AND** the stale file is removed

#### Scenario: a direct apply removes a stale answer file

- **WHEN** `Factory.answer` applies a new answer immediately and an `answer` file for the same
  question was already in the inbox
- **THEN** the stale file is removed before the call returns
- **AND** exactly one `question.answered` was appended

#### Scenario: an unrecorded question keeps the fallback

- **WHEN** no clarification matches the question and the answer is applied with no driver
- **THEN** a record with step `answer`, status `answered` and the answer is appended
- **AND** exactly one `question.answered` names step `answer` and that question

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

### Requirement: Documentation records the format and the decision

`docs/events.md` SHALL document the envelope, the sequence rule, the event families, the 8 KiB cap with truncation references, the redaction rule, the single-writer rule, the reader semantics (`fromSeq`, partial line, gaps), the `events` command, the command inbox (`answer`, `pause`) and the additive evolution checklist. It SHALL state that `answer` uses the inbox only while a live driver owns the run and is otherwise persisted immediately by the writer, while `pause` stays an inbox request consumed at a safe point. ADR-0046 SHALL record the JSONL log, the sequence numbers, the versioning, the single writer and the minimal pause request with `## Context`, `## Decision` and `## Consequences`, and SHALL be listed in `docs/decisions/README.md`. ADR-0050 SHALL record the immediate answer path as an extension of ADR-0046, name ADR-0046 as the decision it extends, and be listed in the index; the historical ADR-0046 text stays unchanged. `ARCHITECTURE.md` SHALL list `.factory/events/<id>.jsonl` and the `.factory/commands/<id>/` row in the workspace file table and SHALL describe the inbox there as the live-driver path; `README.md` SHALL mention the `events` command. The ADRs and the other files under `docs/decisions/` MUST NOT contain the capitalised product name, so the historical scan stays valid.

#### Scenario: the event docs cover the contract

- **WHEN** `docs/events.md` is read
- **THEN** it states the envelope, `seq`, the families, the cap and redaction, the single writer, the reader semantics and the additive rule
- **AND** it shows `events <runId> --json` and `status --watch` as the two consumers
- **AND** it states that an `answer` is persisted immediately when no live driver owns the run and otherwise waits in the inbox

#### Scenario: the ADR is valid and indexed

- **WHEN** `docs/decisions/0046-typed-event-stream.md`, `docs/decisions/0050-answer-without-driver.md` and the decisions index are read
- **THEN** each ADR starts `# 00NN — `, has the three required sections and is name-free
- **AND** ADR-0050 names ADR-0046 as the decision it extends
- **AND** ADR-0046's text is unchanged
- **AND** the index has a row for each

#### Scenario: the architecture and README mention the stream

- **WHEN** `ARCHITECTURE.md` and `README.md` are read
- **THEN** the file table lists `.factory/events/<id>.jsonl` and the module table lists the event module
- **AND** the `.factory/commands/<id>/` row names the live-driver answer path
- **AND** the README mentions `loomwright events`
