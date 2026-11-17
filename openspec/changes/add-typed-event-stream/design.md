# Design: Typed event stream and command API

## Context

Progress is a terminal side effect: `packages/core/src/pipeline/progress.ts::Progress` holds the active sessions, gates and installs, and `Pipeline.out` prints banners. The only durable view is `.factory/runs/<id>.json`, which `status --watch` re-reads every two seconds. A future TUI or node agent would have to scrape text or poll JSON, and it would have no validated way to send a command. This change introduces one typed stream and one library API without changing what a user sees, apart from the new `events` command.

The hard constraints are:

- `bun run check` green after every task; no edits to gate scripts in the root `package.json`.
- Existing stdout, stderr, exit codes and `--json` documents stay byte- or shape-identical.
- Only the orchestrator writes events; readers, `status --watch`, `events` and `Factory` read methods never write.
- No daemon, socket, network listener, auth or pipeline-semantics change.
- `cli → core → protocol` stays enforced; the CLI reaches protocol types only through core re-exports.
- Protected files are reported, never edited.

## Baseline

Captured by task 1.1 before its first edit and committed next to the goldens under `packages/cli/test/fixtures/baseline/`. The exact test count and byte counts live in that capture, not in this file: `design.md` is covered by the approval hash and may not be edited after approval. The fixed observations from the current tree are:

| Item | Baseline |
| --- | --- |
| Protocol | `packages/protocol/src/index.ts` exports only `PROTOCOL_VERSION = 0`; the package export map is `"." -> ./src/index.ts`; `test/config.test.ts` asserts `0`. |
| CLI shell | `packages/cli/src/main.ts::COMMANDS`; one file per command under `packages/cli/src/commands/`; `run`/`approve`/`resume` live in `pipeline-commands.ts`, `status`/`abort`/`retry` in `state-commands.ts`; hidden `__complete` is the only hidden command. |
| Run-state commands | `run`, `approve`, `resume`, `status`, `abort`, `retry` read or mutate `.factory/runs/<id>.json`, `.factory/active.lock`, `.factory/queue.json` or `.factory/approvals/<id>.json`. One-shot commands (`init`, `update`, `doctor`, `detect`, `refine`, `quick`, `reword`, `reapprove`, `usage`, `gate`, `graph`, `repoint`, `land`, `artifacts`, `bench`, `completion`) do not map to a `Factory` method in this change. |
| Print sites | `Progress` methods `line`, `note`, `agentStarted`, `agentFinished`, `activity`, `gate`, `gatesDone`, `install`, `task`, `implementSummary`, `tick`; about 47 `p.out` banners across `design.ts`, `drive.ts`, `implement.ts`, `finish.ts`, `contracts.ts`, `approve.ts`; 18 direct `p.progress.*` calls in `context.ts`, `implement.ts`, `finish.ts`, `quick.ts` and `contracts.ts`. |
| Event sources | `scheduler/scheduler.ts::TaskEvent` (10 variants), `gates/run.ts::GateEvent` + `GateReport`, `runtime/types.ts::SessionActivity` + `Usage`, `state/run.ts::RunState`/`Phase`/`TaskState`, `state/run.ts::Clarification`, `approval/approval.ts::Approval`. |
| Cross-process control | `active.lock` names the driver; `queue.json` holds approved changes; `abort` sets `run.abortRequested` and `phase = "aborted"`; `approve` writes `approvals/<id>.json`; `retry` rewrites task state; `resume` is a run-state and lock decision. `answer` has no path: a second process cannot answer an agent question. `pause` has no command at all today; this change adds it. |
| `status --json` | Top-level `{ active, driverAlive, queue, workspaceUsage?, runs[], corrupt[] }`; `runs[]` is each `RunState` plus a `usage` summary. |
| Retention | `land` deletes run state and approvals but keeps `.factory/reports/<id>.md`, `.factory/usage/<id>.json` and `.factory/logs/<id>`. `pruneLogs` applies `logs.retentionDays` to the log tree only. No `clean` command exists today. |
| ADR | Next free number is `0046`; `test/docs.test.ts` requires `# 0046 — `, the three sections, an index row and no capitalised product name in `docs/decisions/`. |
| Tests | Stub scenarios `single` and `submodules` exist as `createSingleRepoFixture`/`createSubmoduleFixture` with `scripted-runtime.ts` and `factory-script.ts`; there is no snapshot helper, so goldens are plain committed files. |

The capture procedure is fixed: run `single` and `submodules` through the stub runtime, record stdout, stderr and the exit code, normalise ISO timestamps, temp paths, pids and random ids, write the files under the baseline directory, and record the `bun test` pass count and the `bun run check` result.

## Decisions

### 1. The baseline is committed, not written into `design.md`

