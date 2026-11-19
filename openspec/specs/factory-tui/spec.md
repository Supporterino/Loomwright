# factory-tui Specification

## Purpose
TBD - created by archiving change implement-factory-tui. Update Purpose after archive.

## Requirements

### Requirement: The `tui` command opens the current workspace

The CLI SHALL add `loomwright tui [--replay <file>] [--once] [--ascii]` (the `ai-factory` alias
runs the same command) and register it in the command table so `--help`, per-command help and
shell completion list it. Its help text SHALL start `Usage: loomwright tui` and document every
flag. On a terminal it SHALL open the run list for the current workspace. Without a terminal and
without `--replay` it SHALL print a hint naming `status --watch` and `events --follow` and exit
`1`. `--once` without `--replay`, or a `--replay` path that is missing or unreadable, SHALL be a
usage error and exit `2`. A normal quit and `--once` SHALL exit `0`. The command SHALL resolve the
workspace from `-C` and the process working directory, and SHALL NOT require the install marker to
open the run list.

#### Scenario: a terminal opens the run list

- **WHEN** `loomwright tui` runs in an initialised workspace on a TTY
- **THEN** the run list is shown with the newest run selected
- **AND** the process does not exit until the user quits

#### Scenario: no terminal prints a hint

- **WHEN** `loomwright tui` runs with stdout not a TTY and no `--replay`
- **THEN** stderr names `loomwright status <change-id> --watch` and `loomwright events <change-id> --follow`
- **AND** the exit code is `1`
- **AND** no TUI is rendered and no child process is spawned

#### Scenario: help and completion include the command

- **WHEN** `loomwright --help`, `loomwright tui --help` and shell completion run
- **THEN** `tui` is listed and completed
- **AND** the help documents `--replay`, `--once` and `--ascii`

#### Scenario: bad flags are usage errors

- **WHEN** `tui --once` runs without `--replay`, or `tui --replay ./missing.jsonl` runs against a path that does not exist
- **THEN** the message names the offending flag or path
- **AND** the exit code is `2`

### Requirement: The TUI reads the stream and the read API only

The TUI SHALL build a run's state from `reduce` over `readEvents` followed by `tailEvents` from
the last complete sequence number, and SHALL take run existence, phase, summary, draft, active
lock, driver liveness, queue position and usage from `Factory.status()` and
`Factory.listRuns()`. It MUST NOT read run-state or event files under `.factory/` (the event log,
run state, the lock and the driver files), MUST NOT import `@loomwright/cli`, and MUST NOT
value-import a pipeline, scheduler, gate, lock or state module; type-only imports from
`@loomwright/core` are allowed. The reads it MAY make under `.factory/` are limited to two: its own
spawn log, `.factory/logs/tui-spawn-<timestamp>.log`, which the launcher tails so a failed child's
last lines can be shown; and, for the intake dialog only, the `.factory/requests/*.md` files it
ranks, validates and previews, including the chosen request file. It MUST NOT infer that a run
exists because an event log exists. A
run without an event log SHALL still appear in the list from run state. Gate results, agent roles,
retries and the activity tail SHALL come from events; token and cost totals SHALL come from the
status document.

#### Scenario: no engine imports

- **WHEN** every file under `packages/tui/src` is scanned for imports
- **THEN** none imports `@loomwright/cli` or a relative path outside the package
- **AND** none value-imports a pipeline, scheduler, gate, lock or state module
- **AND** none references a run-state or event path under `.factory/` for reading, the only permitted exceptions being the launcher's own `.factory/logs/tui-spawn-<timestamp>.log` and the intake dialog's `.factory/requests/*.md` listing and preview (including the chosen request file)

#### Scenario: a run exists because run state says so

- **WHEN** the TUI opens a workspace whose newest change has no `.factory/events/<id>.jsonl`
- **THEN** the run is listed with its phase and usage from `status()`
- **AND** its run view shows tasks from run state with an empty activity tail
- **AND** no run is invented for an event log without run state

#### Scenario: live detail arrives from the tail

