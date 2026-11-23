# factory-tui

## MODIFIED Requirements

### Requirement: The run list and run view show the whole run

The TUI SHALL show a run list ordered newest first with each run's id, summary, phase, role (active,
queued at its position, or idle), token and cost totals, elapsed time and the number of recorded spec
findings when there are any. Opening a run SHALL show a header with the run id, phase, elapsed time,
token and cost totals and lock status; a task list in the order the run state carries (the
`tasks.md` plan order, not re-sorted by `deps`) with each task's status, repo, attempt and title; a
task detail pane with the agent role, model, retries, gate results per step, duration and the
activity scoped to that task; and a footer listing the keys that are valid in the current state. The
rendered frame SHALL never be taller than the terminal's rows.

The activity tail SHALL be built from every run event, whatever the phase and whether or not a task
is running. Every event type the protocol defines SHALL fold into an activity line, except that
repeated `heartbeat` events update the newest heartbeat line in place instead of adding a line each,
so the tail carries at most one heartbeat line between bursts of work. Each line SHALL carry a source
label — the task id, the install repo or the step when the event names one, and `run` otherwise — a
kind label naming the event family — except `agent.activity`, whose kind is the activity kind it
carries (`tool`, `step-done`, …) — and readable text. A line whose event carries a truncation
reference (`ref`, or `gate.finished.outputRef`) SHALL name that `.factory/logs/` path. `run.*`,
`phase.changed`, `task.*`, `gate.*`, `agent.*`, `install.*`, `question.*`, `approval.*`,
`usage.delta`, `progress.line` and `heartbeat` SHALL therefore be visible in the run view, not only
the agent activity of a task phase.

The task detail's activity SHALL be derived from the run's task table and the emitted step, as
defined by "Activity is scoped to the task it belongs to"; it SHALL NOT filter by task id alone. The
overview's compact tail SHALL keep a floor of four rows; when the terminal is too short, the task
graph SHALL scroll instead of taking the tail's floor away.

At 100 columns and wider the run view SHALL show the run-level tail beside the task graph when no task
is selected. Below 100 columns it SHALL show the task graph followed by the run-level tail, sized to
the rows left; a selected task's detail SHALL replace both.

#### Scenario: design and install activity is visible

- **WHEN** a run in `design` emits `run.started`, `phase.changed`, `install.started`,
  `install.finished` and `progress.line` and has no tasks yet
- **THEN** the run view lists a line for each, labelled with `run` or the install repo
- **AND** the design-phase activity is visible at 80 columns as well as 120

#### Scenario: every event type is folded

- **WHEN** one event of every type in `EVENT_TYPES` is collected into the facts
- **THEN** each non-heartbeat type has at least one activity line
- **AND** all consecutive heartbeats share one heartbeat line whose text is the newest one
- **AND** no event type is silently dropped

#### Scenario: a log reference is named

- **WHEN** a `progress.line`, `install.finished` or `gate.finished` event carries `ref.path` or
  `outputRef.path` for `.factory/logs/add-health/2026-11-19.jsonl`
- **THEN** that line names the same path after the arrow glyph
- **AND** the TUI does not open or read the referenced file

#### Scenario: the task detail stays task-scoped

- **WHEN** a run has a task `first` in repo `app`, a reviewer step `review:app`, a full-suite gate
  whose step is `app`, a second task `second` in repo `app`, another task in repo `api` and
  run-level lines
- **THEN** the detail for `first` lists the `first` lines, the `review:app` lines, the `app` gate
  lines and the `second` lines, each still labelled with its own step
- **AND** the `api` lines and the run-level lines stay out of that detail
- **AND** the run-level tail still carries the run lines and every repo's lines

#### Scenario: a task detail shows the evidence

- **WHEN** the user opens a task that failed after one retry and re-ran its gates
- **THEN** the detail names the agent role and duration, the attempt count, each gate with its result
  and duration
- **AND** the activity tail lists the latest tool lines and the log reference when one exists

#### Scenario: the activity tail appears in one pane

- **WHEN** the run view renders at 80 columns with no task selected
- **THEN** the task graph is followed by the run-level tail of at least four rows
- **AND** selecting a task replaces both with that task's detail

#### Scenario: the list is ordered and labelled

- **WHEN** the workspace has three runs and one driver is active
- **THEN** the list is ordered newest first
- **AND** every row carries its summary, phase, role, tokens, cost and elapsed time
- **AND** the active run says `active` with its pid, a queued run says `queued #1`, the rest say
  `idle`

