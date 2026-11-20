# factory-tui Specification

## MODIFIED Requirements

### Requirement: The TUI never drives a pipeline in-process

The TUI MUST NOT call `Factory.run`, `Factory.approve` with continue, `Factory.resume` or any
land function. Long work SHALL run in detached children of the same CLI entry — intake (`run`),
approve, approve only, reword, reapprove, resume and land — so that quitting the UI, Ctrl-C,
SIGTERM or a crash leaves every run exactly as it would be without the UI. Only commands that
write state or drop a command file without driving a phase (`answer`, `abort`, `retry`) MAY be
called in-process. The terminal SHALL be restored — alternate screen left, cursor shown, raw mode
off — on quit, on Ctrl-C, on SIGTERM and when rendering throws.

#### Scenario: quitting leaves the run alone

- **WHEN** a run started from the TUI is implementing and the user presses `q`
- **THEN** the UI exits `0` and the child process keeps its pid and continues
- **AND** the TUI sends no signal to the child

#### Scenario: a crash restores the terminal

- **WHEN** a view throws while rendering
- **THEN** the alternate screen is left, the cursor is shown and raw mode is off before exit
- **AND** spawned children keep running

#### Scenario: only the short commands run in-process

- **WHEN** the source under `packages/tui/src` is scanned for `Factory` calls
- **THEN** `run`, `approve`, `resume`, `pause` and `land` are not called
- **AND** the only write methods called are `answer`, `abort` and `retry`

#### Scenario: land is a child, not a call

- **WHEN** the user confirms land for a done run
- **THEN** the launcher is called with the land action
- **AND** `packages/tui/src` value-imports no pipeline module and no `landChange` function

### Requirement: Every long action is a detached CLI child

The TUI SHALL spawn through one injectable `Launcher` seam so a test can assert the request
without starting a process. A launch SHALL use `process.execPath`, `process.argv[1]` and argv
`["-C", <workspace>, <command>, …]`, with `cwd` the workspace, `detached: true`,
`stdio: ["ignore", logFd, logFd]` and `unref()`. stdout and stderr of the child SHALL go to
`.factory/logs/tui-spawn-<timestamp>.log`, whose path the UI shows. A non-zero child exit SHALL
surface the exit code and the last ten lines of that log in the UI. The TUI MUST NOT send a signal
to a child on quit, Ctrl-C, SIGTERM or crash, and MUST NOT use a shell, so a request is one argv
element and is never quoted.

#### Scenario: the argv for every action

- **WHEN** each action spawns
- **THEN** text intake is `["-C", <ws>, "run", "<text>", "--no-interactive"]`
- **AND** file intake is `["-C", <ws>, "run", "--request", "<absolute path>", "--no-interactive"]`
- **AND** approve and run is `["-C", <ws>, "approve", "<id>"]`
- **AND** approve only is `["-C", <ws>, "approve", "<id>", "--no-continue"]`
- **AND** reword is `["-C", <ws>, "reword", "<id>"]`, reapprove is `["-C", <ws>, "reapprove", "<id>"]` and resume is `["-C", <ws>, "resume", "<id>"]`
- **AND** land is `["-C", <ws>, "land", "<id>"]`

#### Scenario: the child is detached and logged

- **WHEN** the launcher is called for any action
- **THEN** the options carry `cwd` = the workspace and `detached: true`
- **AND** `stdio` is `["ignore", <fd>, <fd>]` for the log file under `.factory/logs/`
- **AND** `unref` is called on the child
- **AND** the log path is returned to the UI

#### Scenario: a failed child is visible

- **WHEN** a spawned child exits non-zero
- **THEN** the UI shows the exit code and the last ten lines of its log
- **AND** the approval overlay or intake dialog becomes actionable again

#### Scenario: no signal is sent on exit

- **WHEN** the UI quits, receives SIGINT or SIGTERM, or throws
- **THEN** the launcher recorded no kill, no signal and no wait
- **AND** the child pid is still alive

### Requirement: The run list and run view show the whole run

The TUI SHALL show a run list ordered newest first with each run's id, phase, role (active,
queued at its position, or idle), token and cost totals and elapsed time. Opening a run SHALL show
a header with the run id, phase, elapsed time, token and cost totals and lock status; a task list
in the order the run state carries (the tasks.md plan order, not re-sorted by `deps`) with each
task's status, repo, attempt and title; a task detail pane with the agent role, model, retries,
gate results per step, duration and a live activity tail; and a footer listing the keys that are
valid in the current state.

