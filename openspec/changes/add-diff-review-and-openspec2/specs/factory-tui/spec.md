## MODIFIED Requirements

### Requirement: The run list and run view show the whole run

The TUI SHALL show a run list ordered newest first with each run's id, summary, phase, role (active, queued at its position, or idle), token and cost totals, elapsed time and the number of recorded spec findings when there are any. Opening a run SHALL show a header with the run id, phase, elapsed time, token and cost totals and lock status; a task list in the order the run state carries (the `tasks.md` plan order, not re-sorted by `deps`) with each task's status, repo, attempt and title; a task detail pane with the agent role, model, retries, gate results per step, duration and the activity scoped to that task; and a footer listing the keys that are valid in the current state. The rendered frame SHALL never be taller than the terminal's rows.

The activity tail SHALL be built from every run event, whatever the phase and whether or not a task is running. Every event type the protocol defines SHALL fold into an activity line, except that repeated `heartbeat` events update the newest heartbeat line in place instead of adding a line each, so the tail carries at most one heartbeat line between bursts of work. Each line SHALL carry a source label — the task id, the install repo or the step when the event names one, and `run` otherwise — a kind label naming the event family — except `agent.activity`, whose kind is the activity kind it carries (`tool`, `step-done`, …) — and readable text. A line whose event carries a truncation reference (`ref`, or `gate.finished.outputRef`) SHALL name that `.factory/logs/` path. `run.*`, `phase.changed`, `task.*`, `gate.*`, `agent.*`, `install.*`, `question.*`, `approval.*`, `usage.delta`, `progress.line` and `heartbeat` SHALL therefore be visible in the run view, not only the agent activity of a task phase.

The task detail's activity SHALL be derived from the run's task table and the emitted step, as defined by "Activity is scoped to the task it belongs to"; it SHALL list only the lines whose step is that task's id. The overview's compact tail SHALL keep a floor of four rows; when the terminal is too short, the task graph SHALL scroll instead of taking the tail's floor away.

At 100 columns and wider the run view SHALL show the run-level tail beside the task graph when no task is selected. Below 100 columns it SHALL show the task graph followed by the run-level tail, sized to the rows left; a selected task's detail SHALL replace both.

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
- **THEN** the detail for `first` lists only the `first` lines
- **AND** the `review:app`, `app` gate and `second` lines stay out of that detail
- **AND** the run-level tail still carries the run lines, the review and gate lines, the `second`
  lines and the `api` lines

#### Scenario: a task detail shows the evidence

- **WHEN** the user opens a task that failed after one retry and re-ran its gates
- **THEN** the detail names the agent role and duration, the attempt count, each gate with its result
  and duration
- **AND** the activity tail lists the latest tool lines and the log reference when one exists

#### Scenario: the activity tail appears in one pane

- **WHEN** the run view renders at 80 columns with no task selected
- **THEN** the task graph is followed by the run-level tail of at least four rows
- **AND** selecting a task replaces both with that task's detail

#### Scenario: the unfocused tail carries everything

- **WHEN** no task is selected and the run has lines from several tasks, a `review:` step and the run
- **THEN** the `Activity` section lists every retained line
- **AND** selecting a task narrows that section to the task's own lines

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

### Requirement: Activity is scoped to the task it belongs to

One pure function SHALL map an activity line to the scopes it belongs to, using the run state's task-to-repo table and the step the event named. A line whose step is a task id SHALL belong to that task; a line whose step is `review:<repo>` or `explore:<repo>` SHALL belong to that repo; a line whose step is a repo named by a task SHALL belong to that repo; every other step SHALL belong only to the run. A task's activity SHALL be the lines whose step is that task's id; the reviewer, explorer, install and full-suite gate work for its repo MUST NOT appear in the task's detail. The repo scope SHALL carry that repo's lines, and the run scope SHALL carry every retained line. The mapping SHALL live in one module with tests and MUST NOT be re-implemented in a view.

#### Scenario: reviewer and full-suite lines join the task