- **WHEN** a run in the run view appends `task.merged` and `gate.finished`
- **THEN** the task row and the gate column update from those events
- **AND** the header totals do not change until the next `status()` poll

### Requirement: The TUI never drives a pipeline in-process

The TUI MUST NOT call `Factory.run`, `Factory.approve` with continue, or `Factory.resume`.
Long work SHALL run in detached children of the same CLI entry so that quitting the UI, Ctrl-C,
SIGTERM or a crash leaves every run exactly as it would be without the UI. Only commands that write
state or drop a command file without driving a phase (`answer`, `abort`, `retry`) MAY be called
in-process.
The terminal SHALL be restored — alternate screen left, cursor shown, raw mode off — on quit, on
Ctrl-C, on SIGTERM and when rendering throws.

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
- **THEN** `run`, `approve` and `resume` are not called
- **AND** the only write methods called are `answer`, `abort` and `retry`

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
gate results per step, duration and a live activity tail from
`agent.activity` that names a `.factory/logs/` reference where the event carries one; and a footer
listing the keys that are valid in the current state.

#### Scenario: the list is ordered and labelled

- **WHEN** the workspace has three runs and one driver is active
- **THEN** the list is ordered newest first
- **AND** the active run says `active` with its pid, a queued run says `queued #1`, the rest say `idle`

#### Scenario: a task detail shows the evidence

- **WHEN** the user opens a task that failed after one retry and re-ran its gates
- **THEN** the detail names the agent role and duration, the attempt count, each gate with its result and duration
- **AND** the activity tail lists the latest tool lines and the log reference when one exists

#### Scenario: an empty workspace explains itself

- **WHEN** the workspace has no runs
- **THEN** the list says no changes exist yet and names `n` to start one
- **AND** the footer shows `n`, `?` and `q`

### Requirement: A run can be started from the TUI

`n` SHALL open one dialog with two modes toggled by `Tab`, the mode named in the title. In text
mode the dialog SHALL accept a multi-line request with paste and `Ctrl-J` for a newline and submit
on `Enter`; a blank or whitespace-only request MUST be rejected in place without closing. In file
mode the dialog SHALL offer a path field with `.`, `..` and `~` completion, rank
`.factory/requests/*.md` first, accept only a path that exists, is a regular readable file and is
non-empty after trimming, and show the resolved absolute path, the size in bytes and a preview of
about twenty lines; the TUI MUST NOT parse the request. Submitting SHALL launch the argv defined
for intake with `--no-interactive`. While a spawn is in flight the dialog MUST refuse a second
submit. When `Factory.open` rejects because the workspace is not installed, the dialog SHALL show
that message inline instead of throwing. When `status()` names another active change the dialog
SHALL say the new change is drafted under `.factory/drafts/<id>` and queued after approval, and
MUST NOT imply it starts now. After a spawn the dialog SHALL show the spawn log path and its tail
until `run.started` for the new run appears, then open that run's view.

#### Scenario: text intake

- **WHEN** the user types `add a health endpoint`, presses `Enter` and confirms nothing else
- **THEN** one launch happens with the text as a single argv element followed by `--no-interactive`
- **AND** the dialog shows the spawn log path
- **AND** the run view opens when `run.started` arrives

#### Scenario: a blank request is rejected

- **WHEN** the user presses `Enter` on a composer holding only spaces and newlines
- **THEN** the dialog stays open with an inline message
- **AND** no launch happens

#### Scenario: file intake validates

- **WHEN** the user picks `.factory/requests/faster-imports.md`
- **THEN** the dialog shows its absolute path, size and a twenty-line preview
- **AND** submitting launches `run --request <absolute path> --no-interactive`
- **AND** a nonexistent, directory, unreadable or empty file is rejected in place with no launch

#### Scenario: an active change is called out

- **WHEN** a driver is active for another change and the user submits a request
- **THEN** the dialog states the change is drafted under `.factory/drafts/<id>` and queued after approval
- **AND** nothing in the dialog says it starts immediately

#### Scenario: the workspace is not installed