#### Scenario: an empty workspace explains itself

- **WHEN** the workspace has no runs
- **THEN** the list says no changes exist yet and names `n` to start one
- **AND** the footer shows `n`, `?` and `q`

#### Scenario: the tail keeps its floor on a short terminal

- **WHEN** a run's task graph needs more rows than remain at 80×24 with no task selected
- **THEN** the activity tail has four rows
- **AND** the task graph shows fewer rows and scrolls to the selection

### Requirement: Every long action is a detached CLI child

The TUI SHALL spawn through one injectable `Launcher` seam so a test can assert the request without
starting a process. A launch SHALL use `process.execPath`, `process.argv[1]` and argv `["-C",
<workspace>, <command>, …]`, with `cwd` the workspace, `detached: true`, `stdio: ["ignore", logFd,
logFd]` and `unref()`. stdout and stderr of the child SHALL go to
`.factory/logs/tui-spawn-<timestamp>.log`, whose path the UI shows. A non-zero child exit SHALL
surface the exit code and the last ten lines of that log in the UI. The TUI MUST NOT send a signal to
a child on quit, Ctrl-C, SIGTERM or crash, and MUST NOT use a shell, so a request is one argv element
and is never quoted.

#### Scenario: the argv for every action

- **WHEN** each action spawns
- **THEN** text intake is `["-C", <ws>, "run", "<text>", "--no-interactive"]`
- **AND** file intake is `["-C", <ws>, "run", "--request", "<absolute path>", "--no-interactive"]`
- **AND** approve and run is `["-C", <ws>, "approve", "<id>"]`
- **AND** approve only is `["-C", <ws>, "approve", "<id>", "--no-continue"]`
- **AND** reword is `["-C", <ws>, "reword", "<id>"]` without a prompt and `["-C", <ws>, "reword",
  "<id>", "--prompt", "<text>"]` with one, reapprove is `["-C", <ws>, "reapprove", "<id>"]` and
  resume is `["-C", <ws>, "resume", "<id>"]`
- **AND** land is `["-C", <ws>, "land", "<id>"]`

#### Scenario: the reword prompt is one argv element

- **WHEN** the reword panel confirms with a prompt of two lines
- **THEN** the launch receives `["reword", "<id>", "--prompt", "<two lines>"]`
- **AND** the prompt is one argv element with its newline intact and no quoting
- **AND** an empty prompt after trimming launches `["reword", "<id>"]` with no `--prompt`

#### Scenario: the child is detached and logged

- **WHEN** the launcher is called for any action
- **THEN** the options carry `cwd` = the workspace and `detached: true`
- **AND** `stdio` is `["ignore", <fd>, <fd>]` for the log file under `.factory/logs/`
- **AND** `unref` is called on the child
- **AND** the log path is returned to the UI

#### Scenario: a failed child is visible

- **WHEN** a spawned child exits non-zero
- **THEN** the UI shows the exit code and the last ten lines of its log
- **AND** the approval overlay, reword panel or intake dialog becomes actionable again

#### Scenario: no signal is sent on exit

- **WHEN** the UI quits, receives SIGINT or SIGTERM, or throws
- **THEN** the launcher recorded no kill, no signal and no wait
- **AND** the child pid is still alive

### Requirement: The approval overlay follows the run's phase

The overlay SHALL open when a run's phase is `awaiting-approval`, not when `approval.requested`
arrives, and SHALL show the run summary and change dir from run state (`summary` and `draft`), the
spec hash from `approval.pending`, the short spec commit and approver once the stream carries them,
and the identity the CLI will record (git `user.email` in the AI repo). When that identity is unset
the overlay SHALL show the CLI's message and disable every action that records an approval. Each
action SHALL have its own confirmation, never the key that opened the overlay:

- `a` approve and run, the default: launch `approve <id>`; the confirmation says the approval is
  recorded, the spec committed and implementation started locally.
- `A` approve only: launch `approve <id> --no-continue`; the confirmation says nothing is
  implemented, and the overlay then offers `r` and the `loomwright approve <id>` hint.
- `R` reapprove: launch `reapprove <id>`; the confirmation names the spec commit it accepts; offered
  only when the stream carries that commit.

