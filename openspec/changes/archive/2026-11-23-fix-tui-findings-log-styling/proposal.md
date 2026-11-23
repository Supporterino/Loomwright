# Fix TUI findings, task logs and the visual pass

## Why

The terminal UI hides the two things a user has to act on: a run that paused on spec findings only
ever reads `paused`, and the only key that starts a reword lives on the approval overlay — the one
screen where the CLI refuses it. A task's log is filtered by task id alone, so the reviewer, tester
and full-suite lines that belong to a task are missing from its detail and exist only in a run-level
tail that long task lists and gate lists can squeeze to zero rows, with no way to scroll it. The
remaining defects compound those: the frame drifts out of position once a list overflows, the
questions pane makes answering and navigating mutually exclusive, and the screen reads as
unformatted text.
The defects were reported against the released `@loomwright/cli` 1.2.0; the parts `main` has already
improved (the single-pane activity tail and the `land` action) are kept and not re-fixed.

## What Changes

- **Findings are first-class run state.** `RunDetail` carries the run's `specFindings` and
  `pausedReason`; the run list shows `<n> findings`, the run view banner says `paused — 2 spec
  findings need reword`, and a findings panel lists every finding with severity, `file:line`,
  problem and fix, in the same 1-based order as `reword --finding`.
- **Reword is offered where the CLI accepts it.** `w` opens a reword panel from the run view for an
  approved, non-done, idle run, with the findings read-only and a multi-line prompt (`Ctrl-J`,
  `Enter`, `Esc`); the confirm names the exact argv and spawns `reword <id>` or
  `reword <id> --prompt <text>` as one argv element. A driven run shows the CLI's reason instead.
  The gate overlay stops offering `w`, because the CLI never accepts it there.
- **Task scope is derived, not guessed.** One pure function maps a step to a task, a repo or the run,
  so a task's detail carries its own lines, the other tasks in its repo (the tester), `review:<repo>`,
  `explore:<repo>` and the repo-named full-suite gates, each keeping its step label.
- **The log becomes a destination.** `L` opens a full-height read-only activity pane; `Tab` cycles
  run → task → repo; `j`/`k`, `PgUp`/`PgDn`, `g`/`G` scroll and `f` toggles follow. The overview
  keeps a four-row floor instead of losing its tail to the graph.
- **Row budgets and pure scroll offsets** for the run list, task graph, questions and log, so the
  frame never exceeds `rows`, the footer is always last and the selection is always visible.
- **Questions stop being a one-time fork.** `Enter` opens a composer, `Enter` records and advances
  to the next unanswered record, `Ctrl-J` inserts a newline, `Esc` leaves the composer then closes,
  and the pane scrolls.
- **The gate overlay collapses** to its coral banner at `idle`/`failed`; `a`/`A`/`R` reopen it and
  `Esc` stays inert (with the reason in the footer) while confirming, launching or waiting.
- **A styling pass on the existing tokens**: bold titles, aligned facts and gates, muted metadata,
  padding, a selected-row emphasis, and the summary on the run list row — no new colour, no
  background, no new dependency.
- `docs/tui.md`, an ADR, a `factory-tui` spec delta and a changeset; the fix ships in
  `@loomwright/cli` 1.3.0.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-tui`: findings and the reword flow, derived task activity scope, the scoped full-height
  log pane, row budgets and scroll offsets, the questions flow, the collapsed approval banner, the
  styling rules, the documented keys, and the tests and snapshots that pin them.

## Impact

- **Repo:** `loomwright` only — `packages/tui/src`, `packages/tui/test`, `packages/tui/test/fixtures`,
  `docs/tui.md`, `docs/decisions/` and one `.changeset` entry.
- **APIs, contracts, events, commands, flags:** none. No new event type, no new command, no CLI
  behaviour change and no new flag; the only argv addition is the existing
  `reword --prompt <text>`. No protocol field is added.
- **Data:** none. The TUI stays read-only over `.factory/` and keeps its existing two permitted
  reads; nothing is migrated.
- **Dependencies:** none; Ink stays at its pinned 6.4.
- **Release:** `@loomwright/cli` 1.3.0 (the pending minor changeset already makes this the next
  minor after 1.2.0), named in the changeset this change adds.
