# 0048 — TUI scroll, scoped log and reword

## Context

A long run list pushed the frame off the screen: every row was rendered and the terminal scrolled,
so the footer and the top rows were lost. The activity tail filtered a task's lines by task id, so
reviewer, tester and full-suite lines did not appear under the task that caused them. The tail had
no full-height view and the single-pane layout could squeeze it to zero rows. Spec findings were
invisible in the terminal UI, and the only reword key lived on the approval overlay — the one screen
where the CLI refuses it. The restyle also needed one place for the findings that stop a run,
without turning the approval gate into a general-purpose action panel.

## Decision

- Scroll is view state. One pure viewport module owns clamp, window, page and follow; the run list,
  task graph, questions and log carry an offset in the view-model and the views slice. Ink 6.4.0
  does no `height`/`overflowY` scrolling and React 19.3.1 sees the same tree at every size; no mouse
  handling is added.
- One scope derivation. A step maps to a task, a repo or the run from the run state's task table
  (`review:<repo>`, `explore:<repo>`, a repo-named full-suite gate), so a task detail is its own
  lines plus its repo's. The mapping lives in one module and is tested; no additive event field.
- The log is a destination. `L` opens a full-height read-only pane in the current scope, `Tab` cycles
  run → task → repo and `f` toggles follow. The overview keeps a four-row tail floor and the task
  graph gives up rows first.
- Findings are view-model state from the read API (`specFindings`, `pausedReason`). `w` opens a
  reword panel from the run view for the phases the CLI accepts, with the findings read-only, a
  multi-line prompt and a confirm naming the exact argv: `reword <id>` without a prompt or
  `reword <id> --prompt <text>` with one, the prompt as one argv element.
- The approval overlay collapses to its coral banner at `idle`/`failed`; `Esc` is inert while an
  action is in flight and the gate no longer offers `w`.

## Consequences

- Every region is bounded and testable without a terminal: a 60-run list and a 12-task run fit in
  24 rows, and the footer is the last line.
- A rename of a step name breaks one scope test rather than several views, and the contract session
  stays run-scoped because it is cross-repo.
- An unapproved paused run can still show `w`; the child reports the refusal in the log tail and the
  panel stays actionable.
- The log pane and the overview share the same line shape and fold, so a replay and a live run print
  identical lines.
- No new event field was added; a scope outside the run state's task table would need a protocol
  change, and the fixtures record the current mapping.
- The frame fixtures churn as the visual record, and a re-record is part of the change that moves
  them.