The overlay SHALL offer only the actions this phase accepts. `w` reword SHALL NOT be offered at the
gate: the CLI refuses a reword at `awaiting-approval`, and reword is started from the run view (see
"Spec findings are visible and reword is offered where the CLI accepts it"). After a launch the
overlay SHALL be read-only, name the phase it waits for, and close on `approval.granted` plus the
next `phase.changed`. All actions SHALL go through the same launcher seam. A non-zero child exit
SHALL return the overlay to the actionable state with the log tail.

`Esc` in `idle` or `failed` SHALL collapse the overlay to the run view's coral gate banner, which
SHALL name the approval keys; `a`, `A` and `R` SHALL reopen the overlay from the banner and then
behave as above. `Esc` SHALL stay inert while the overlay is `confirming`, `launching` or `waiting`,
and the footer SHALL say why. `q` SHALL still quit from every state.

#### Scenario: the overlay opens on the phase

- **WHEN** a run's phase becomes `awaiting-approval` and the stream carries `approval.pending`
- **THEN** the overlay shows the summary, the change dir and the spec hash
- **AND** it shows no spec commit until `approval.granted` arrives
- **AND** `a` requires its own confirmation instead of approving on the opening key

#### Scenario: a missing identity disables approval

- **WHEN** `git config user.email` is empty in the workspace
- **THEN** the overlay shows the CLI's message about the missing identity
- **AND** `a`, `A` and `R` are unavailable
- **AND** neither the overlay nor the footer offers `w`

#### Scenario: approve only changes what the overlay says

- **WHEN** the user confirms `A`
- **THEN** `approve <id> --no-continue` is launched
- **AND** the overlay says nothing is implemented and offers `r` and `loomwright approve <id>`
- **AND** the overlay is read-only and names the phase it waits for

#### Scenario: the actions are gated by their evidence

- **WHEN** a run has no spec commit in its stream
- **THEN** `R` is not offered
- **AND** the footer lists only the keys that apply

#### Scenario: the overlay collapses to the banner and reopens

- **WHEN** the overlay is `idle` at `awaiting-approval` and the user presses `Esc`
- **THEN** the overlay closes and the run view shows the coral banner
- **AND** the banner names `a approve and run`, `A approve only` and `R reapprove`
- **AND** pressing `a` reopens the overlay in its `idle` state and `a` again starts the confirmation

#### Scenario: Esc is inert while an action is in flight

- **WHEN** the overlay is `confirming`, `launching` or `waiting` and the user presses `Esc`
- **THEN** the overlay state does not change and nothing is launched or cancelled
- **AND** the footer says that Esc waits for the action

#### Scenario: the overlay closes on the outcome

- **WHEN** `approval.granted` and then `phase.changed` arrive after an approve-and-run
- **THEN** the overlay closes and the run view shows the new phase
- **AND** a non-zero exit instead restores the actionable overlay with the log tail

### Requirement: Questions are recorded and answered later

The TUI SHALL list the `question.raised` records of the selected run from the snapshot. Opening the
questions pane SHALL select the first unanswered record, or the first record when none is unanswered,
and SHALL send an answer through `Factory.answer`, which drops a command file the driving process
applies at its next safe point. Because a run started from the TUI has no TTY, the UI SHALL label the
answer "recorded — applies at the next step" and MAY say "answered" only after `question.answered`
arrives, and SHALL point at the run's `questions.md`. The UI MUST NOT wait for the answer to be
applied and MUST NOT block the run.

`Enter` on a selected unanswered record SHALL open a composer. In the composer, printable keys
(including `j` and `k`) SHALL append text, `Ctrl-J` SHALL insert a newline, backspace SHALL delete the
last character, `Enter` SHALL record the answer, and `Esc` SHALL discard the composer and keep the
pane open. `j`/`k` and the arrow keys SHALL navigate the records whenever no composer is open, and a
second `Esc` SHALL close the pane. While a composer is open, navigation keys SHALL leave the composer
alone and the footer SHALL say `Esc leaves the composer to navigate`, so no key is silently dead. An
empty or whitespace-only answer SHALL be refused in place with the existing notice. Only one answer
SHALL be in flight at a time.

After a successful record the pane SHALL stay open, SHALL keep the recorded row reading
`recorded — applies at the next step` until `question.answered` arrives, and SHALL advance the
selection to the next unanswered record. When no unanswered record remains the selection SHALL stay
on the recorded record. Many records SHALL scroll inside the pane and the selected record SHALL
always be visible.

#### Scenario: an answer is recorded, then confirmed