The activity tail SHALL be built from every run event, whatever the phase and whether or not a
task is running. Every event type the protocol defines SHALL fold into an activity line, except
that repeated `heartbeat` events update the newest heartbeat line in place instead of adding a
line each, so the tail carries at most one heartbeat line between bursts of work. Each line SHALL
carry a source label — the task id, the install repo or the step when the event names one, and
`run` otherwise — a kind label naming the event family — except `agent.activity`, whose kind is
the activity kind it carries (`tool`, `step-done`, …) — and readable text. A line whose event
carries a truncation reference (`ref`, or `gate.finished.outputRef`) SHALL name that
`.factory/logs/` path. `run.*`, `phase.changed`, `task.*`, `gate.*`, `agent.*`, `install.*`,
`question.*`, `approval.*`, `usage.delta`, `progress.line` and `heartbeat` SHALL therefore be
visible in the run view, not only the agent activity of a task phase. The task detail SHALL keep
showing only the lines whose source is that task.

At 100 columns and wider the run view SHALL show the run-level tail beside the task graph when no
task is selected. Below 100 columns it SHALL show the task graph followed by the run-level tail,
sized to the rows left; a selected task's detail SHALL replace both.

#### Scenario: design and install activity is visible

- **WHEN** a run in `design` emits `run.started`, `phase.changed`, `install.started`, `install.finished` and `progress.line` and has no tasks yet
- **THEN** the run view lists a line for each, labelled with `run` or the install repo
- **AND** the design-phase activity is visible at 80 columns as well as 120

#### Scenario: every event type is folded

- **WHEN** one event of every type in `EVENT_TYPES` is collected into the facts
- **THEN** each non-heartbeat type has at least one activity line
- **AND** all consecutive heartbeats share one heartbeat line whose text is the newest one
- **AND** no event type is silently dropped

#### Scenario: a log reference is named

- **WHEN** a `progress.line`, `install.finished` or `gate.finished` event carries `ref.path` or `outputRef.path` for `.factory/logs/add-health/2026-11-19.jsonl`
- **THEN** that line names the same path after the arrow glyph
- **AND** the TUI does not open or read the referenced file

#### Scenario: the task detail stays task-scoped

- **WHEN** a run has run-level lines and lines for two tasks and one task is selected
- **THEN** the task detail lists only the lines whose source is that task
- **AND** the run-level tail still carries the `run` lines and the other task's lines

#### Scenario: a task detail shows the evidence

- **WHEN** the user opens a task that failed after one retry and re-ran its gates
- **THEN** the detail names the agent role and duration, the attempt count, each gate with its result and duration
- **AND** the activity tail lists the latest tool lines and the log reference when one exists

#### Scenario: the activity tail appears in one pane

- **WHEN** the run view renders at 80 columns with no task selected
- **THEN** the task graph is followed by the run-level tail
- **AND** selecting a task replaces both with that task's detail

#### Scenario: the list is ordered and labelled

- **WHEN** the workspace has three runs and one driver is active
- **THEN** the list is ordered newest first
- **AND** the active run says `active` with its pid, a queued run says `queued #1`, the rest say `idle`

#### Scenario: an empty workspace explains itself

- **WHEN** the workspace has no runs
- **THEN** the list says no changes exist yet and names `n` to start one
- **AND** the footer shows `n`, `?` and `q`

### Requirement: Abort, retry, resume and land are the run controls

`x` SHALL abort the selected run only after a confirmation that names the change id, and SHALL
call `Factory.abort`; the UI SHALL then show the phase from run state. `t` SHALL retry the
selected failed task through `Factory.retry` and SHALL be available only for a failed task. `r`
SHALL resume a paused, aborted or interrupted run by launching the detached `resume <id>` child.
`l` SHALL land the selected run only when its phase is `done` and SHALL first show a confirmation
that names the change id, says the change branches are merged into their base branches locally,
deleted once merged, its worktrees and run state removed, and that nothing is pushed. Confirming
SHALL launch the detached `land <id>` child through the same launcher seam; cancelling SHALL do
nothing. A run in any other phase SHALL offer no land. While that child is in flight a second `l`
SHALL launch nothing. A zero exit SHALL refresh `status()` and `listRuns()` and, when the run
state is gone, return to the run list with a notice naming the landed id; a non-zero exit SHALL
show the exit code and the last ten lines of the spawn log and SHALL NOT say the change landed.
None of these SHALL block the UI for the length of a pipeline phase.

#### Scenario: abort needs its own confirmation