- **WHEN** `Factory.open` rejects with the not-installed message
- **THEN** the dialog shows that message and the `init` hint inline
- **AND** the UI keeps running

#### Scenario: no double submit

- **WHEN** a spawn is in flight and the user presses `Enter` again
- **THEN** the second submit is ignored
- **AND** exactly one child was launched

### Requirement: The approval overlay follows the run's phase

The overlay SHALL open when a run's phase is `awaiting-approval`, not when
`approval.requested` arrives, and SHALL show the run summary and change dir from run state
(`summary` and `draft`), the spec hash from `approval.pending`, the short spec commit and approver
once the stream carries them, and the identity the CLI will record (git `user.email` in the AI
repo). When that identity
is unset the overlay SHALL show the CLI's message and disable every action that records an
approval. Each action SHALL have its own confirmation, never the key that opened the overlay:

- `a` approve and run, the default: launch `approve <id>`; the confirmation says the approval is
  recorded, the spec committed and implementation started locally.
- `A` approve only: launch `approve <id> --no-continue`; the confirmation says nothing is
  implemented, and the overlay then offers `r` and the `loomwright approve <id>` hint.
- `w` reword: launch `reword <id>`; the confirmation names the architect session and says it may
  take long; offered only when `specFindings` is non-empty.
- `R` reapprove: launch `reapprove <id>`; the confirmation names the spec commit it accepts;
  offered only when the stream carries that commit.

After a launch the overlay SHALL be read-only, name the phase it waits for, and close on
`approval.granted` plus the next `phase.changed`. All four actions SHALL go through the same
launcher seam. A non-zero child exit SHALL return the overlay to the actionable state with the log
tail.

#### Scenario: the overlay opens on the phase

- **WHEN** a run's phase becomes `awaiting-approval` and the stream carries `approval.pending`
- **THEN** the overlay shows the summary, the change dir and the spec hash
- **AND** it shows no spec commit until `approval.granted` arrives
- **AND** `a` requires its own confirmation instead of approving on the opening key

#### Scenario: a missing identity disables approval

- **WHEN** `git config user.email` is empty in the workspace
- **THEN** the overlay shows the CLI's message about the missing identity
- **AND** `a`, `A` and `R` are unavailable
- **AND** `w` stays available when findings exist

#### Scenario: approve only changes what the overlay says

- **WHEN** the user confirms `A`
- **THEN** `approve <id> --no-continue` is launched
- **AND** the overlay says nothing is implemented and offers `r` and `loomwright approve <id>`
- **AND** the overlay is read-only and names the phase it waits for

#### Scenario: the actions are gated by their evidence

- **WHEN** a run has no spec findings and no spec commit in its stream
- **THEN** `w` and `R` are not offered
- **AND** the footer lists only the keys that apply

#### Scenario: the overlay closes on the outcome

- **WHEN** `approval.granted` and then `phase.changed` arrive after an approve-and-run
- **THEN** the overlay closes and the run view shows the new phase
- **AND** a non-zero exit instead restores the actionable overlay with the log tail

### Requirement: Questions are recorded and answered later

The TUI SHALL list the `question.raised` records of the selected run from the snapshot. Opening
the questions pane SHALL open the answer prompt directly when a record is `unanswered`, and SHALL
send the answer through `Factory.answer`, which drops a command file the driving process applies
at its next safe point. Because a run started from the TUI has no TTY, the UI SHALL label the
answer "recorded — applies at the next step" and MAY say "answered" only after `question.answered`
arrives, and SHALL point at the run's `questions.md`. The UI MUST NOT wait for the answer to be
applied and MUST NOT block the run.

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

### Requirement: Abort, retry and resume are the remaining controls

`x` SHALL abort the selected run only after a confirmation that names the change id, and SHALL
call `Factory.abort`; the UI SHALL then show the phase from run state. `t` SHALL retry the
selected failed task through `Factory.retry` and SHALL be available only for a failed task. `r`
SHALL resume a paused, aborted or interrupted run by launching the detached `resume <id>` child.
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
- **THEN** both list `n`, the `Tab` intake mode toggle, `a`, `A`, `w`, `R`, `r`, `x`, `t`, `?` and `q`
- **AND** the answer semantics are described in both

