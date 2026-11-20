# The terminal UI

`loomwright tui` watches and drives runs from one terminal. It reads the stored event stream
(`.factory/events/<id>.jsonl`) and the read API (run state, status and the usage ledger) and renders
what they say; it never reimplements pipeline rules. The long actions — intake, approve, approve
only, reword, reapprove, resume and land — are launched as detached CLI children with their output
in a log under `.factory/logs/`. Reword is started from the run view, not the approval overlay, and
its prompt travels as one argv element. The short writes are made in-process: answer, abort and retry
return after recording into the run's state, so an answer goes into the run's command inbox and
applies at the run's next safe point, and abort and retry never wait for a pipeline phase. Quitting
the UI, closing the terminal or crashing it leaves the run exactly as it would be without the UI,
and reopening finds it again.

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

The list is newest first and windowed: when it outgrows the pane the title names the visible slice
(`runs 1-9/60`), and `j`/`k`, the arrow keys, `PgUp`/`PgDn` and `g`/`G` move the selection without
scrolling the terminal. Each row carries the change id and summary, the phase, the role, the
token count, the cost and the elapsed time; a run with spec findings carries the count after the id
and summary (`2 findings`). The role is `active (pid <n>)` for the driver that holds
the lock, `queued #<n>` for a change waiting its turn, and `idle` otherwise. With no runs it says
`No changes exist yet. Press n to start one.`

## The run view

The header repeats the phase glyph and label, id, elapsed time, tokens, cost and role. The view adds
one column of left padding and titles its two sections `Tasks` and `Activity`. The task graph follows
`tasks.md` order and shows each task's status glyph and label, repo and attempt.
Selecting a task (or drilling into it with `Enter` below 100 columns) shows the task detail: agent
role and model, retries, the gates that fit with their step, status and duration, and the task's
activity. When more gates exist than the terminal has rows, the list ends with an `N more gates` row
so the activity tail and footer keep their rows.