`design.md` is covered by `specHash`, so a post-approval edit would void the approval the first task depends on. Task 1.1 therefore commits machine-generated goldens and a short inventory next to them, and this file fixes the procedure and the threshold rules. Rejected: recording the numbers in `design.md` after approval (breaks the approval hash) and treating the baseline as prose only (not reproducible).

### 2. Protocol version 1 stays in the root index, with no new subpath export

`packages/protocol/src/index.ts` grows from one constant to the event schema, `reduce`, `emptySnapshot`, `Command` and `PROTOCOL_VERSION = 1`. The package export map stays `"." -> ./src/index.ts`, so `packages/protocol/package.json` does not change. Core re-exports the protocol through `packages/core/src/events/protocol.ts`; the CLI imports only core, which keeps the architecture rule intact.

Rejected: a new `./events` subpath (a manifest change with no consumer benefit) and letting the CLI import protocol directly (forbidden by `test/architecture.test.ts`).

### 3. Envelope, sequence and run binding

`RunEvent` is a zod discriminated union on `type` with envelope `{ v, runId, seq, ts, type, data }`. `v` is `PROTOCOL_VERSION`, `seq` is a per-run integer starting at `1`, `ts` is `new Date().toISOString()`, and `data` is the payload. The emitter allocates `seq` in process and starts a persisted stream when intake creates `.factory/runs/<id>.json`: the first persisted event is `run.started` at phase `design`, `seq: 1`. When the log already exists (a resume), the emitter seeds its counter from the last complete line and continues at the next number; it never restarts at `1`. Terminal lines printed before that point (the `▶ intake` banner and intake clarification prompts) stay terminal-only; they happen before a run id exists.

Rejected: writing intake events under a provisional `intake` run id and renaming the file (the `runId` in the early lines would disagree with the file name) and giving every CLI invocation a synthetic run id (the stream would not match the run state).

### 4. Event families derive from the real sources, with one note channel

The structured families map directly: `TaskEvent` to `task.*`, `GateEvent`/`GateReport` to `gate.*`, `SessionActivity` to `agent.activity`/`agent.retry`, `Progress.install` to `install.*`, `Progress.agentStarted`/`agentFinished` to `agent.*`, clarifications to `question.*`, `Approval` to `approval.*`, usage to `usage.delta`, and `RunState` transitions to `run.*`/`phase.changed`. The task family keeps the merge and retry transitions the terminal prints (`merging`, `merged`, `conflict`, `requeued`, `transient`, `interrupted`, `waiting`), not only the requested `queued`/`started`/`passed`/`failed`/`retried`/`blocked`/`skipped` set.

A generic `progress.line` event carries a banner or note that has no structured family, with `level: "always" | "normal" | "verbose"`. Without it the terminal sink cannot reproduce `p.out` banners byte-identically. It is an escape hatch, not the default: every line that maps to a structured family uses that family.

Rejected: inferring banners from structured events (ambiguous wording and ordering) and leaving banners out of the stream (the stream would not explain the terminal).

### 5. `RunSnapshot` is a projection, not a second run state

`reduce` models what a consumer needs to render progress and decisions: phase, pause reason, abort and pause flags, branch per repo, per-task status and attempt, questions and answers, approval hash/commit/approver, aggregated usage and the last gate result. It does not mirror the whole `RunState` (handoffs, context-pack paths, review bookkeeping). Parity is asserted against `projectRunState(RunState)`, a pure projection defined in core, and usage is compared with the usage ledger rather than the run file.

Rejected: a full mirror of `RunState` in events (duplicates approval-hashed state and grows every time the run schema grows) and a stateful reducer that reads the run file (breaks replay).

### 6. One writer, serialised appends

The orchestrator's `Pipeline` owns the emitter. The JSONL sink uses `appendFileSync` (one complete line, flushed by the call) and a small promise chain or semaphore so two async producers cannot interleave. Readers never open the file for writing. A crash leaves at most a partial last line. On bind, the writer truncates that incomplete tail back to the last newline before appending, so a resumed stream stays line-delimited; complete lines are never rewritten. The plugin is not wired to the emitter; that is a follow-up if it ever needs to publish events.

Rejected: an event bus or a socket (a daemon by another name), a shared append from the plugin (two writers with no ordering), and a database (new dependency and a migration).

### 7. The terminal sink reuses the existing renderer

The terminal sink owns a `Progress` instance and maps a `RunEvent` to the same `Progress` method that printed the line before. Events that carry a pre-rendered detail (`agent.activity`, `progress.line`) print that detail; events that carry structured data (`task.*`, `gate.*`, `agent.started`/`finished`) pass the reconstructed arguments to `Progress`. The renderer text is not rewritten. The baseline goldens (task 1.1) are the byte-level proof for `normal`, `quiet` and `verbose`.