- **WHEN** the user answers an `unanswered` question
- **THEN** `Factory.answer` is called with the answer and the question
- **AND** the row says `recorded — applies at the next step` until `question.answered` arrives
- **AND** the row then says `answered` with the recorded answer

#### Scenario: the run is not asked

- **WHEN** a run started from the TUI raises a question
- **THEN** the question is listed as unanswered and nothing waits on stdin
- **AND** the pane points at `openspec/changes/<id>/questions.md` or its draft equivalent

#### Scenario: a skipped question is shown as skipped

- **WHEN** the snapshot holds a record with status `skipped`
- **THEN** the row says `skipped` and offers no prompt

#### Scenario: answer then advance keeps the pane open

- **WHEN** the pane holds three records and the first two are unanswered and the user answers the
  first
- **THEN** the second record is selected and the pane is still open
- **AND** the first record still reads `recorded — applies at the next step`
- **AND** the footer lists `j`/`k` navigate, `Enter` answer and `Esc` close

#### Scenario: Ctrl-J inserts a newline

- **WHEN** the user types `first`, presses `Ctrl-J`, types `second` and presses `Enter` in a composer
- **THEN** `Factory.answer` receives `first\nsecond` as one answer
- **AND** the composer showed the text on two lines

#### Scenario: Esc discards the composer, then closes

- **WHEN** the user types into a composer and presses `Esc`
- **THEN** the text is discarded and nothing is recorded
- **AND** the pane stays open and `j`/`k` navigate at once
- **AND** a second `Esc` closes the pane

#### Scenario: an empty answer is refused

- **WHEN** the user presses `Enter` on a composer holding only spaces and newlines
- **THEN** the pane shows `the answer is empty` in place
- **AND** no answer is recorded and the pane stays open

#### Scenario: many records scroll

- **WHEN** a run has eight records and the pane renders at 80×24 with the last one selected
- **THEN** the pane shows a window of records and the selected record is visible
- **AND** the window moves with the selection

### Requirement: Layout, keyboard and accessibility

The UI SHALL render at 80×24 and larger; at 100 columns and wider it SHALL use two panes (list or
graph, and detail), and below that a single pane with drill-down. Every region that can grow SHALL be
given a row budget and a scroll offset, and the frame SHALL never exceed `rows` lines with the footer
as its last row. The selected row SHALL stay visible after `j`/`k` at either end, a page move, a data
change and a resize. Every state SHALL be conveyed by a glyph and a label, never by colour alone. The
UI SHALL respect `NO_COLOR`, accept `--ascii`, and SHALL use ASCII glyphs automatically when `TERM`
is `dumb` or the locale is not UTF-8. Input SHALL be keyboard only: no mouse handling is added. The
footer SHALL list the keys valid in the current state, and `docs/tui.md` SHALL document the same
keys.

#### Scenario: two panes become one

- **WHEN** the terminal is 80 columns wide
- **THEN** one pane is shown and `Enter` drills into the selected run or task
- **AND** at 120 columns the list and the detail are shown side by side

#### Scenario: state without colour

- **WHEN** `NO_COLOR` is set
- **THEN** every status still carries its glyph and its label
- **AND** focus is shown by an ASCII-safe marker rather than a hue

#### Scenario: ASCII glyphs are automatic

- **WHEN** `TERM=dumb` or the locale is not UTF-8
- **THEN** the glyph set is ASCII without `--ascii`
- **AND** `--ascii` forces the same set on any terminal

#### Scenario: the keys are documented

- **WHEN** `docs/tui.md` and the footer are read
- **THEN** both list `n`, `Tab` (intake mode and log scope), `a`, `A`, `w`, `R`, `r`, `x`, `t`, `l`,
  `Q`, `L`, `PgUp`/`PgDn`, `g`/`G`, `f`, `Ctrl-J`, `Esc`, `?` and `q`
- **AND** `l` is described as land for a done run, `w` as reword from the run view, and the answer
  semantics are described in both

#### Scenario: the footer is the last row and the frame fits

- **WHEN** a 60-run list renders at 80×24
- **THEN** the frame has at most 24 lines and no line is lost off the top
- **AND** the footer is the last line and the title names the window (`runs 1-9/60`) because the list
  overflows

#### Scenario: the selection stays visible

- **WHEN** the selection moves to the last row of 60 with `G` and back to the first with `g`
- **THEN** the selected row is inside the rendered window both times
- **AND** the terminal never scrolls and the frame does not shift

