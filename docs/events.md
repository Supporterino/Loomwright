# The run event stream

The orchestrator writes one append-only JSONL file per run: `.factory/events/<runId>.jsonl`.
It is the machine-readable record a future consumer (a TUI, a web UI, a node agent) reads; the
schemas live in `packages/protocol/src/` and the writer, reader and sinks in
`packages/core/src/events/`. The decision is [ADR-0046](decisions/0046-typed-event-stream.md),
and [docs/cli.md](cli.md) documents the `events` and `status --watch` commands.

This change ships the file format, the reader and two CLI consumers. It does not ship a TUI, a
daemon, authentication, or a human renderer for `events`.

## The envelope

Every line is one JSON object with the same six-field envelope:

```json
{
  "v": 1,
  "runId": "add-health",
  "seq": 1,
  "ts": "2026-11-17T09:00:00.000Z",
  "type": "run.started",
  "data": { "phase": "design" }
}
```

- `v` is `PROTOCOL_VERSION`, currently `1`.
- `runId` is the change id, e.g. `add-health`.
- `seq` starts at `1` for each run and increases by exactly one per event.
- `ts` is an ISO-8601 UTC timestamp ending in `Z` (`Date.prototype.toISOString`).
- `type` names the event; `data` is that type's payload.

Two lines of a real stream:

```jsonl
{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-17T09:00:00.000Z","type":"run.started","data":{"phase":"design"}}
{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-17T09:00:01.000Z","type":"phase.changed","data":{"from":"design","to":"awaiting-approval"}}
```

The payload schemas are non-strict (zod strips unknown keys), so a newer release can add an
optional field without breaking an older reader.

## The sequence rule

`seq` is allocated in the driving process, by the single event emitter. The stream is
append-only, so per run there is no duplicate and no gap: a resume seeds the counter from the
last complete line (`lastCompleteSeq`) and continues at the next number. It never restarts at
`1`, and a resumed run does not emit a second `run.started`.

A crash can leave at most one partial last line, because every write is one flushed
`appendFileSync` of a complete line. The next `bind` truncates that tail before appending, and
readers ignore a final line without a newline.

## The event families

`TaskRef` is `{ id, repo, title? }`; `GateRef` is `{ name, type, command? }`. Payloads that can
grow also accept the cap marker `truncated?` and `ref?` described below.

### run

| Event                 | Payload                                             |
| --------------------- | --------------------------------------------------- |
| `run.started`         | `{ phase }`                                         |
| `run.finished`        | `{ outcome: "done" \| "aborted" \| "paused" }`      |
| `run.paused`          | `{ reason }`                                        |
| `run.resumed`         | `{}`                                                |
| `run.aborted`         | `{}`                                                |
| `run.branches`        | `{ branches: Record<repo, { branch, base }> }`      |
| `run.pause-requested` | `{ reason? }` — the command inbox asked for a pause |

### phase.changed

| Event           | Payload                                       |
| --------------- | --------------------------------------------- |
| `phase.changed` | `{ from: Phase \| null, to: Phase, reason? }` |

`Phase` is one of `intake`, `design`, `awaiting-approval`, `queued`, `implementing`,
`reviewing`, `contracts`, `full-suite`, `closing`, `done`, `paused`, `aborted`.

A `phase.changed` away from `paused` also clears `pausedReason`, because the run file drops it
when the phase moves on; `run.paused` remains the event that sets it.

### task

| Event              | Payload                               |
| ------------------ | ------------------------------------- |
| `task.queued`      | `{ task: TaskRef, attempt? }`         |
| `task.started`     | `{ task: TaskRef, attempt }`          |
| `task.passed`      | `{ task: TaskRef, attempt? }`         |
| `task.failed`      | `{ task: TaskRef, reason, attempt? }` |
| `task.retried`     | `{ task: TaskRef, attempt, reason? }` |
| `task.blocked`     | `{ task: TaskRef, reason, attempt? }` |
| `task.skipped`     | `{ task: TaskRef, reason? }`          |
| `task.merging`     | `{ task: TaskRef }`                   |
| `task.merged`      | `{ task: TaskRef, commit }`           |
| `task.conflict`    | `{ task: TaskRef, files: string[] }`  |
| `task.requeued`    | `{ task: TaskRef, reason }`           |
| `task.transient`   | `{ task: TaskRef, reason }`           |
| `task.interrupted` | `{ task: TaskRef }`                   |
| `task.waiting`     | `{ tasks: [{ id, reason }] }`         |
| `task.removed`     | `{ task: TaskRef, reason? }`          |