Rejected: reimplementing the line formatting in the sink (two renderers drift) and keeping the direct `Progress` calls alongside the emitter (two sources of truth, and the stream cannot explain a line).

### 8. Reader semantics

`readEvents(root, runId, { fromSeq })` returns the complete events with `seq >= fromSeq` (inclusive, default `1`), the missing sequence numbers and the skipped lines. It reads newline-delimited lines, ignores a final line without a newline, and treats a missing file as an empty stream. `tailEvents(root, runId, { fromSeq, signal })` is an async iterator built on `fs.watch` with a polling fallback; it yields events, yields a gap marker when a sequence number is skipped, and ends on abort. A malformed complete line is reported, not fatal.

Rejected: throwing on a partial line (normal during a live run), rewriting the log to repair a gap (the writer owns the file), and polling only (latency without `fs.watch`).

### 9. `Factory.open` is a thin orchestrator over the existing modules

`Factory.open(workspace, options)` resolves the config and lock, and returns the ten methods. It accepts the same injections as `Pipeline` (`out`, `err`, `signal`, `runtime`, `ask`, verbosity) so CLI tests can capture output and use the scripted runtime. Write methods call the existing `approve`, `drive`, `retryTask` and `updateRun` code; they do not reimplement locking, hashes or phase rules. `pause` writes the validated inbox command (or sets the equivalent request when it is the driver) and returns immediately; the orchestrator stops at its next safe point. Read methods call the existing readers. `Factory` never starts a process, socket or watcher beyond the event tailer it exposes.

Rejected: a second implementation of approve/abort in `Factory` (drift from the CLI) and making `Factory` an object that owns a long-lived runtime (a daemon).

### 10. The file inbox carries `answer` and `pause`

`approve` (approval file), `abort` (run flag), `retry` (run state) and `resume` (run state and lock) already have on-disk paths. `answer` has none, and `pause` has no command at all, so the orchestrator consumes `.factory/commands/<runId>/*.json` at a safe point, validates each with `Command.parse`, applies it and removes the file. A writer writes a temporary file and renames it into place; the orchestrator ignores an unreadable or partial file until the next safe point. An invalid file is reported and left unapplied.

`pause` is a request file, not a run-state field: the orchestrator consumes it at a safe point, emits `run.pause-requested`, persists `phase: "paused"` with a `pausedReason`, emits `run.paused`, releases the driver, keeps branches, worktrees and task progress, and only then removes the file. Keeping it until the pause is persisted makes a crash between consumption and pause safe. `resume` uses the existing resume path; there is no flag to clear. This deliberately leaves `RunState` unchanged, so `status --json` keeps its exact shape. It does not interrupt a session mid-turn; it stops at the next safe point, which is the same boundary `abort` uses. No listener is added.

Rejected: a Unix socket or HTTP endpoint (explicitly out of scope), making every command use the inbox (it would duplicate the tested approval and lock paths), and a hard process signal for pause (not portable and not resumable).

### 11. CLI wrapper scope

The commands that map to `Factory` (`run`, `approve`, `resume`, `status`, `abort`, `retry`) become thin wrappers. The others keep their implementation because `Factory` does not expose them and they touch different concerns: `init`/`update`/`doctor`/`detect` configure the workspace, `refine`/`quick` are separate paths, `reword`/`reapprove` change approvals, `usage`/`gate`/`graph`/`repoint`/`land`/`artifacts`/`bench`/`completion` are one-shot utilities. Their output and exit codes stay as they are.

Rejected: forcing every command through a ten-method API (invents methods the request did not list) and leaving `run`/`status` with their own copy of the locking logic (the drift this change exists to remove).

### 12. `status --watch` tails with a polling fallback

`status --watch` subscribes to `tailEvents` and re-renders the existing view on each event, with a minimum frame interval so a burst does not flood the terminal and a heartbeat frame at least once per `--interval` so an idle run still shows a fresh timestamp. When the change has no event log (an older run or a run that never bound), it falls back to the current interval poll. `--interval` stays accepted as the minimum interval and the fallback period; the `--watch`/`--json` exclusion still returns `ExitCode.Usage`. The frame text, the terminal clear and the piped separator do not change.

