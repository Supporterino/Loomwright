# Design — fix-tui-findings-log-styling

## Context

Six defects were reported from real use of the terminal UI. They are one change because they share
two causes: the view-model throws away information the read API and the event stream already carry
(findings, a run's repo per step, a row budget for the region being rendered), and the set of
"render everything" components has no shared notion of a viewport. Fixing the log without fixing the
budget leaves the frame drifting; fixing findings without a reword panel leaves the key inert.

Constraints: everything stays in `packages/tui` plus `docs/tui.md`, the `factory-tui` delta, the ADR
and a changeset. No pipeline change, no new event type, no new command, no CLI flag change, no new
dependency and no Ink upgrade. Clipping has to work on Ink 6.4, whose `height` + `overflowY` does not
clip; the frame must therefore be built from already-sliced rows.

### Baseline: 1.2.0 versus `main`

The defects were seen on the released `@loomwright/cli` 1.2.0. `main` is unreleased and ahead of it;
the pending minor changeset `tui-activity-tail-and-land` is what `main` has and 1.2.0 does not.

| Reported defect                              | 1.2.0                                                   | `main` today                                                                                              | This change                                                             |
| -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Findings/reword invisible and unreachable    | no findings state; `w` only in the overlay, gated on findings | same: findings used only as a count in `evidenceOf`, `w` still only in the overlay                    | findings state, marker, banner, panel, reword from the run view         |
| Frame loses its position                     | list maps every run, `height` + `overflowY="hidden"`    | same; `frame.tsx` even hardcodes `rows - 6` for the list preview                                          | row budgets and clamped offsets in the view-model                       |
| Answer or navigate, not both                 | `j`/`k`/arrows disabled while a draft exists             | same                                                                                                       | composer is a separate focus; auto-advance                              |
| A task's log is the wrong log                | `taskDetail` filters `line.step === row.id`             | same                                                                                                       | one derived scope function (task, repo, run)                            |
| The log has no room and no view              | **no single-pane activity tail at all**                 | single-pane tail exists (`singlePaneTailRows`), but budgets can reach `0` and there is no scroll offset   | keep the tail, add the four-row floor and the full-height scoped pane   |
| Low styling                                  | flat rows, summary never rendered                       | same (the run list still does not render `summary`)                                                       | titles, alignment, padding, muted metadata, selected-row emphasis       |

Do not re-fix what `main` already has: the single-pane tail (this change only gives it a floor) and
the `land` action and its key (1.2.0 has neither). `main`'s `land` behaviour must keep working; this
change does not touch it beyond the shared footer and frame budget.

**Verification note.** This session had no shell and no graph (both permission-denied), so no `git`
tag inspection was possible. The baseline above is read from `main`'s source plus the pending
changesets; the change's own tasks re-check each reported scenario against the tag read-only, with
`git show 1.2.0:<path>`, and the final report names what was confirmed there. Never check the tag
out: the change branch stays checked out for the whole change.

## Decisions

### 1. Findings are view-model state, not data to add

`Factory.status().runs` already carries `specFindings` (severity, file, line, problem, fix, impact)
and `pausedReason`. `RunDetail` gains both and `RunListItem` gains the finding count; nothing new is
read from `.factory/`, no event field is needed, and the existing read-only rule in the
`factory-tui` spec stays intact. Rejected: deriving findings from the run's approval or from a
re-read of `run.json`, both of which break the "read API only" requirement.

The marker and the banner use the word, not only a glyph: a paused run with findings must say
"reword needed" in words, because a glyph is not a sentence and colour is not always available.

The marker uses the gate **glyph** (`!`) and label, not the coral **hue**: the existing spec pins
coral to the approval gate, and the accessibility suite asserts no coral outside it. Rejected:
reusing `TOKENS.approval` in the run list, which would need a token-rule change and a new hue
decision. Anything that genuinely needs a new token is proposed here instead of shipped; none is.

### 2. Reword mirrors the CLI's preconditions exactly

The CLI's `CHANGE_PHASES` is `queued`, `implementing`, `reviewing`, `contracts`, `full-suite`,
`closing`, `paused`, `aborted`, plus: not `done`, approved, the spec on `change/<id>`, and the active
claim free. The view-model can only know the phase, the driver liveness and whether another change is
active, so the rule is:

- **available** when the phase is in that set and no driver is alive;
- **inert with `pid <n>`'s reason** when this run's driver is alive (the CLI refuses `${id} is being
  driven by pid <pid>; stop it first`);
- **inert with the other change's reason** when a different change holds the active lock;
- **absent** for `design`, `awaiting-approval` and `done`, and in replay.

`w` at the gate is removed rather than kept: `awaiting-approval` is not in `CHANGE_PHASES`, so the
current overlay offers a key whose child always fails. The overlay's actions become the three the
phase accepts (`a`, `A`, `R`); reword lives where it works. Rejected: hiding the failure by keeping
`w` and letting the child explain, which is exactly the reported bug.

The panel collects a prompt and shows the findings as a new `PanelView["kind"] = "reword"`, so the
generic box renders it and the frame budget applies to it unchanged. It spawns `reword <id>` with no
prompt when there are findings and the prompt is empty, and `reword <id> --prompt <text>` with the
trimmed prompt as a single argv element otherwise (internal newlines preserved; no shell). Without
findings the prompt is
required, matching the CLI's `has no spec findings to reword` refusal, and the confirm stays disabled
until it is non-empty. Per-finding `--finding` selection, `--dry-run` and editing findings stay
follow-ups.

### 3. Task scope is one derivation, from data already present

The emitted steps are: the task id for implementer/tester/conflict/install work, `review:<repo>` for
a reviewer, `explore:<repo>` for an explorer, the repo name itself for full-suite gates,
`contract-review` for the single cross-repo contract session, and `run`/`design`/`intake`/`reword`
for the rest. The run state gives every task id and its repo. So one pure function:

| Step                                                      | Task            | Repo   |
| --------------------------------------------------------- | --------------- | ------ |
| a task id in the run state                                | that task       | its repo |
| `review:<repo>` / `explore:<repo>`                        | —               | `<repo>` |
| a repo named by a task in the run state (full-suite gates) | —              | `<repo>` |
| `contract-review`, `run`, `design`, `intake`, `reword`    | —               | —      |

A task's scope is the lines whose step is that task's id **or** whose repo is the task's repo; the
repo scope is the second half alone; the run scope is everything. Each line keeps its step label, so
a reviewer line in a task detail still reads `review:app`. This deliberately includes the other tasks
in the same repo — that is how a separate tester task's activity reaches the implementer's detail.

Why no additive `repo` event field: the only cross-repo step, `contract-review`, covers every
contract in one session, so a single `repo` value would be a lie for it; every other step is
derivable today. Adding a field would not help the one case that cannot be scoped and would put a
second source of truth beside the run state's task table. The fallback stays available for a future
step that genuinely runs for one repo and names none: add one optional `repo` field then, in one
additive protocol task.

### 4. The log is a destination; the overview keeps a floor

A new `PanelView["kind"] = "activity"` renders a full-height, read-only pane with a scope in its
title. `L` opens it for the current scope (the selected task's, else the run's), `Tab` cycles
run → task → repo and skips a scope the run cannot name (no tasks ⇒ no task scope; a task whose repo
is unknown ⇒ no repo scope). `f` toggles follow, default on; follow pins the viewport to the newest
line, non-follow leaves it alone as data arrives. `Esc` returns to the view it was opened from.

The overview keeps a compact tail with a **four-row floor**; the task graph and the two-pane preview
are the regions that shrink and scroll. Rejected: removing the overview tail entirely (the request
keeps a compact tail) and letting the graph keep every row (that is the current bug: a 12-task run
gets zero tail rows). The panes own no Ink-side scrolling and no mouse; the offsets are numbers in
the view-model, so a frame test can assert them.

### 5. Scroll is view state and the frame is sliced, not clipped

New `scrollOffset` fields (run list, task graph, questions, log) live in the view-model input and
output, with one clamp helper: the offset is limited to `[0, max(0, length - size)]` on every data
change and resize, and a selection move clamps it so the selected row is inside the window. Views
slice; `frame.tsx` stops relying on `height` + `overflowY` and stops hardcoding `rows - 6` — it uses
the same budget helpers the views use. Panels are bounded too: a panel body is at most
`rows - chrome` lines, and the panels that own a scroll offset (findings, reword, questions, log) use
it. Rejected: a second Ink component for scrolling, and mouse input, both of which contradict the
key-only accessibility rule.

### 6. The gate overlay collapses to the banner

At `idle`/`failed`, `Esc` sets a collapsed flag: the overlay disappears, the coral banner stays and
names `a`, `A`, `R` and the other action keys; pressing one reopens the overlay in `idle` (or in the
`failed` state it left) and behaves as before. `Esc` during `confirming`, `launching` or `waiting`
does nothing new and the footer says why (`waiting for the child; Esc does nothing`). Rejected:
closing the overlay entirely (the banner would have to re-discover the phase) and making the banner
non-interactive (the user would lose the approval screen with no way back).

### 7. Questions: two focuses, one pane

`QuestionsState` gains a focus (`"record" | "composer"`), a recorded-step set and a scroll offset.
`Enter` on the selected unanswered record opens the composer; printable keys (including `j`/`k`)
append, so a letter never navigates by accident; `Ctrl-J` inserts `\n`; backspace deletes; `Enter`
records through `Factory.answer`; `Esc` discards the composer and stays in the pane, a second `Esc`
closes it. After a successful record the selection advances to the next unanswered record and the
pane stays open, so a user can answer several questions without closing it. The recorded step is
remembered outside the draft so the row still reads `recorded — applies at the next step` after the
advance. While a composer is open, arrows and page keys are inert and the footer says `Esc leaves the
composer to navigate`. Rejected: letting arrows navigate while keeping a draft, which attaches one
record's text to another record and needs a per-record draft map the UI does not otherwise justify.

### 8. Styling only with the existing tokens

Lilac focus/running, coral only at the gate, muted metadata, bold titles, one column of padding, a
blank line between sections, fixed gate columns (`glyph name status duration`) and two-column
label/value facts. No background, no reverse video, no new hex; `NO_COLOR`, `--ascii`, `TERM=dumb`
and a non-UTF-8 locale behave as they do now. The ASCII set has no en dash, so window titles use the
glyph set's dash, exactly like the panel titles do today.

## Contract changes

None. The TUI's contract remains the read API, the event stream and the CLI argv it spawns. The spec
delta changes behaviour, not types: no protocol schema, no Helm values, no CLI flag.

## Risks

- **Baseline read, not run.** The 1.2.0 release could not be executed in this session, so a few
  "already fixed on `main`" claims rest on `git show 1.2.0:<path>` and the pending changesets rather
  than on a live run. Each task re-checks its reported scenario read-only against the tag before
  editing; anything already fixed is dropped and reported. Do not check the tag out — the change
  branch must stay checked out.
- **The gate's key list.** The intake's acceptance line lists `a`/`A`/`w`/`R` as the keys that reopen
  the collapsed banner, while its own rule says the overlay may offer `w` only when the phase accepts
  it — and `awaiting-approval` never does. The change follows the rule (the CLI would refuse the
  child), so the banner names and reopens `a`, `A` and `R`; reword is one screen away in the run view.
- **Contract phase scoping.** The request asks for contract activity in a task detail; the honest
  derivation puts the single cross-repo `contract-review` session in the run scope and the
  contract-fix tasks (which have a repo) in their repo's scope. A human may want the session
  duplicated per repo, which would need the additive `repo` field or a config read; see the open
  question.
- **"Approved" is approximated by the phase set.** The view-model cannot read the approval file, so a
  run that was aborted or paused before it was ever approved can still show `w`; the child then
  reports `${id} is not approved` in the log tail. The alternative — reading
  `.factory/approvals/` — would break the read-only rule, so the approximation stays.
- **Step-name coupling.** The scope function hardcodes today's step names. One module and its tests
  own that coupling, so a pipeline rename breaks one test rather than several views; it is still a
  coupling worth knowing about.
- **Fixture churn.** Every rendering task regenerates the frames it changes, so the diff of
  `test/fixtures/frames/` is large by design; review it as the visual record of the change.
- **Release version.** 1.3.0 is derived from the pending minor changeset. If a major or minor ships
  before this change lands, the changeset body's version is stale; the bump type (minor) stays
  correct.
- **No protocol fallback used.** If the scope derivation proves insufficient during implementation,
  the fallback is exactly one additive optional `repo` field, and the task chain would need a
  protocol sub-task before the log pane; the plan does not assume it.

## Follow-ups (out of scope)

Mouse, themes or background painting, per-finding `--finding` selection, `reword --dry-run` from the
TUI, log search/filter, copying log lines, new event types, a web or remote UI, editing findings,
the task graph or `questions.md` from the UI.