### Requirement: Tests pin the behaviour

The suite SHALL contain unit tests for the pure view-model layer with no Ink import, folding tests
that feed one event of every protocol type through the facts and assert the resulting activity lines,
scope tests for the task/repo/run derivation, viewport tests for every offset at 80×24 and 120×40
(clamp at both ends, resize, selection after a data change, follow on and off), frame snapshots at
80×24 and 120×40 for no runs, running graph, failing task, awaiting approval, question open,
finished, new run (text), new run (file), approve-and-run confirm, approve-only confirm and queued
after approval plus a design-phase activity state, a land confirmation state, a long run list at the
top, middle and bottom, a paused run with three findings, the findings panel, the reword panel with
findings and a typed prompt, the reword confirm naming `--prompt`, a 12-task run with a non-zero
tail, a task detail with 20 gates and a scrolling tail, questions with 8 records and a composer open
(single and multiline), the approval overlay collapsed to the banner and reopened, and the log pane
following and scrolled in all three scopes. Launcher tests SHALL assert argv, flags, `detached`,
`stdio`, `cwd`, `-C`, the reword prompt as one argv element and the absence of a signal on quit,
SIGINT and crash; dialog tests, keybinding tests (approve confirm, abort confirm, land confirm, quit
restores the terminal, `Esc` collapsing only at `idle`/`failed`, answers advancing, `Ctrl-J`
inserting a newline, `w` from a paused run, `L` scrolling in replay) and `approval.pending` reduction
stay. A regression test SHALL assert that no rendered frame exceeds `rows` for a 60-run list and a
12-task run, and the existing accessibility and colour tests SHALL keep passing with updated
fixtures.

#### Scenario: the view-model is tested without Ink

- **WHEN** the view-model suite runs
- **THEN** it imports no Ink or React module
- **AND** it covers the header, task order (as stored), gates, questions, approval, the findings,
  the reword availability rule, the all-event activity tail, the derived task scope and the land
  footer hint

#### Scenario: every screen has both sizes

- **WHEN** the frame snapshots run
- **THEN** every state in `test/frame-states.ts`, including the new findings, reword, log, questions
  and long-list states, has an 80×24 and a 120×40 file
- **AND** a diff fails the suite with the state name

#### Scenario: the launcher matrix is complete

- **WHEN** the launcher tests run
- **THEN** they cover text intake, file intake, approve, approve-only, reword with and without a
  prompt, reapprove, resume and land
- **AND** they assert that quitting, SIGINT and a crash send no signal to a child

#### Scenario: every event type is exercised

- **WHEN** the fold tests run
- **THEN** one event of every `EVENT_TYPES` member produces its activity line (or the coalesced
  heartbeat line)
- **AND** a task detail still derives its lines from the task's id and repo

#### Scenario: the frame budget is pinned

- **WHEN** the budget regression runs
- **THEN** a 60-run list and a 12-task run at 80×24 each render at most 24 lines
- **AND** each frame's last line is the footer

The replay fixture SHALL stay valid without a re-record unless the new layout genuinely changes what
it asserts; where it does, the change SHALL re-record it and say why in the final report.

### Requirement: Documentation and the ADR record the UI

`docs/tui.md` SHALL document the layout, the keys including `n`, the intake mode toggle, `a`, `A`,
`w`, `R`, `r`, `x`, `t`, `l`, `Q`, `L`, `Tab`, `PgUp`/`PgDn`, `g`/`G`, `f`, `Ctrl-J`, `Esc`, `?` and
`q`, the answer semantics, the findings and reword flow, the activity tail and its log references,
the scoped log pane, the collapsed gate banner, the land confirmation and what land removes locally,
the flags, the accessibility rules, the styling rules and the replay mode. `README.md` SHALL keep its
section on watching, starting, approving and landing from the TUI, `docs/cli.md` its `tui` entry,
and `ARCHITECTURE.md` the `packages/tui` row. ADR-0047 SHALL keep recording Ink with its pinned
versions, the lazy second bundle, detached children, the phase-driven overlay, the additive
`approval.pending` event, replay and the local land action; ADR-0048 SHALL record the scroll model,
the scoped activity log and the collapsed overlay, with `## Context`, `## Decision` and
`## Consequences`, and SHALL be listed in `docs/decisions/README.md`. `docs/events.md` SHALL keep
documenting `approval.pending` in the approval family. The ADRs MUST NOT contain the capitalised
product name, so the historical scan stays valid.

