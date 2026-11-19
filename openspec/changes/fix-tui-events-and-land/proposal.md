## Why

The TUI's run view is fed by a fold that only keeps `gate.finished`, `agent.*` and
`task.retried`, so everything a run does outside a task phase — design, approval, installs,
merges, closing, progress lines and heartbeats — never reaches the screen. The event log already
carries all of it; only the client-side projection drops it. Separately, a finished change can
only be landed from the CLI, so the one surface that shows the run cannot finish it.

## What Changes

- Fold every protocol event type into the activity facts, whatever the phase: `run.*`,
  `phase.changed`, `task.*`, `gate.started`/`gate.planned`/`gate.report`, `install.*`,
  `question.*`, `approval.*`, `usage.delta`, `progress.line` and `heartbeat`, not just a task
  phase's `agent.activity`.
- Name the `.factory/logs/` reference carried by any event (`ref` or `gate.finished.outputRef`)
  on its activity line, and coalesce repeated `heartbeat` events into one line.
- Show the run-level activity tail at every width: beside the graph when two panes fit, and
  below the graph in the single-pane layout, so design, install and closing activity is visible
  at 80 columns too.
- Add `l` land for a `done` run: a confirmation, then the detached `land <id>` child through the
  existing launcher seam, with the exit outcome surfaced like resume.
- Disable land in replay with the other write keys and document the new key and tail in
  `docs/tui.md`, `docs/cli.md`, `README.md` and ADR-0047.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-tui`: the activity tail covers every event and phase, the land control joins the
  run controls, and the key, replay, bounds, test and documentation requirements grow to match.

## Impact

- Repos: `loomwright` only (`packages/tui`, its tests and frame fixtures; docs). The CLI command
  table, core pipeline and protocol are unchanged.
- APIs and contracts: no protocol or contract change — `land` already exists in the CLI and the
  TUI reaches it through the launcher. `Factory` gains no method and no `.factory/` file is read.
- Data: land merges the change branches into their local base branches and removes worktrees,
  branches and run state, exactly as `loomwright land` does; nothing is pushed.
- Build: `bun run build` rebuilds `packages/cli/dist/tui.js`; the change needs a changeset.
