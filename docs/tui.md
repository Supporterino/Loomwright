# The terminal UI

`loomwright tui` watches and drives runs from one terminal. It reads the stored event stream
(`.factory/events/<id>.jsonl`) and the read API (run state, status and the usage ledger) and renders
what they say; it never reimplements pipeline rules. Every long action that changes a run — intake,
approve, reword, reapprove, resume, abort, retry — is launched as a detached CLI child with its
output in a log under `.factory/logs/`. Quitting the UI, closing the terminal or crashing it leaves
the run exactly as it would be without the UI, and reopening finds it again. An answer is written
straight into the run's command inbox and applied at the run's next safe point.

## Opening it

```
loomwright tui
loomwright -C <dir> tui
```

`-C` selects the workspace exactly as it does for every other command. The UI needs a terminal:
without a TTY and without `--replay` it prints a hint naming `loomwright status <id> --watch` and
`loomwright events <id> --follow`, and exits 1. Listing and opening runs needs no install marker;
starting a new change needs an initialised workspace, and the dialog says to run `loomwright init`
when it is missing.

## The run list

The list is newest first. Each row carries the change id and summary, the phase, the role, the
token count, the cost and the elapsed time. The role is `active (pid <n>)` for the driver that holds
the lock, `queued #<n>` for a change waiting its turn, and `idle` otherwise. With no runs it says
`No changes exist yet. Press n to start one.`

## The run view