- **WHEN** the user presses `x` on a running change
- **THEN** a confirmation names the change id and says branches and worktrees are kept
- **AND** `Factory.abort` runs only after it is confirmed
- **AND** cancelling at the confirmation aborts nothing

#### Scenario: retry is limited to failed tasks

- **WHEN** the selected task is failed and the user presses `t`
- **THEN** `Factory.retry` is called with the change id and task id
- **AND** a task that is not failed offers no retry

#### Scenario: resume is a child, not a call

- **WHEN** the user presses `r` on a paused run
- **THEN** `resume <id>` is launched as a detached child
- **AND** `Factory.resume` is not called in the UI process

#### Scenario: land confirms before merging

- **WHEN** the selected run is `done` and the user presses `l`
- **THEN** a confirmation names the change id, the local merges, the cleanup and that nothing is pushed
- **AND** no child runs until `Enter` or `y` confirms
- **AND** confirming launches exactly one `land <id>` child
- **AND** `Esc` or `n` cancels and launches nothing

#### Scenario: land is offered only for a done run

- **WHEN** the selected run is paused, aborted, queued, implementing, reviewing or awaiting approval
- **THEN** the footer lists no `l` hint
- **AND** pressing `l` launches nothing and opens no confirmation

#### Scenario: a double-tapped land launches one child

- **WHEN** `l` is confirmed twice while the first `land <id>` child is still in flight
- **THEN** only one child was launched
- **AND** the second confirmation is ignored

#### Scenario: a landed run leaves the screen

- **WHEN** the `land <id>` child exits `0` and the next `status()` no longer lists the run
- **THEN** the UI returns to the run list with a notice naming the landed id
- **AND** no branch, worktree or run state was removed by the UI process itself

#### Scenario: a failed land is visible

- **WHEN** the `land <id>` child exits non-zero, for example on a merge conflict
- **THEN** the UI shows the exit code and the last ten lines of the spawn log
- **AND** it does not claim the change landed
- **AND** the run stays selected with its branches intact

### Requirement: Layout, keyboard and accessibility

The UI SHALL render at 80×24 and larger; at 100 columns and wider it SHALL use two panes (list or
graph, and detail), and below that a single pane with drill-down. Every state SHALL be conveyed by
a glyph and a label, never by colour alone. The UI SHALL respect `NO_COLOR`, accept `--ascii`, and
SHALL use ASCII glyphs automatically when `TERM` is `dumb` or the locale is not UTF-8. Input SHALL
be keyboard only: no mouse handling is added. The footer SHALL list the keys valid in the current
state, and `docs/tui.md` SHALL document the same keys.

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
- **THEN** both list `n`, the `Tab` intake mode toggle, `a`, `A`, `w`, `R`, `r`, `x`, `t`, `l`, `?` and `q`
- **AND** `l` is described as land for a done run and the answer semantics are described in both

### Requirement: Rendering and polling stay bounded

The UI SHALL render at most ten frames per second, batching events that arrive faster, SHALL keep
the activity tail in a ring buffer of the last 2,000 lines whatever their event type, and SHALL
poll `status()` at most once per second plus immediately after a spawn. Folding SHALL stay O(1)
per event, and coalesced heartbeats SHALL NOT grow the retained state. Memory and retained event
objects MUST NOT grow over a long run.

#### Scenario: a burst is coalesced

- **WHEN** 500 events arrive within one frame interval
- **THEN** the UI renders at most one frame for that interval
- **AND** the frame reflects every event

#### Scenario: the tail is capped

- **WHEN** a run emits 100,000 mixed events including heartbeats
- **THEN** the tail holds exactly the last 2,000 lines
- **AND** a consecutive heartbeat run contributes one line, not one per event
- **AND** the retained state stays bounded and the frame is still produced

#### Scenario: status is polled once a second

- **WHEN** the run view is open for ten seconds with no spawn
- **THEN** at most ten `status()` calls were made
- **AND** a spawn triggers one immediately

### Requirement: Replay renders a recorded stream with every action disabled

`tui --replay <events.jsonl>` SHALL render the same screens from a recorded stream without a
workspace: it SHALL read the file with the same complete-line reader semantics as `readEvents`
(ignore a partial trailing line and blank lines, report corrupt complete lines in `skipped` and
keep the readable events), SHALL feed the result through `reduce`, SHALL mark the run as
replayed, and SHALL disable every write action (intake, approve, reword, reapprove, resume,
abort, retry, answer and land) and the `status()` poll. `--once` SHALL render exactly one frame
through the same component tree into an in-memory stdout, write that text through the command's
output and exit `0`. Replay MUST NOT spawn a child. The checked-in fixtures SHALL include the stub
e2e logs and a stream that ends at the approval gate so the overlay can be replayed.