The activity tail is folded from every run event, not just an agent's tool lines: design, approval,
installs, merges, closing, progress and heartbeats all land there. Each line reads
`source • kind • text`; a line whose event names a `.factory/logs/` file shows that reference
after the arrow, and the UI never opens the file. Heartbeats coalesce into one line in place, so a
quiet run does not fill the tail. The overview keeps a four-row floor for the tail: when the tail
needs more rows the task graph gives them up and scrolls instead, so the log is never squeezed to
zero. A run paused on spec findings says `paused — 2 spec findings need reword` under the header, in
words as well as the phase glyph. At `awaiting-approval` the header carries the approval banner and
the overlay opens over the run (see [Approving](#approving)).

## Findings and reword

`w` is offered from the run view when the CLI accepts a reword: an approved, non-done, idle run in
`queued`, `implementing`, `reviewing`, `contracts`, `full-suite`, `closing`, `paused` or `aborted`.
`design`, `awaiting-approval` and `done` offer no `w`.

The panel lists every spec finding 1-based, in the same order `reword --finding <n>` uses, with its
severity, `file:line` when known, problem and fix. The findings are read-only. The prompt is optional
when findings exist and required when there are none; its confirm is unavailable until it is
non-empty. `Ctrl-J` inserts a newline, `Enter` confirms and `Esc` backs out. The confirm line shows
the argv template `reword <id> --prompt <text>` with the typed prompt substituted; confirming with
an empty prompt launches `reword <id>`, and the prompt travels as one argv element.

Confirming launches the reword child detached through the same launcher and logs it under
`.factory/logs/`; a non-zero exit shows the exit code and the log tail in the panel and leaves it
actionable again. A run whose driver is alive shows `w` inert with the CLI's reason naming the pid
(`<id> is being driven by pid <n>; stop it first`), and another change holding the lock is named
instead (`<other> is the active change; finish or abort it before rewording <id>`). A footer too
narrow for the reason clips it to the room the enabled keys leave, so `q` and `?` stay visible;
pressing `w` shows the full reason as a notice.

## The activity log

`L` opens a full-height read-only pane over the current view, in the current scope. `Tab` cycles run
→ task → repo, skipping a scope the run cannot name; `j`/`k` and the arrows move a line,
`PgUp`/`PgDn` page, `g`/`G` jump to the ends and `f` toggles follow (on by default). `Esc` returns to
the view. The pane works the same in replay and writes nothing.

A task's scope is the union of its own lines and its repo's: reviewer, tester and full-suite lines
stay visible because they belong to the repo, and `review:<repo>` and `explore:<repo>` map to that
repo, as does a full-suite gate named after it. Each line keeps its own step label. The contract
review is cross-repo and stays run-scoped.

## Layout

The UI renders at 80×24 and larger. Every region that can grow carries a row budget and a scroll
offset; the frame never exceeds `rows` lines and the footer is always its last row. At 100 columns
and wider it uses two panes — the run list or the task graph on the left, the detail and the
run-level activity tail on the right. Below 100 columns it is one pane: the run view shows the task
graph followed by the run-level activity tail, sized to the rows left, and drilling into a task
replaces both with its detail. The two-pane list preview and the task graph are windowed, not
scrolled by Ink. `Enter` drills from the list into the run, and from the task graph into the task
detail; `Esc` backs out of the detail to the graph, then out of the run to the list.

## Keys

| Key             | Action                                                                                  | When                                                   |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `n`             | Start a new change (text or request file)                                               | Run list                                               |
| `Tab`           | Toggle text mode and file mode                                                          | New-run dialog                                         |
| `Tab`           | Cycle the log scope run → task → repo                                                   | Activity log                                           |
| `Enter`         | Open the selected run or task; confirm; open the answer composer; record                | List, task graph, confirmations, questions             |
| `Esc`           | Back out of a panel or the task detail; cancel; collapse the gate overlay to the banner | Panels, confirmations, `idle`/`failed` gate            |
| `j` / `k`       | Move the selection or scroll                                                            | List, task graph, questions, activity log              |
| `PgUp` / `PgDn` | Page the selection or the log                                                           | List, task graph, activity log                         |
| `g` / `G`       | Jump to the first or last row                                                           | List, task graph, activity log                         |
| `f`             | Toggle follow in the log                                                                | Activity log                                           |
| `a`             | Approve and run: record the approval and start implementation                           | Gate overlay or its banner, with `git user.email`      |
| `A`             | Approve only: record the approval, implement nothing                                    | Gate overlay or its banner, with `git user.email`      |
| `w`             | Reword: let the architect apply the spec findings, or use a prompt                      | Run view, when the CLI accepts a reword                |
| `R`             | Reapprove: accept a hand-edited spec                                                    | Gate overlay or its banner, after an approval recorded |
| `r`             | Resume a paused, aborted or queued run                                                  | Paused/aborted/queued run, and the approve-only wait   |
| `x`             | Abort, after a confirmation                                                             | Any run not done or aborted                            |
| `t`             | Retry the selected failed task                                                          | Only when the selected task is failed                  |
| `l`             | Land: merge the change branches into their base branches locally                        | A `done` run                                           |
| `L`             | Open the activity log in the current scope                                              | Run view                                               |
| `Q`             | Open the questions pane                                                                 | Only when the run has questions                        |
| `Ctrl-J`        | Insert a newline                                                                        | Intake text, answer composer, reword prompt            |
| `?`             | Help                                                                                    | Everywhere                                             |
| `q`             | Quit                                                                                    | Run list, run view, help and the approval overlay      |

The approval keys are conditional: `a`, `A` and `R` act on the overlay or its collapsed banner, and
`R` only appears after an approval was recorded. `w` appears only when the CLI accepts a reword, `t`
only for a failed task, `Q` only when questions exist, and `l` only for a `done` run. The footer
lists the keys valid in the current state with the same labels; both the footer and this table name
the keys above.

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
it on its own. Three actions are available, each behind a confirmation:
- `a` **approve and run** records the approval, commits the spec and starts implementation locally.
- `A` **approve only** records the approval and implements nothing; the waiting state then shows the
  `r` resume hint and the equivalent CLI command. `r` launches `resume <id>` through the same
  launcher seam, and it stays offered on the `queued` run after the overlay closes, so approving
  only never strands a run in the UI.
- `R` **reapprove** accepts a spec edited after approval, naming the short spec commit.

`Esc` at `idle` or `failed` collapses the overlay to the coral banner under the header, which names
`a approve and run`, `A approve only` and `R reapprove`; pressing one of those keys reopens the
overlay without acting, and the next press confirms. `Esc` is inert while the overlay is confirming,
launching or waiting, and the footer says so; `n` cancels a confirmation.

Approving (`a`, `A`, `R`) requires `git user.email`. Without it the overlay shows exactly
`git user.email is not set; it records who approved` and the actions stay unavailable. `Enter` or
`y` confirms, `n` cancels. While the child runs, the overlay is read-only and waits for the
phase to move (`approve` for `queued`/`implementing`, `approve only` for `queued`, `reapprove` for
`awaiting-approval`/`queued`) and, where the action records one, for `approval.granted`. A non-zero
exit shows the code and the log tail and makes the overlay actionable again.

## Landing

`l` lands a `done` run. It opens a confirmation naming the change id, that the change branches are
merged into their base branches locally, that those branches are deleted once merged, and that the
run's worktrees and run state are removed; it also states that nothing is pushed. `Enter` or `y`
confirms into one detached `loomwright land <id>` child through the same launcher as the other long
actions, and `Esc` or `n` cancels.

A failed land shows the exit code and the spawn log tail and leaves the run selected with its
branches intact. On success the run leaves the screen and the list comes back with a notice. The
`--dry-run` flag stays a CLI flag and is not offered in the UI; see [docs/cli.md](cli.md#land).

## Questions and answers

`Q` opens the questions pane when the run has any. Its first line is the run's questions file
(`openspec/changes/<id>/questions.md`); each record shows the step, the question and its status, and
a long list scrolls. `Enter` on an unanswered record opens the composer: printable keys (including
`j` and `k`) type, `Ctrl-J` inserts a newline, backspace deletes, `Enter` records and `Esc` discards
the draft and returns to the records without closing the pane; a second `Esc` closes it. Recording
keeps the pane open and advances to the next unanswered record. An empty answer is refused with
`the answer is empty` and records nothing.

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

Every state carries a glyph and a label, never colour alone. Titles are bold, metadata is muted,
gate names, statuses and durations sit in aligned columns and the task facts form a two-column
block. Lilac (`#8E9BEA`) marks focus and running; coral (`#E0714F`) appears only at the approval
gate. Nothing paints a background and no colour is written outside the token module; failed, blocked
and passed are told apart by glyph, label and weight. The selected row still reads without colour
because its focus marker and bold carry it.

`NO_COLOR` disables colour while the glyphs and labels stay. `--ascii` forces the printable ASCII
glyph set, as do `TERM=dumb` and a locale that is not UTF-8. Input is keyboard only; no mouse
handling is added.

## Replay

`--replay` renders a recorded stream through the same tree and view-model as a live run, without a
workspace. It is read-only: intake, approve, reword, reapprove, resume, abort, retry, answer and land
are disabled, no status poll starts and no child is spawned; pressing a write key says the stream is
replayed and read-only. The activity log opens and scrolls in replay too — `L`, `Tab`, `f`, `j`/`k`
and `g`/`G` move through the recorded lines — and nothing is launched or written. `--once` renders
that one frame into stdout with no cursor-control sequences and exits 0, which is what CI runs. A
replay is not a workspace: it reads the file, writes nothing and changes nothing in `.factory/`.

## Not in this release

There is no daemon, no web UI and no browser UI, and remote nodes are not addressable. Mouse
input is ignored, themes are fixed to the brand tokens, and the run state's `pause` control is not
exposed in the UI. Log search, filter and copy, per-finding `--finding` selection and editing
findings are follow-ups.