### Requirement: Brand tokens are followed without adding a hue

The UI SHALL use lilac `#8E9BEA` for focus and running and coral `#E0714F` only for the approval
gate (banner and overlay), SHALL NOT paint a background, and SHALL take truecolor, 256-colour and
16-colour fallbacks from one token module. Failed, blocked and passed states SHALL be told apart by
glyph, label and weight and MUST NOT introduce another hue. If the palette proves insufficient, the
change SHALL propose a token addition in `design.md` for human approval instead of adding one.

#### Scenario: coral appears only at the gate

- **WHEN** any state other than `awaiting-approval` is rendered
- **THEN** no cell uses the coral token
- **AND** the approval banner and overlay do

#### Scenario: one module owns the colours

- **WHEN** the source is scanned for colour codes
- **THEN** only the token module contains hex values and SGR sequences
- **AND** it exposes truecolor, 256 and 16 variants of each token

#### Scenario: no background is painted

- **WHEN** a frame is rendered
- **THEN** it contains no background SGR parameter for a full-width fill
- **AND** the terminal's own background shows through

### Requirement: Rendering and polling stay bounded

The UI SHALL render at most ten frames per second, batching events that arrive faster, SHALL keep
the activity tail in a ring buffer of the last 2,000 lines, and SHALL poll `status()` at most once
per second plus immediately after a spawn. Memory and retained event objects MUST NOT grow over a
long run.

#### Scenario: a burst is coalesced

- **WHEN** 500 events arrive within one frame interval
- **THEN** the UI renders at most one frame for that interval
- **AND** the frame reflects every event

#### Scenario: the tail is capped

- **WHEN** a run emits 100,000 activity events
- **THEN** the tail holds exactly the last 2,000 lines
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
replayed, and SHALL disable every write action (intake, approve, reword, reapprove, resume, abort,
retry, answer) and the `status()` poll. `--once` SHALL render exactly one frame through the same
component tree into an in-memory stdout, write that text through the command's output and exit
`0`. Replay MUST NOT spawn a child. The checked-in fixtures SHALL include the stub e2e logs and a
stream that ends at the approval gate so the overlay can be replayed.

#### Scenario: replay shows the recorded screens

- **WHEN** `tui --replay test/fixtures/tui/approval-gate.jsonl` runs
- **THEN** the run view and the approval overlay render from the recorded events
- **AND** the pending spec hash comes from the recorded `approval.pending`

#### Scenario: once prints one frame

- **WHEN** `tui --replay <file> --once` runs with stdout not a TTY
- **THEN** exactly one frame is written and the exit code is `0`
- **AND** the frame contains no cursor-control sequence

#### Scenario: replay is read-only

- **WHEN** any key that would write is pressed in replay
- **THEN** the UI says the stream is replayed and read-only
- **AND** the launcher and `Factory` write methods are never called

### Requirement: Tests pin the behaviour

The suite SHALL contain unit tests for the pure view-model layer with no Ink import, frame
snapshots at 80×24 and 120×40 for no runs, running graph, failing task, awaiting approval,
question open, finished, new run (text), new run (file), approve-and-run confirm, approve-only
confirm and queued after approval, launcher tests asserting argv, flags, `detached`, `stdio`,
`cwd`, `-C` and the absence of a signal on quit, SIGINT and crash, dialog tests (blank text,
missing, unreadable and empty file, queued-after-active wording, disabled before `init`, no second
spawn), keybinding tests (approve confirm, abort confirm, quit restores the terminal),
`approval.pending` reduction and a replay fixture that shows the approval gate.

#### Scenario: the view-model is tested without Ink

- **WHEN** the view-model suite runs
- **THEN** it imports no Ink or React module
- **AND** it covers the header, task order (as stored, i.e. tasks.md plan order), gates, questions
  and approval sections

#### Scenario: every screen has both sizes

