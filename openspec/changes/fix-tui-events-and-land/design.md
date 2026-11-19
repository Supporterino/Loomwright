# Design — fix-tui-events-and-land

## Context

The event log already records every phase: `packages/core/src/events/jsonl.ts` writes every
event, and `packages/tui/src/entry.tsx` already tails it phase-agnostically through
`factory.events(id, { fromSeq, follow })`. The loss happens one layer later.
`packages/tui/src/model/facts.ts::appendFacts` folds only `gate.finished`, `agent.started`,
`agent.finished`, `agent.retry`, `task.retried` and `agent.activity`; everything else falls into
`default: break`. The views then render whatever the fold kept, so design, approval, install,
merge and closing events never reach the screen. The one-pane layout compounds it by showing only
the task graph.

Land exists as `packages/core/src/pipeline/land.ts::landChange` behind
`packages/cli/src/commands/land.ts::landCommand` (`land <id> [--dry-run] [--json]`). Its
preconditions are `phase === "done"`, no other active driver and clean worktrees; it merges
locally and never pushes. The TUI has no land action, no launcher argv for it and no way to
finish a run from the surface that shows it.

## Decisions

### Fold every event in the existing facts layer

Extend `appendFacts` with a total mapping from `RunEvent` to an `ActivityLine`: source is the
task id or step where the event names one and `run` otherwise; kind names the event family
(`phase`, `task`, `gate`, `install`, `agent`, `question`, `approval`, `usage`, `log`, `run`);
text is the event's own readable content (reasons, statuses, counts, durations, progress text).
The `ActivityLine` shape and the 2,000-line `ActivityRing` stay as they are apart from an
append-or-replace push for heartbeats, so the view-model, task detail filter and rendering need no
new data model.

- Rejected: a second event buffer rendered by a new view. Two projections to keep bounded and in
  sync, and replay would need a second fold.
- Rejected: tailing a run's `.factory/logs/<id>/` session log. The TUI spec deliberately limits
  `.factory/` reads to the spawn log and request files; the event stream carries the same lines
  and a `TruncationRef` for anything capped, so the tail shows the path without opening it.

### Coalesce heartbeats instead of queueing them

`heartbeat` fires once per interval with a pre-rendered line. Pushing each one would evict real
work from the ring during a long agent run. When the newest line is a heartbeat the fold replaces
it in place (an O(1) `ActivityRing` append-or-replace); a heartbeat after other work adds one
line, and the next heartbeat replaces that. The tail therefore answers "is it alive, what is it
doing" with at most one heartbeat line between bursts of work.

### Show the run tail in the single-pane layout

At 80 columns `RunView` currently renders only the task graph when no task is selected, which is
an empty screen in design. Render the graph followed by the run-level tail (sized to the rows
left); a selected task still replaces both with its detail. At 100 columns and wider the existing
side-by-side tail already works once the fold is complete.

### Land through the launcher, for `done` runs only, behind a confirmation

Add `{ kind: "land", id }` to `LaunchAction` with argv `["land", id]`, plus a `land` control action
and a `landFor(viewModel)` predicate gated on `phase === "done"` (the shortest reading that
matches `landChange`'s precondition and cannot start a doomed child). Confirmation mirrors abort:
`Enter`/`y` confirms, `Esc`/`n` cancels, and the panel names the local merges, the cleanup and
that nothing is pushed. `performControl` launches the child; a per-run guard (the resume guard
pattern) makes a double `l` launch one child. Exit `0` refreshes `status()`/`listRuns()` and
returns to the list when the run state is gone; a non-zero exit reuses the existing
`tailLog` notice with the code and last ten lines. Replay adds `l` to `REPLAY_WRITE_KEYS`.

- Rejected: calling `landChange` in-process. It would block the UI, break the "never drive long
  work in-process" rule and need a new `Factory` method that the import scan does not expect.
- Rejected: a `--dry-run` step or a land picker. Not requested; the CLI still offers `--dry-run`,
  and the confirmation is the safety step.
- Rejected: adding a protocol event for land. Land is a CLI command, not a pipeline phase; the
  spawn log and the refreshed run list carry the evidence.

### No contract or protocol change

The protocol union, `Factory` and the CLI command table are untouched. The only new argv element
is the existing `land` command, so consumers and the CLI help do not change.

## Risks

- The two clarification questions were left unanswered. This change assumes land is offered only
  for `done` runs (the only phase `landChange` accepts) and that it requires an explicit
  confirmation. If the answer is "land at any time", the CLI must change first; if it is "no
  confirmation", only the confirmation panel drops.
- Folding every event into a 2,000-line ring means a chatty phase can evict older task lines
  faster than before. The cap is unchanged and heartbeats are coalesced; the trade-off is
  deliberate because the tail is a live view, not the record.
- The single-pane tail takes rows from the task graph. Frame fixtures must be regenerated and the
  layout tests re-read at 80×24.
- Adding a state or a key changes the checked-in frame snapshots and the help/keys documentation;
  the tasks keep the regeneration explicit (`UPDATE_FRAMES=1`).
- `packages/tui` changes need `bun run build` for `packages/cli/dist/tui.js`; the bundle is
  generated and ignored, so the build is verified by the gate and the review, not committed.
- The activity text mapping is a UI concern only; the event log and `docs/events.md` payloads do
  not change.

## Open questions

- Should land be offered only after `done` (assumed) or for any phase, which would require relaxing
  `landChange`?
- Should land require the confirmation described here (assumed) or run straight from the key?