#### Scenario: the docs cover the UI

- **WHEN** `docs/tui.md`, `README.md` and `docs/cli.md` are read
- **THEN** they describe the views, the all-event tail, the scoped log, the findings and reword flow,
  the keys including `L` and `w`, the flags and the honest answer semantics
- **AND** `docs/cli.md` mentions `docs/tui.md`

#### Scenario: the ADR is valid and indexed

- **WHEN** `docs/decisions/0047-*.md`, `docs/decisions/0048-*.md` and the decisions index are read
- **THEN** each ADR starts `# 00NN — `, has the three required sections and names the pinned framework
  versions where it describes the framework
- **AND** the index has a row for each
- **AND** neither file contains the capitalised product name

## ADDED Requirements

### Requirement: Spec findings are visible and reword is offered where the CLI accepts it

`RunDetail` SHALL carry the run's `specFindings` — severity, `file`, `line`, problem, fix and impact —
and the run state's `pausedReason` when present. The run list SHALL show the finding count
(`2 findings`) on the row. A run paused on findings SHALL say `paused — 2 spec findings need reword`
in the run view, in words and not only by a glyph.

The findings panel SHALL list every finding in the same 1-based order `reword --finding` uses, each
with its severity, `file:line` when present, problem and fix, and SHALL scroll so a long problem is
never truncated away at 80 columns.

`w` SHALL open the reword panel from the run view when the run's phase is one the CLI accepts
(`queued`, `implementing`, `reviewing`, `contracts`, `full-suite`, `closing`, `paused`, `aborted`) and
no driver is alive, whether or not findings exist. When this run's driver is alive the key SHALL be
shown inert with the CLI's reason naming the pid; when another change holds the active lock it SHALL
name that change. The panel SHALL show the findings read-only, a multi-line prompt (`Ctrl-J` newline,
`Enter` confirms, `Esc` backs out) and a confirm line naming the exact argv. The prompt SHALL be
optional when findings exist and required when there are none, with the confirm unavailable until it
is non-empty. Confirming SHALL launch the detached child through the launcher seam — `reword <id>`
without a prompt, `reword <id> --prompt <text>` with one — and a non-zero exit SHALL show the exit
code and the log tail. Replay SHALL refuse the key with the read-only notice and MUST NOT launch.

#### Scenario: the run list marks findings

- **WHEN** the selected run is paused with two spec findings
- **THEN** its list row reads `2 findings` beside the id and summary
- **AND** a run without findings shows no marker

#### Scenario: the banner says reword is needed

- **WHEN** a run paused on three spec findings is open
- **THEN** the run view reads `paused — 3 spec findings need reword`
- **AND** the phase still carries its glyph and label

#### Scenario: the findings panel lists every finding in order

- **WHEN** the run has findings 1 to 3 with files and lines
- **THEN** the panel lists `1.` to `3.` in that order with each severity, `file:line`, problem and
  fix
- **AND** the order matches `loomwright reword <id> --finding 1` picking the first

#### Scenario: a long problem scrolls instead of being cut

- **WHEN** finding 2's problem is 400 characters and the pane renders at 80×24
- **THEN** every character of the problem is reachable by scrolling the panel
- **AND** the panel shows its window and keeps the footer's keys visible

#### Scenario: w opens the reword panel with findings

- **WHEN** a paused run with two findings is open and the user presses `w`
- **THEN** the reword panel lists the two findings and an empty prompt
- **AND** its confirm line names `reword <id> --prompt <text>`
- **AND** confirming with the empty prompt launches `reword <id>`

#### Scenario: w needs a prompt when there are no findings

- **WHEN** an approved, idle run without findings is open and the user presses `w`
- **THEN** the panel opens with no findings and an empty prompt
- **AND** the confirm is unavailable until the prompt is non-empty
- **AND** confirming after typing launches `reword <id> --prompt "<typed text>"`

#### Scenario: a driven run explains why w is inert

- **WHEN** the selected run is implementing and its driver is alive with pid 4242
- **THEN** the footer shows `w` as unavailable
- **AND** pressing `w` shows the CLI's reason as a notice,
  `add-health is being driven by pid 4242; stop it first`, and launches nothing
- **AND** at 120 columns the footer names the same reason; at 80 columns it clips to the room the
  enabled keys leave, so `q` and `?` stay visible

#### Scenario: phases the CLI refuses offer no reword