#### Scenario: replay shows the recorded screens

- **WHEN** `tui --replay test/fixtures/tui/approval-gate.jsonl` runs
- **THEN** the run view and the approval overlay render from the recorded events
- **AND** the pending spec hash comes from the recorded `approval.pending`
- **AND** any `phase.changed`, install and progress lines in the stream appear in the tail

#### Scenario: once prints one frame

- **WHEN** `tui --replay <file> --once` runs with stdout not a TTY
- **THEN** exactly one frame is written and the exit code is `0`
- **AND** the frame contains no cursor-control sequence

#### Scenario: replay is read-only

- **WHEN** any key that would write, including `l`, is pressed in replay
- **THEN** the UI says the stream is replayed and read-only
- **AND** the launcher and `Factory` write methods are never called

### Requirement: Tests pin the behaviour

The suite SHALL contain unit tests for the pure view-model layer with no Ink import, folding tests
that feed one event of every protocol type through the facts and assert the resulting activity
lines, frame snapshots at 80×24 and 120×40 for no runs, running graph, failing task, awaiting
approval, question open, finished, new run (text), new run (file), approve-and-run confirm,
approve-only confirm and queued after approval plus a design-phase activity state and a land
confirmation state, launcher tests asserting argv, flags, `detached`, `stdio`, `cwd`, `-C` and the
absence of a signal on quit, SIGINT and crash, dialog tests (blank text, missing, unreadable and
empty file, queued-after-active wording, disabled before `init`, no second spawn), keybinding
tests (approve confirm, abort confirm, land confirm, quit restores the terminal),
`approval.pending` reduction, land gate and replay tests (only a done run offers land, a failed
land shows its log tail, replay disables `l`) and a replay fixture that shows the approval gate.

#### Scenario: the view-model is tested without Ink

- **WHEN** the view-model suite runs
- **THEN** it imports no Ink or React module
- **AND** it covers the header, task order (as stored, i.e. tasks.md plan order), gates, questions, approval, the all-event activity tail and the land footer hint

#### Scenario: every screen has both sizes

- **WHEN** the frame snapshots run
- **THEN** every state in `test/frame-states.ts`, including design-phase activity and land confirmation, has an 80×24 and a 120×40 file
- **AND** a diff fails the suite with the state name

#### Scenario: the launcher matrix is complete

- **WHEN** the launcher tests run
- **THEN** they cover text intake, file intake, approve, approve-only, reword, reapprove, resume and land
- **AND** they assert that quitting, SIGINT and a crash send no signal to a child

#### Scenario: every event type is exercised

- **WHEN** the fold tests run
- **THEN** one event of every `EVENT_TYPES` member produces its activity line (or the coalesced heartbeat line)
- **AND** a task detail still filters lines by task id

### Requirement: Documentation and the ADR record the UI

`docs/tui.md` SHALL document the layout, the keys including `n`, the intake mode toggle, `a`, `A`,
`w`, `R`, `r`, `x`, `t`, `l` and `?`, the answer semantics, the all-event activity tail and its
log references, the land confirmation and what land removes locally, the flags, the accessibility
rules and the replay mode. `README.md` SHALL gain a section on watching, starting, approving and
landing from the TUI, `docs/cli.md` a `tui` entry that mentions landing a done run, and
`ARCHITECTURE.md` the `packages/tui` row. ADR-0047 SHALL record Ink with its pinned versions, the
lazy second bundle, detached children, the phase-driven overlay, the additive `approval.pending`
event, replay and the local land action, with `## Context`, `## Decision` and `## Consequences`,
and SHALL be listed in `docs/decisions/README.md`. `docs/events.md` SHALL keep documenting
`approval.pending` in the approval family. The ADR MUST NOT contain the capitalised product name,
so the historical scan stays valid.

#### Scenario: the docs cover the UI

- **WHEN** `docs/tui.md`, `README.md` and `docs/cli.md` are read
- **THEN** they describe the views, the all-event tail, the keys including `l`, the flags and the honest answer semantics
- **AND** `docs/cli.md` mentions `docs/tui.md`

#### Scenario: the ADR is valid and indexed

- **WHEN** `docs/decisions/0047-*.md` and the decisions index are read
- **THEN** the ADR starts `# 0047 — `, has the three required sections and names the pinned framework versions
- **AND** the index has a row for it
- **AND** the file does not contain the capitalised product name
