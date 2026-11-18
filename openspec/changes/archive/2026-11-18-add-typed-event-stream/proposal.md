# Proposal: Typed event stream and command API

## Why

Progress is currently terminal lines produced by `Progress` plus `.factory/runs/<id>.json`, which `status --watch` polls every two seconds. There is no typed source a TUI, a web UI or a later node agent can consume, and a second process can only approximate control by editing run state. A versioned event stream plus a library-level command API gives the CLI and every future consumer one source of truth for progress and control, without changing what users see today apart from a new `events` command.

## What Changes

- Capture the baseline first: stdout, stderr and exit codes of the stub-runtime `single` and `submodules` scenarios, the current `status --json` output, an inventory of every progress print and run-state mutation, and how a second process signals a running run today.
- Raise `packages/protocol` to `PROTOCOL_VERSION = 1` and add a zod `RunEvent` discriminated union with the envelope `{ v, runId, seq, ts, type, data }`, a `RunSnapshot`, a pure `reduce(events) → RunSnapshot`, and a validated `Command` union (`approve`, `answer`, `abort`, `retry`, `resume`, `pause`).
- Add an orchestrator-owned `EventSink` emitter in core with three sinks: append-only JSONL at `.factory/events/<runId>.jsonl`, a terminal printer that reproduces today's lines byte-identically, and an in-memory sink for tests. Only the orchestrator writes events.
- Add `readEvents(runId, { fromSeq })` and `tailEvents(runId, { fromSeq, signal })` (async iterator over `fs.watch` with a polling fallback), tolerating a truncated last line and reporting sequence gaps.
- Add `Factory.open(workspace)` in core with `run`, `resume`, `approve`, `retry`, `abort`, `answer`, `pause`, `status`, `listRuns` and `events`. Commands are validated with the protocol schemas and keep today's active-change locking and approval-hash rules.
- Keep cross-process control on the existing on-disk mechanisms. Add the minimal validated file inbox `.factory/commands/<runId>/` for the commands the TUI needs that have no path today (`answer` and `pause`); `pause` stops the driver at the next safe point without aborting and keeps the run state schema unchanged. No daemon, socket or network listener.
- Rewire the run-state CLI commands (`run`, `approve`, `resume`, `status`, `abort`, `retry`) as thin `Factory` wrappers. Output, exit codes and `--json` shapes stay unchanged. Drive `status --watch` from `tailEvents` instead of fixed two-second polling, with unchanged output.
- Add `events <runId> [--follow] [--from N] [--json]`, always printing a run's canonical JSONL stream; `--json` is accepted as the explicit form of the same output. Document it in `docs/cli.md` and in `--help`.
- Add golden event sequences for `single` and `submodules` with normalised timestamps, reducer-equals-persisted-state checks at every checkpoint, JSONL robustness tests (partial last line, concurrent tail, sequence gaps) and payload cap/redaction tests.
- Write `docs/events.md`, ADR-0046 (JSONL, sequence numbers, versioning, single writer), update the ARCHITECTURE state layout and module table, and mention the stream in the README.

## Capabilities

### New Capabilities

- `typed-event-stream`: the versioned `RunEvent`/`RunSnapshot`/`reduce`/`Command` protocol, the orchestrator-owned JSONL and terminal sinks, the event reader and tailer, the `Factory.open` command API, the on-disk command inbox, the CLI `events` command and the event-driven `status --watch`, plus the baseline, golden and robustness tests and the documentation that governs the format.

### Modified Capabilities

- `monorepo-layout`: `packages/protocol` is no longer a one-constant skeleton. It exports `PROTOCOL_VERSION = 1` and the event protocol from its root index; the `cli → core → protocol` dependency rule, the package identities and the subpath exports are unchanged.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** the private `@loomwright/protocol` root export grows from one constant to the event schemas, `reduce` and `Command`. `@loomwright/core` gains `factory.ts`, `events/` and a protocol re-export so the CLI never imports protocol directly. The CLI gains one command and a changed `status --watch` implementation; all existing stdout, stderr, exit codes and `--json` documents stay identical.
- **Contracts:** none configured. No external API, event bus or Helm value changes.
- **Data:** two new gitignored paths under `.factory/`: `events/<runId>.jsonl` (kept by `land` with the logs, as requested) and `commands/<runId>/` (consumed and removed by the orchestrator; a pause request is kept until the pause is persisted). No run-state schema change and no migration; old runs without an event log keep working through the polling fallback.
- **Protected files:** none edited. `openspec/specs/monorepo-layout/spec.md` is updated by this change's delta on archive; `factory.config.jsonc`, `AGENTS.md`, `.opencode/` and `factory.lock.json` need no edit.

## Follow-ups (not in this change)

- The TUI, a web UI, a node agent, a daemon or any network server.
- Auth, retention-policy changes (the event log is kept with the logs), semantic changes beyond the minimal `pause` request, renames and dependency upgrades.
- Plugin-authored events: the opencode plugin stays read-only and never writes the stream.