- **WHEN** the selected run is `design`, `awaiting-approval` or `done`
- **THEN** no `w` hint is shown and pressing `w` does nothing
- **AND** at `awaiting-approval` the overlay offers only the approval actions

#### Scenario: replay refuses the reword key

- **WHEN** `tui --replay` shows a paused run with findings and `w` is pressed
- **THEN** the UI says the stream is replayed and read-only
- **AND** no panel opens and the launcher is never called

### Requirement: Activity is scoped to the task it belongs to

One pure function SHALL map an activity line to the scopes it belongs to, using the run state's
task-to-repo table and the step the event named. A line whose step is a task id SHALL belong to that
task and to that task's repo; a line whose step is `review:<repo>` or `explore:<repo>` SHALL belong
to that repo; a line whose step is a repo named by a task SHALL belong to that repo; every other
step SHALL belong only to the run. A task's activity SHALL be the union of its own lines and its
repo's lines, so the reviewer, the tester task, the contract-fix task, the full-suite gates and the
install work for that repo all appear in the task's detail, each keeping its step label. Another
repo's lines MUST NOT appear. The run scope SHALL carry every retained line. The mapping SHALL live
in one module with tests and MUST NOT be re-implemented in a view.

#### Scenario: reviewer and full-suite lines join the task

- **WHEN** a task `first` in repo `app` has lines, and the run also has `review:app` lines and
  `gate.finished` lines whose step is `app`
- **THEN** the detail for `first` lists both sets
- **AND** the reviewer lines still read `review:app`

#### Scenario: the tester task's activity joins its repo

- **WHEN** the run has a tester task `test-first` in repo `app` with `agent.activity` lines
- **THEN** the detail for `first` lists those lines labelled `test-first`
- **AND** the detail for `test-first` lists them too

#### Scenario: another repo's lines stay out

- **WHEN** the run has a task `second` in repo `api` with lines and a `review:api` step
- **THEN** the detail for `first` in repo `app` lists neither
- **AND** the detail for `second` lists both

#### Scenario: the task's own lines stay

- **WHEN** a task has `task.started`, `agent.activity` and `gate.finished` lines whose step is its id
- **THEN** its detail lists all three

#### Scenario: the contract review stays run-scoped

- **WHEN** the run emits `agent.activity` for step `contract-review` and contract-fix task lines for
  repo `app`
- **THEN** the `contract-review` lines appear in the run scope
- **AND** the contract-fix task's lines appear in the `app` task detail labelled with that task id

#### Scenario: the run scope carries everything

- **WHEN** the log pane is in the run scope
- **THEN** it lists every retained line, including the ones a task scope includes

### Requirement: The activity log is a scoped, scrollable destination

`L` SHALL open a full-height, read-only activity pane. It SHALL open in the current scope — the
selected task's when a task is selected, otherwise the run's — and its title SHALL name the scope.
`Tab` SHALL cycle run → task → repo and SHALL skip a scope the run cannot name (a run with no tasks
has no task scope; a task without a repo has no repo scope). `j`/`k` SHALL scroll one line,
`PgUp`/`PgDn` a page, `g`/`G` the first and last line, `f` SHALL toggle follow, which SHALL default
on, and `Esc` SHALL return to the view the pane was opened from. While follow is on the pane SHALL
show the newest lines as events arrive; while it is off the viewport MUST NOT move when data arrives.
The pane SHALL be available in replay and SHALL scroll there, but MUST NOT launch or write anything.
Log lines SHALL keep the `source • kind • text` shape, the log-reference arrow, the coalesced
heartbeat and horizontal truncation, and the TUI MUST NOT read the referenced file.

#### Scenario: L opens the run log and follows

- **WHEN** the run view is open with no task selected and the user presses `L`
- **THEN** the pane fills the height and its title names the run
- **AND** it shows the newest lines and `f follow on`

#### Scenario: Tab reaches task and repo scope

- **WHEN** the run has a selected task `first` in repo `app` and the pane is open
- **THEN** `Tab` moves the scope to `first` and then to `app`
- **AND** the title names each scope and the lines listed change accordingly

#### Scenario: follow off keeps the viewport

- **WHEN** follow is off and new events arrive
- **THEN** the pane's first visible line and offset do not change
- **AND** pressing `f` again re-enables follow at the newest line

#### Scenario: paging and first and last

- **WHEN** the pane holds 200 lines and the user presses `PgDn`, `G` and `g`
- **THEN** the offset moves by a page, to the last line and to the first
- **AND** the offset never leaves `[0, lines - height]`