`task.removed` drops the task from the replay: the run file deletes a review-fix task whose
finding routes to `specFindings`, so a stream without the removal would replay a phantom
failed task.

### gate

| Event           | Payload                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `gate.planned`  | `{ gates: GateRef[], stage? }`                                                   |
| `gate.started`  | `GateRef`                                                                        |
| `gate.finished` | `{ name, type, status, durationMs, outputRef? }`                                 |
| `gate.report`   | `{ passed, results: [{ name, type, status, durationMs }], durationMs?, stage? }` |

`type` is `format`, `lint`, `types`, `test` or `testAffected`; `status` is `pass`, `fail`,
`missing`, `skipped`, `not-check-only` or `timeout`. `gate.finished` never carries the gate
output: `outputRef` points at it in `.factory/logs/`. `gate.report.durationMs` is the elapsed
wall clock of the whole gate run (`results[].durationMs` is one gate's own runtime); it is
absent in streams written before it existed, and the terminal falls back to the sum. `stage`
names the run (`gates`, `gates after rebase`) when it is not the default, so the terminal
replays the same line it printed.

### agent

| Event            | Payload                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `agent.started`  | `{ step, agent, model, label?, attempt? }`                                       |
| `agent.finished` | `{ step, role, outcome, durationMs, usage, sessionId, problem? }`                |
| `agent.activity` | `{ step, detail, kind, status?, usage? }` — tool and step detail for `--verbose` |
| `agent.retry`    | `{ step, reason? }`                                                              |

`outcome` is `succeeded`, `failed` or `interrupted`; `usage` is
`{ input, output, reasoning, cacheRead, cacheWrite, cost }`. A `step-done` activity carries the
turn's `usage`, so the heartbeat line keeps its token count and reaches the stream as a
`heartbeat` event.

### install

| Event              | Payload                                |
| ------------------ | -------------------------------------- |
| `install.started`  | `{ step, repo, durationMs?, detail? }` |
| `install.finished` | `{ step, repo, durationMs?, detail? }` |
| `install.failed`   | `{ step, repo, durationMs?, detail? }` |

### question

| Event               | Payload                               |
| ------------------- | ------------------------------------- |
| `question.raised`   | `{ step, question, status, answer? }` |
| `question.answered` | `{ step, question, status, answer? }` |

`status` is `answered`, `skipped` or `unanswered`.

### approval

| Event                | Payload                              |
| -------------------- | ------------------------------------ |
| `approval.requested` | `{ specHash, specCommit }`           |
| `approval.granted`   | `{ approver, specHash, specCommit }` |

### usage.delta

| Event         | Payload                           |
| ------------- | --------------------------------- |
| `usage.delta` | `{ step, agent?, model?, usage }` |

### progress.line

| Event           | Payload           |
| --------------- | ----------------- |
| `progress.line` | `{ level, text }` |

`level` is `always` (shown even with `--quiet`), `normal` (hidden by `--quiet`) or `verbose`
(shown only with `--verbose`). The event exists so the terminal rendering survives a move to
event sinks: the same text a command printed before is now one event, and the terminal sink
replays it through the existing renderer. It is also why the event stream is the single source
for progress, not a second log. The `implement: N/N merged` summary is one `progress.line` at
`always`.

### heartbeat

| Event       | Payload    |
| ----------- | ---------- |
| `heartbeat` | `{ text }` |

The renderer builds the line (one entry per running session, gate and install, with elapsed
time and tokens) and the stream carries it pre-rendered, once per heartbeat interval.

## The 8 KiB cap and truncation references

A payload is serialised and measured before it is written. One over 8 KiB (8192 bytes) is not
stored inline: the full, already-redacted value is appended to `.factory/logs/<runId>/`, and
the event carries

```json
{
  "truncated": true,
  "ref": { "path": ".factory/logs/add-health/2026-11-17.jsonl", "offset": 0, "bytes": 41234 }
}
```

`path` is relative to the workspace, `offset` is the byte position of the value in that file
and `bytes` is its length. The stored event line is therefore at most 8 KiB plus the envelope.
The schema only carries the marker; the cap is enforced by the emitter in core.

## Redaction

Every payload is redacted before it is measured, capped and written, with the log rules
(`redact` and `secretEnvValues` in `packages/core/src/logs/redact.ts`). No token, credential,
environment value or full tool, gate or agent output enters the event log. `gate.finished`
carries an `outputRef` reference, never the output itself. The cap stores the redacted value, so
following a `ref` does not expose what redaction removed.

## The single writer

Only the process driving the run appends events. The plugin, readers, `status --watch`,
`events` and the `Factory` read methods never write. There is no daemon, socket or message bus:
the JSONL file is the stream, and the emitter is the only allocator of `seq`.

## Reader semantics

`readEvents(root, runId, { fromSeq })` returns `{ events, missing, skipped }`:
- `fromSeq` is inclusive and defaults to `1`.
- A missing file is an empty result, not an error.
- A trailing partial line is ignored.
- `missing` lists sequence numbers expected but absent; duplicates are not gaps.
- `skipped` lists complete lines that did not parse, failed the envelope, or named an unknown
  type, with their 1-based line numbers. The rest of the stream still returns.

`tailEvents(root, runId, { fromSeq, signal })` is an async iterator over `{ kind: "event" }`,
`{ kind: "raw", text, reason, seq? }` and `{ kind: "gap", missing }` items. A stored line that is
malformed, has a bad envelope or names an unknown type is yielded as `raw` rather than dropped,
so a follower prints what a replay prints. It watches `.factory/events` with `fs.watch` and also
polls, so a change the watch coalesces or drops still arrives within the poll period; it emits a
gap marker whenever a sequence number is absent, and completes without error when the abort
signal fires.

## The command inbox

Commands that have no existing on-disk path arrive as files in `.factory/commands/<runId>/`.
Each file is a JSON `Command` (from `packages/protocol/src/command.ts`) and is validated before
it is applied. Only `answer` and `pause` are applied here: `approve`, `abort`, `retry` and
`resume` keep their existing files and state paths, and the inbox rejects them with a pointer to
the command that does own them.

The inbox is consumed at a safe point: the top of each pipeline step, before the next phase work
starts. A writer creates a temp file and renames it into place, so a reader never sees a partial
file; a reader only applies complete `*.json` files. A consumed file is removed only after its
effect is persisted, so a crash before that point re-delivers the command. A file that does not
parse, or names another run, is reported and left unapplied.

## The two consumers

`loomwright events <runId> --json` prints the stored JSONL verbatim: one stored line per line,
no wrapper, sort or reformatting. The default output is already that canonical JSONL, so
`--json` is only the explicit spelling. `--follow` keeps printing, `--from <n>` starts at a
sequence number, and a corrupt line is reported on stderr while the rest still prints.

`loomwright status <runId> --watch` reprints its frame after each event, with an idle heartbeat and a polling fallback, until Ctrl-C. Both read; neither writes the stream.

## The retention rule

The event log is kept with `.factory/logs/<id>`. `land` keeps it, like the reports, usage and
logs it already keeps; there is no separate retention knob. A future `clean` command deletes it
together with the logs it belongs to.

## The additive evolution checklist

The protocol evolves additively. A release may, without a version bump:
- add an event type;
- add an optional field to an existing event;
- add an optional field to an existing payload.

A release must bump `PROTOCOL_VERSION` and the envelope `v` to:
- remove or rename an event type or a field;
- change an existing field's meaning;
- make an optional field required.

Consumers ignore an unknown `type` and unknown optional fields. A reader validates the
envelope of every line, skips a line whose type is unknown or whose payload does not validate,
and continues with the rest rather than failing the stream.

## Parity and the projection boundary

`RunSnapshot` (from `packages/protocol/src/snapshot.ts`) is a projection of the stream, not a
mirror of `.factory/runs/<id>.json`. Replaying every event rebuilds exactly these fields:
`phase`, `pausedReason`, `abortRequested`, `branches`, each task's `status` and `attempt`,
`questions`, `approval`, and `usage` (which must equal the `.factory/usage/<id>.json` ledger,
not the sum of `agent.finished.usage`). A parity check compares those fields at checkpoints.

Handoffs, context-pack paths and review bookkeeping are not replayable: the run file also keeps
`draft`, `serialOwner`, `graphSeq`, `reviewed`, `reReview`, `specFindings`, pointer and archive
data, and `reportPath`, and none of it is in the snapshot. A consumer that needs one of those
reads the run file; it cannot rebuild it from events.