- **WHEN** a task `first` in repo `app` has `task.started`, `agent.activity` and `gate.finished` lines whose step is `first`, and the run also has `review:app` lines and `gate.finished` lines whose step is `app`
- **THEN** the detail for `first` lists only the three `first` lines
- **AND** the `review:app` and `app` gate lines are absent from that detail
- **AND** the `app` repo scope still carries them

#### Scenario: the repo scope keeps the reviewer and full-suite lines

- **WHEN** the pane is in the `app` repo scope for a run with `first` lines, `review:app` lines and `app` gate lines
- **THEN** the repo scope lists all three sets
- **AND** every line keeps its own step label

#### Scenario: the tester task's activity joins its repo

- **WHEN** the run has a tester task `test-first` in repo `app` with `agent.activity` lines and a task `first` in the same repo
- **THEN** the detail for `first` does not list the `test-first` lines
- **AND** the detail for `test-first` lists them
- **AND** the `app` repo scope lists both sets

#### Scenario: another repo's lines stay out

- **WHEN** the run has a task `second` in repo `api` with lines and a `review:api` step
- **THEN** the detail for `first` in repo `app` lists neither
- **AND** the detail for `second` lists the `second` lines
- **AND** the `api` repo scope lists both sets

#### Scenario: the task's own lines stay

- **WHEN** a task has `task.started`, `agent.activity` and `gate.finished` lines whose step is its id
- **THEN** its detail lists all three

#### Scenario: the contract review stays run-scoped

- **WHEN** the run emits `agent.activity` for step `contract-review` and contract-fix task lines for repo `app`
- **THEN** the `contract-review` lines appear in the run scope
- **AND** the contract-fix task's lines appear in that task's detail and in the `app` repo scope
- **AND** the `first` task's detail does not list the contract-fix lines

#### Scenario: the run scope carries everything

- **WHEN** the log pane is in the run scope
- **THEN** it lists every retained line, including the ones a task or repo scope includes

## ADDED Requirements

### Requirement: A done run offers a pre-land diff

A `done` run SHALL offer `d` in its footer, before `l land`, and `d` SHALL open a full-height, read-only diff pane titled `Diff — <change-id>`. The pane SHALL show the change's patch against each touched repo's land base with one header per repo, and SHALL scroll with `j`/`k`, `PgUp`/`PgDn` and `g`/`G`; `Esc` SHALL close it and return to the run view. The footer MUST NOT offer `d` for any other phase or in replay, and pressing `d` there MUST do nothing. The pane MUST NOT write, merge, fetch or read a log file. A read failure SHALL show its message as a notice and leave the run view open. The rendered frame, including the pane, SHALL never be taller than the terminal's rows.

#### Scenario: a done run opens the diff

- **WHEN** the selected run is `done` and the footer shows `d diff` before `l land`
- **THEN** pressing `d` reads the change diff and opens a pane titled `Diff — <change-id>`
- **AND** the pane lists each repo's header and patch lines
- **AND** no write, merge or fetch is performed

#### Scenario: other phases do not offer a diff

- **WHEN** the selected run is `implementing`, `paused` or `awaiting-approval`
- **THEN** the footer does not show `d diff`
- **AND** pressing `d` opens no pane

#### Scenario: the diff pane scrolls and closes

- **WHEN** the diff pane holds more lines than the body and the user presses `PgDn`, `G`, `g` and `Esc`
- **THEN** the offset moves by a page, to the end and to the start
- **AND** `Esc` closes the pane and returns to the run view
- **AND** the frame stays within the terminal rows

#### Scenario: replay does not read a diff

- **WHEN** `tui --replay` shows a done run and the user presses `d`
- **THEN** the footer does not advertise `d diff`
- **AND** no pane opens and no diff is read

#### Scenario: a diff read failure is shown as a notice

- **WHEN** `d` is pressed and the diff reader rejects
- **THEN** the run view shows the reader's message as a notice
- **AND** no diff pane opens
