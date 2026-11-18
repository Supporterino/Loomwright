# 0046 — typed event stream

## Context

The pipeline already persists run state in `.factory/runs/<id>.json`, but progress only exists
as terminal output. A TUI, a web UI or a node agent would have to scrape stdout or read
internal state files. A second process cannot drive a run either: the CLI holds the state and
the approval gate. Adding a daemon, a socket or a message bus would add a process to supervise,
a transport to authenticate and a second source of truth to keep in sync, for a capability that
finishing a change does not need.

## Decision

- The orchestrator appends one typed event per state change to `.factory/events/<runId>.jsonl`:
  JSONL, one versioned envelope `{ v, runId, seq, ts, type, data }` per line, redacted and capped
  at 8 KiB with a reference into `.factory/logs/` for the full value.
- `seq` is allocated in the driving process, starts at 1 per run and continues after a resume
  from the last complete line.
- The protocol is versioned (`PROTOCOL_VERSION = 1`) and evolves additively; removing or
  renaming a type or field, changing a meaning or making an optional field required bumps the
  version and the envelope `v`.
- There is one writer and no daemon, socket or bus. The plugin, readers, `status --watch` and
  `events` only read.
- The one cross-process addition is a minimal file inbox, `.factory/commands/<runId>/`, for the
  commands that had no on-disk path (`answer`, `pause`). Files are validated, applied at a safe
  point and removed only after the effect is persisted.
- The terminal keeps its output by adding an event sink that replays events through the existing
  renderer, so the CLI output stays byte-identical.

Alternatives rejected: a socket or HTTP server (another process to supervise and authenticate);
a JSON snapshot instead of events (no replay, no tailing); a second progress channel next to
the renderer (two sources of truth); moving every command into the inbox (approve, abort, retry
and resume already have safe file and state paths).

## Consequences

- Progress is replayable and tail-able; a reader rebuilds a `RunSnapshot` from the stream.
- The CLI output does not change, and the event stream is an addition, not a replacement.
- No new dependency and no background process.
- The snapshot is a projection, not a full mirror: handoffs, context-pack paths and review
  bookkeeping are not replayable and still need the run file.
- Inbox commands take effect at the next safe point, so their latency is one pipeline step.