- **WHEN** the frame snapshots run
- **THEN** each of the eleven states has an 80×24 and a 120×40 file
- **AND** a diff fails the suite with the state name

#### Scenario: the launcher matrix is complete

- **WHEN** the launcher tests run
- **THEN** they cover text intake, file intake, approve, approve-only, reword, reapprove and resume
- **AND** they assert that quitting, SIGINT and a crash send no signal to a child

### Requirement: Documentation and the ADR record the UI

`docs/tui.md` SHALL document the layout, the keys including `n`, the intake mode toggle, `a`, `A`,
`w`, `R`, `r`, `x`, `t` and `?`, the answer semantics, the flags, the accessibility rules and the
replay mode. `README.md` SHALL gain a section on watching, starting and approving from the TUI,
`docs/cli.md` a `tui` entry, and `ARCHITECTURE.md` the `packages/tui` row. ADR-0047 SHALL record
Ink with its pinned versions, the lazy second bundle, detached children, the phase-driven overlay,
the additive `approval.pending` event and replay, with `## Context`, `## Decision` and
`## Consequences`, and SHALL be listed in `docs/decisions/README.md`. `docs/events.md` SHALL
document the new event in the approval family. The ADR MUST NOT contain the capitalised product
name, so the historical scan stays valid.

#### Scenario: the docs cover the UI

- **WHEN** `docs/tui.md`, `README.md` and `docs/cli.md` are read
- **THEN** they describe the views, the keys, the flags and the honest answer semantics
- **AND** `docs/cli.md` mentions `docs/tui.md`

#### Scenario: the ADR is valid and indexed

- **WHEN** `docs/decisions/0047-*.md` and the decisions index are read
- **THEN** the ADR starts `# 0047 — `, has the three required sections and names the pinned framework versions
- **AND** the index has a row for it
- **AND** the file does not contain the capitalised product name

### Requirement: The published package ships the UI lazily

`bun run build` SHALL produce `packages/cli/dist/tui.js` in addition to `dist/cli.js`, and the
`tui` command SHALL load it with a dynamic import that the CLI bundle does not statically include,
falling back to the `@loomwright/tui/entry` workspace entry when running from source. Other commands
MUST NOT pay the TUI's startup cost. The tarball baseline SHALL gain `package/dist/tui.js`, and the
change SHALL record the size delta and justify anything over 1 MB in the final report.

#### Scenario: the second entry exists and is lazy

- **WHEN** `bun run build` runs
- **THEN** `packages/cli/dist/cli.js` and `packages/cli/dist/tui.js` exist
- **AND** `dist/cli.js` does not contain the Ink module graph
- **AND** `node dist/cli.js --version` does not load `dist/tui.js`

#### Scenario: no startup regression

- **WHEN** `--version` is timed before and after the change
- **THEN** the measured time is recorded in the final report
- **AND** no command other than `tui` imports the TUI entry

#### Scenario: the tarball carries both entries

- **WHEN** `npm pack --dry-run --json` runs in `packages/cli`
- **THEN** the file list contains `package/dist/cli.js` and `package/dist/tui.js`
- **AND** the recorded delta is reported with the change

### Requirement: Protected files, gate scripts and scope stay untouched

This change MUST NOT edit `factory.config.jsonc`, `factory.lock.json`, `.opencode/**`,
`openspec/specs/**`, `AGENTS.md` or `factory-records/**`, and MUST NOT change the root gate scripts
`format:check`, `lint`, `typecheck` and `test`. The final report SHALL name every protected-file
edit the change would need, or say there is none, list the follow-ups, and record the tarball size
delta and the `--version` timing.

#### Scenario: the protected paths have no diff

- **WHEN** the change's diff is inspected
- **THEN** it contains no edit under the protected paths
- **AND** the gate scripts keep their exact commands

#### Scenario: the report lists the follow-ups

- **WHEN** the final report is read
- **THEN** it lists the web UI, daemon, remote nodes, mouse, themes, the unexposed pause control and the remaining out-of-scope items
- **AND** it says whether a protected-file edit is needed