#### Scenario: the overview never loses the tail

- **WHEN** a run's task graph needs more rows than remain at 80×24
- **THEN** the compact tail keeps four rows
- **AND** the graph window scrolls with the selection

#### Scenario: replay scrolls the pane but launches nothing

- **WHEN** `tui --replay` is open and the user presses `L`, `Tab`, `j` and `f`
- **THEN** the pane opens and scrolls
- **AND** no launcher or Factory write is called

### Requirement: Scroll is view state and the frame never exceeds the terminal

The view model SHALL carry a scroll offset per scrolling region — run list, task graph, questions and
activity log — and SHALL clamp it to `[0, max(0, length - size)]` when the data changes and when the
terminal is resized, and so that the selected row is inside the window. `j`/`k` and the arrow keys
SHALL move one row, `PgUp`/`PgDn` a page and `g`/`G` the first and last row on the focused list. A
section title SHALL show its window (`runs 3-11/12`) only when the list overflows. Every rendered frame
SHALL have at most `rows` lines, with the footer last; the two-pane list preview and the task graph
SHALL be clipped to the same budget as the run tail. The TUI MUST NOT use Ink-side scrolling or
mouse input.

#### Scenario: a 60-run list keeps the frame still

- **WHEN** a 60-run list renders at 80×24 and the user presses `G` then `g`
- **THEN** the selected row is visible at both ends
- **AND** the frame stays 24 lines with the footer last and the terminal does not scroll

#### Scenario: resize re-clamps the offset

- **WHEN** the offset is near the end and the terminal grows from 80×24 to 120×40
- **THEN** the offset is clamped so the window still fits
- **AND** the selected row stays visible and the title window is recomputed

#### Scenario: the title names the window only when needed

- **WHEN** the list has 12 runs and 9 fit
- **THEN** the title reads `runs 3-11/12` while the selection is in that window
- **AND** a list that fits shows no window

#### Scenario: a page move keeps the selection in the window

- **WHEN** the graph holds 30 tasks and the user presses `PgDn` twice
- **THEN** the selection moves a page each time and stays visible
- **AND** the offset is a page boundary clamped at the end

### Requirement: The screen is structured by titles, aligned facts and padding

The run view SHALL show a bold run id and phase, muted elapsed, tokens and cost, titled `Tasks` and
`Activity` sections, one column of padding and a blank line between sections. The task graph and task
detail SHALL mark the selected row with the lilac focus token and bold, align gates as
`glyph name status duration` in fixed columns and align label/value facts in a two-column block. The
run list SHALL show the summary on the row, dim the metadata, bold the selected row, colour the phase
glyph with the existing phase token and mark findings with the gate glyph and label, not the coral
hue. A run row SHALL stay one line at 80 columns and truncate rather than wrap. Panels SHALL have a
bold title, a padded body and muted footer hints, separated by a blank line when the panel and the
frame have the room; a full-height panel omits that line instead of exceeding `rows`; the
approval overlay SHALL keep coral and every other panel SHALL use lilac. Empty states (`no activity
yet`, `no gate results`, `No changes exist yet`) SHALL stay muted and honest. Every state SHALL remain
readable with colour off and in ASCII, and no state SHALL paint a background or introduce a colour
outside the token module.

#### Scenario: the run view is structured

- **WHEN** a running run renders at 120×40
- **THEN** the header shows a bold id and phase with muted elapsed, tokens and cost
- **AND** the `Tasks` and `Activity` sections are titled and separated by a blank line
- **AND** the body has one column of padding

#### Scenario: the selected row is marked without colour

- **WHEN** `NO_COLOR` is set and the task graph shows a selection
- **THEN** the selected row carries the focus glyph, bold weight and its label
- **AND** no hue is needed to identify it

#### Scenario: gates and facts align

- **WHEN** a task detail shows two gates and the agent facts
- **THEN** each gate reads `glyph name status duration` in fixed columns
- **AND** the label/value facts line their values up in one column

#### Scenario: empty states stay muted

- **WHEN** a run has no activity or a task has no gate results
- **THEN** the pane says `no activity yet` or `no gate results` in the muted token
- **AND** no colour, glyph or border implies a failure

#### Scenario: no new colour is introduced

- **WHEN** the frame is rendered at truecolor depth
- **THEN** only the token module's hues appear
- **AND** no cell carries a background or reverse-video parameter
