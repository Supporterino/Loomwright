# Proposal: A terminal UI for watching and controlling factory runs

## Why

Every run already writes a typed event stream and every read the UI needs is exposed by
`Factory`, but the only way to watch a run is `status --watch`, which reprints a text frame in a
second terminal. There is no way to start a change, approve a spec, answer a question or abort a
run from that view without switching to another shell and retyping a command. A terminal UI over
the same stream, the same read API and the same command API closes that gap without changing how
a run is driven.

The one fact the stream does not carry is the spec hash while a change waits for approval:
`approval.requested` is only emitted inside `approve`, after the fact. The approval overlay needs
that hash before the human decides, so this change adds one additive event, `approval.pending`,
emitted when design parks the change at `awaiting-approval`.

## What Changes

- Add the additive `approval.pending` event (`{ specHash, changeDir }`) to the protocol union,
  `EVENT_TYPES`, `reduce`/`RunSnapshot` and the terminal sink, emit it from design when the phase
  becomes `awaiting-approval`, and re-record the event goldens. `PROTOCOL_VERSION` stays `1`;
  `approval.requested`/`approval.granted` remain the authority for the spec commit and approver.
- Add the private workspace `packages/tui` (`@loomwright/tui`, Ink 6.4.0 + React 19.3.1 pinned)
  that depends on `core` and `protocol` only, and bundle it as a second, lazily loaded entry
  `packages/cli/dist/tui.js` so no other command pays its startup cost.
- Add `loomwright tui` (alias `ai-factory tui`) for the current workspace: a run list (newest
  first) and a run view with header (id, phase, elapsed, tokens, cost, lock), task list in
  dependency order with status, a task detail pane (agent role, retries, gates, duration, live
  activity tail with log references) and a key-hints footer.
- Drive the UI from `reduce(readEvents)` plus `tailEvents`, with run existence, phase, lock and
  queue from `Factory.status()`/`listRuns()` and usage from the ledger that `status` already
  summarises. No reading of `.factory/` files, no engine internals.
- Start a run from the TUI with one dialog: a multi-line text composer or a request-file picker
  (completion, resolved absolute path, size, preview) that ends in a detached `run` child with
  `--no-interactive`; inline errors for a blank request, a bad file, an in-flight spawn and an
  uninstalled workspace; queued-after-another-change wording when a driver is active.
- Show a spec-approval overlay whenever the phase is `awaiting-approval`, with the run summary,
  change dir, pending spec hash, spec commit and approver once known, and the identity the CLI
  will record. Four actions with their own confirmations, each a detached child: approve and run
  (`a`), approve only (`A`), reword (`w`, only with spec findings) and reapprove (`R`, only when a
  spec commit is known). The overlay is read-only after a spawn and closes on `approval.granted`
  plus the next `phase.changed`.
- Answer questions by writing through `Factory.answer` and label the result honestly ("recorded —
  applies at the next step" until `question.answered` arrives); abort (confirmed) and retry stay
  on `Factory`, resume is a detached child.
- Never call `Factory.run`, `Factory.approve` with continue or `Factory.resume` in-process, so
  quitting, Ctrl-C, SIGTERM or a crash leaves every spawned run untouched, and always restore the
  terminal.
- Layout from 80×24 up, two panes at 100 columns and wider, glyph plus label for every state,
  `NO_COLOR`, `--ascii`, automatic ASCII on a non-UTF-8 locale or `TERM=dumb`, keyboard only, and
  the brand tokens (lilac for focus and running, coral only for the approval gate) from one
  module.
- Bound the cost: at most 10 frames per second, batched events, a 2,000-line activity ring
  buffer, `status()` at most once per second and immediately after a spawn, and a 100k-event soak
  test.
- Add `tui --replay <events.jsonl> [--once]` for recorded streams with every write action
  disabled, using the stub e2e event logs plus a checked-in approval-gate fixture.
- Document the UI (`docs/tui.md`, a README section, the `docs/cli.md` entry, `--help`), record
  ADR-0047 (Ink, lazy bundle, detached children, phase-driven overlay, additive event, replay)
  and the `docs/events.md` entry, and add the replay smoke to the Node 20.3/22/24 CI job.

## Capabilities

### New Capabilities

- `factory-tui`: the `tui` command, its data flow (stream plus read API), the detached-child
  launcher, the run list and run view, the intake dialog, the phase-driven approval overlay, the
  question/abort/retry/resume controls, layout and accessibility, brand tokens, bounded rendering,
  replay/`--once`, its tests and its documentation.

### Modified Capabilities

- `typed-event-stream`: one additive event type, `approval.pending`, emitted when design parks a
  change at `awaiting-approval`; `reduce` carries it as `pendingApproval`. No version bump, no
  change to `approval.requested`/`approval.granted`, no new reader semantics.
- `monorepo-layout`: a fourth private workspace `packages/tui`, an extended dependency rule that
  lets `cli` import `tui` while `tui` stays off `cli`, and a second build entry `dist/tui.js` in the
  build, the tarball baseline and the Node smoke matrix.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** a new private workspace and package export (`@loomwright/tui`); one new CLI command
  (`tui`) with `--replay`, `--once` and `--ascii`; the private protocol union gains one event type
  and the snapshot gains one nullable field. Every existing command's stdout, stderr and exit
  codes stay unchanged; `status --watch` and `events` keep working as they are.
- **Contracts:** none configured. No external API, event bus or Helm value changes.
- **Data:** no `.factory/` state-schema change and no migration. Runs started from the TUI write
  their child output to `.factory/logs/tui-spawn-<ts>.log`; the existing event log, run state,
  queue and command inbox are used as they are. Older event logs without `approval.pending` replay
  as before (the overlay simply has no hash to show).
- **Package:** `package/dist/tui.js` joins the tarball baseline; the size delta is recorded and
  justified in the final report.
- **Protected files:** none edited. `openspec/specs/**` is updated by this change's deltas on
  archive; `factory.config.jsonc`, `factory.lock.json`, `.opencode/**`, `AGENTS.md` and
  `factory-records/**` need no edit. The final report names any that turn out to be needed.

## Follow-ups (not in this change)

- A web UI, a daemon or server, remote nodes, mouse support, themes, config editing, running
  `refine`'s interview inside the TUI, editing `.factory/requests/`, the `quick`, `land` and
  `update` commands, new commands beyond `tui`, pipeline changes, dependency upgrades and renames.
- Exposing `Factory.pause` as a TUI control (the command API keeps it; the UI does not), and
  renaming the `monorepo-layout` requirement whose header still says "three packages" (a
  `REMOVED` + `ADDED` pair, not a `MODIFIED` delta).
- A run-state marker for "the spec was edited after approval", which would let the overlay offer
  `R` without an existing approval.