Rejected: removing `--interval` (a documented flag and an existing test) and keeping the two-second poll as the primary path (the request's whole point).

### 13. `events` prints the canonical JSONL by default

`events` always prints the stored JSONL line for the selected events, one stored line per line. `--json` is accepted as the explicit spelling of the same canonical output and does not wrap, sort or reformat it; that keeps the replay contract clear for scripts and for the acceptance test. `--follow` works in both spellings. `--from` is inclusive and defaults to `1`. The command exits `4` for an unknown run, `2` for an invalid `--from`, and `0` for an empty stream; a corrupt line is reported on stderr and does not stop the stream.

Rejected: human lines by default (the request asked for JSONL, and a human renderer would make `--json` the only machine path) and a wrapper array with `--json` (breaks byte-for-byte replay and the acceptance test).

### 14. Event retention follows the logs

`.factory/events/<runId>.jsonl` is progress data, so it is kept with `.factory/logs/<id>`: `land` keeps it and lists it under `kept`, while still deleting run state and approvals. This is the chosen retention answer: a landed change can replay its stream. A future `clean` command deletes it with the logs. `pruneLogs` is unchanged: this change does not add or change a retention policy.

Rejected: deleting events on `land` (loses the only stream a landed change can replay) and adding a new retention knob (out of scope).

### 15. Documentation and ADR-0046

`docs/events.md` is the format reference and the evolution checklist. ADR-0046 records the JSONL log, sequence numbers, versioning and the single writer. The ADR is name-free so the strict historical scan in `test/docs.test.ts` stays valid. `ARCHITECTURE.md` gains the state-table row and an event module row; `README.md` mentions `loomwright events`; `docs/cli.md` documents the new command and the changed `status --watch` wording.

### 16. No gate script or plugin change

The root `package.json` scripts are untouched. The opencode plugin is not changed: it does not publish events, and `templates/plugin/factory-plugin.txt` therefore needs no rebuild. If a task finds a plugin change unavoidable, it pauses and reports instead.

## Contract changes

This is an internal, private-package contract:

- `@loomwright/protocol` root export: `PROTOCOL_VERSION` becomes `1`; adds the event schema, `RunSnapshot`, `reduce`, `emptySnapshot` and `Command`, including the new `pause` command.
- `@loomwright/core`: adds `factory.ts`, `events/` and a protocol re-export; no existing export changes meaning and `RunState` keeps its schema.
- On-disk: adds `.factory/events/<runId>.jsonl` and `.factory/commands/<runId>/`; no existing path or run-state field is renamed or reformatted.
- CLI: adds `events`; `status --watch` implementation changes with unchanged output and flags.

No configured API schema, event bus or Helm contract exists, so there is no external contract diff.

## Risks

- Byte-identical terminal output is the main regression risk. The `Progress` renderer is reused, and the 1.1 goldens gate every wiring task; quiet and verbose are checked by the existing progress tests.
- Intake lines are not in the persisted stream because no run id exists yet. The stream starts at `run.started`; a consumer that needs intake output must read the terminal log. Recorded as a deliberate boundary.
- `reduce` parity is a projection, not a full `RunState` mirror. A field outside the projection is not replayable; the projection is documented in `docs/events.md` and covered by the parity test.
- `fs.watch` behaviour differs across platforms; the polling fallback is required and tested by injecting the fallback path.
- The `answer` and `pause` inboxes are polled at safe points, so a TUI may wait for the next checkpoint. That is the price of no daemon; the request allows it.
- `pause` is a new request, not an abort: it stops at the next safe point, persists `phase: "paused"` and releases the driver. A long agent turn finishes before the pause takes effect; a hard interrupt is still Ctrl-C or `abort`.
- The pause request stays a file under `.factory/commands/` and is removed only after `phase: "paused"` is persisted, so a crash between consumption and pause re-delivers it. No run-state schema changes, which keeps `status --json` byte-shape identical.
- `--interval` now means a minimum frame interval and the fallback poll period, not a fixed cadence. The flag, its validation and the frame format stay the same.
- `events` prints the canonical JSONL in both spellings, so `--json` is currently an explicit alias. The contract is the bytes, not the flag; a later human renderer would be a separate flag or a separate command.
- There is no `clean` command today; the retention rule is written for `land` (keep with the logs) and for a future `clean`.
- The test count must not fall. The baseline capture fixes it; new files and tests are allowed.
- The plugin bundle is not rebuilt. If a task changes `packages/core/src/plugin/` or `packages/core/src/policy/`, `bun run build:plugin` would be required; this change does not.
- Protected files are not edited. The `monorepo-layout` spec change ships as this change's delta and is applied on archive.

## Protected files

No protected file is edited:

- `factory.config.jsonc`: no new knob; `logs.retentionDays` still governs logs only.
- `factory.lock.json` and `.opencode/`: the plugin and agents are unchanged, so `loomwright update` needs no refresh for this change.
- `openspec/specs/`: the `monorepo-layout` update is delivered as the delta under this change and applied on archive.
- `AGENTS.md`: no source path in the new code is named there; no edit is needed.
- `factory-records/`: the new paths are local-only and gitignored.