The header repeats the phase glyph and label, id, elapsed time, tokens, cost and role. The task
graph follows `tasks.md` order and shows each task's status glyph and label, repo and attempt.
Selecting a task (or drilling into it with `Enter` below 100 columns) shows the task detail: agent
role and model, retries, every gate with its step, status and duration, and the activity tail. An
activity line names its `.factory/logs/` file when the event carries one. At `awaiting-approval` the
header carries the approval banner and the overlay opens over the run (see [Approving](#approving)).

## Layout

The UI renders at 80×24 and larger. At 100 columns and wider it uses two panes — the run list or the
task graph on the left, the detail and activity on the right. Below 100 columns it is one pane:
`Enter` drills from the list into the run, and from the task graph into the task detail.

## Keys

| Key       | Action                                                        | When                                                 |
| --------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| `n`       | Start a new change (text or request file)                     | Run list                                             |
| `Tab`     | Toggle text mode and file mode                                | New-run dialog                                       |
| `Enter`   | Open the selected run or task; confirm                        | List, task graph, a confirmation                     |
| `Esc`     | Back out of a panel; cancel                                   | Panels and confirmations                             |
| `j` / `k` | Move the selection (arrow keys work too)                      | List, task graph, questions                          |
| `a`       | Approve and run: record the approval and start implementation | Approval overlay, with `git user.email`              |
| `A`       | Approve only: record the approval, implement nothing          | Approval overlay, with `git user.email`              |
| `w`       | Reword: let the architect apply the spec findings             | Approval overlay, when the run has findings          |
| `R`       | Reapprove: accept a hand-edited spec                          | Approval overlay, after an approval recorded         |
| `r`       | Resume a paused, aborted or queued run                        | Paused/aborted/queued run, and the approve-only wait |
| `x`       | Abort, after a confirmation                                   | Any run not done or aborted                          |
| `t`       | Retry the selected failed task                                | Only when the selected task is failed                |
| `Q`       | Open the questions pane                                       | Only when the run has questions                      |
| `?`       | Help                                                          | Everywhere                                           |
| `q`       | Quit                                                          | Everywhere                                           |

The approval keys are conditional: the overlay only exists at `awaiting-approval`, and `w`/`R` only
appear when they apply. `t` appears only for a failed task and `Q` only when questions exist. The
footer lists the keys valid in the current state with the same labels; both the footer and this
table name the keys above.

## Starting a change

`n` opens the intake dialog. `Tab` switches between the two modes:
- **Text.** Type the request. `Ctrl-J` inserts a newline and `Enter` starts it. A blank or
  whitespace-only request is refused with `the request is empty` and starts nothing.
- **File.** Type a path; completion lists matches. The panel shows the resolved path, the byte size
  and a preview of the first 20 lines, trimmed to what the terminal has room for with the shown count
  named. A missing path, a directory, a non-regular file, an unreadable file and an empty file are
  each refused with the reason and start nothing.

Starting launches `loomwright run` as a detached child (`--no-interactive`) from the current
workspace. The dialog shows the spawn log path (`.factory/logs/tui-spawn-*.log`) and its last lines.
If another change is active it says the change is drafted under `.factory/drafts/<id>` and queued
after approval. A non-zero exit shows `exited with code <n>` with the log tail and leaves the dialog
open so the request can be corrected and retried.

## Approving

The approval overlay is driven by the phase, not by a keystroke: a run at `awaiting-approval` opens
it on its own. Four actions are available, each behind a confirmation:
- `a` **approve and run** records the approval, commits the spec and starts implementation locally.
- `A` **approve only** records the approval and implements nothing; the waiting state then shows the
  `r` resume hint and the equivalent CLI command. `r` launches `resume <id>` through the same
  launcher seam, and it stays offered on the `queued` run after the overlay closes, so approving
  only never strands a run in the UI.
- `w` **reword** starts the architect to apply the spec findings; it is offered only when findings
  exist and may take long.
- `R` **reapprove** accepts a spec edited after approval, naming the short spec commit.

Approving (`a`, `A`, `R`) requires `git user.email`. Without it the overlay shows exactly
`git user.email is not set; it records who approved` and the actions stay unavailable. `Enter` or
`y` confirms, `Esc` or `n` cancels. While the child runs, the overlay is read-only and waits for the
phase to move (`approve` for `queued`/`implementing`, `approve only` for `queued`, `reword` for
`design`/`awaiting-approval`, `reapprove` for `awaiting-approval`/`queued`) and, where the action
records one, for `approval.granted`. A non-zero exit shows the code and the log tail and makes the
overlay actionable again.

## Questions and answers

`Q` opens the questions pane when the run has any. Its first line is the run's questions file
(`openspec/changes/<id>/questions.md`); each record shows the step, the question and its status.
Selecting an unanswered record opens a draft; `Enter` records the answer in the run's command inbox
and `Esc` closes the pane.

The UI is honest about what that means. After recording, the record reads exactly
`recorded — applies at the next step` until the run emits its `question.answered` event; only then
does it read `answered` (with the answer). The UI never claims the answer was applied, because the
run consumes it at its next safe point. The run is not asked on the TUI's stdin, so answers typed
here are the ones that get recorded.

## Flags

```
loomwright tui [--replay <file>] [--once] [--ascii]
```

- `--replay <file>` renders a recorded JSONL event stream instead of a workspace.
- `--once` renders exactly one frame, prints it and exits; it requires `--replay`.
- `--ascii` forces the ASCII glyph set.

Exit codes: `0` ok; `1` no TTY and no `--replay`; `2` invalid flags, `--once` without `--replay`,
or an unreadable `--replay` file.

## Accessibility

Every state carries a glyph and a label, never colour alone. `NO_COLOR` disables colour while the
glyphs and labels stay. `--ascii` forces the printable ASCII glyph set, as do `TERM=dumb` and a
locale that is not UTF-8. Input is keyboard only; no mouse handling is added. Nothing paints a
background. Lilac (`#8E9BEA`) marks focus and running; coral (`#E0714F`) appears only at the
approval gate, and failed, blocked and passed are told apart by glyph, label and weight.

## Replay

`--replay` renders a recorded stream through the same tree and view-model as a live run, without a
workspace. It is read-only: intake, approve, reword, reapprove, resume, abort, retry and answer are
disabled, no status poll starts and no child is spawned; pressing a write key says the stream is
replayed and read-only. `--once` renders that one frame into stdout with no cursor-control
sequences and exits 0, which is what CI runs. A replay is not a workspace: it reads the file, writes
nothing and changes nothing in `.factory/`.

## Not in this release

There is no daemon, no web UI and no browser UI, and remote nodes are not addressable. Mouse
input is ignored, themes are fixed to the brand tokens, and the run state's `pause` control is not
exposed in the UI.
