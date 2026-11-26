# factory-tui Specification

## MODIFIED Requirements

### Requirement: Questions are recorded and answered later

The TUI SHALL list the `question.raised` records of the selected run from the snapshot. Opening the questions pane SHALL select the first unanswered record, or the first record when none is unanswered, and SHALL send an answer through `Factory.answer`, which persists the answer immediately when no live driver owns the run and otherwise drops a command file the driving process applies at its next safe point. The UI SHALL read `answered — <answer>` from the refreshed run state once the answer is persisted, including after a restart; the label `recorded — applies at the next step` SHALL describe only the live-driver window and SHALL NOT be the settled state of an answer the core persisted. The UI MAY say "answered" after `question.answered` arrives, and SHALL point at the run's `questions.md`. The UI MUST NOT wait for the answer to be applied and MUST NOT block the run.

`Enter` on a selected unanswered record SHALL open a composer. In the composer, printable keys (including `j` and `k`) SHALL append text, `Ctrl-J` SHALL insert a newline, backspace SHALL delete the last character, `Enter` SHALL record the answer, and `Esc` SHALL discard the composer and keep the pane open. `j`/`k` and the arrow keys SHALL navigate the records whenever no composer is open, and a second `Esc` SHALL close the pane. While a composer is open, navigation keys SHALL leave the composer alone and the footer SHALL say `Esc leaves the composer to navigate`, so no key is silently dead. An empty or whitespace-only answer SHALL be refused in place with the existing notice. Only one answer SHALL be in flight at a time.

After a successful record the pane SHALL stay open, SHALL keep the row reading `recorded — applies at the next step` until the answer is persisted or `question.answered` arrives, and SHALL advance the selection to the next unanswered record. When no unanswered record remains the selection SHALL stay on the recorded record. Many records SHALL scroll inside the pane and the selected record SHALL always be visible.

#### Scenario: an answer is recorded, then confirmed

- **WHEN** the user answers an `unanswered` question
- **THEN** `Factory.answer` is called with the answer and the question
- **AND** the row says `recorded — applies at the next step` until `question.answered` arrives
- **AND** the row then says `answered` with the recorded answer

#### Scenario: an idle answer is persisted and shown answered

- **WHEN** the user answers an `unanswered` question on a run with no live driver
- **THEN** `Factory.answer` is called with the answer and the question
- **AND** after the refresh the row reads `answered — <answer>` from the run state
- **AND** reopening the pane in a fresh TUI reads the same row and offers no composer

#### Scenario: a driven answer stays recorded until the driver applies it

- **WHEN** a live driver owns the run and the user answers an `unanswered` question
- **THEN** the row says `recorded — applies at the next step` until `question.answered` arrives
- **AND** the row then says `answered` with the recorded answer

#### Scenario: the run is not asked

- **WHEN** a run started from the TUI raises a question
- **THEN** the question is listed as unanswered and nothing waits on stdin
- **AND** the pane points at `openspec/changes/<id>/questions.md` or its draft equivalent

#### Scenario: a skipped question is shown as skipped

- **WHEN** the snapshot holds a record with status `skipped`
- **THEN** the row says `skipped` and offers no prompt

#### Scenario: answer then advance keeps the pane open

- **WHEN** the pane holds three records and the first two are unanswered and the user answers the first
- **THEN** the second record is selected and the pane is still open
- **AND** the first record reads `recorded — applies at the next step` until the answer is persisted, then `answered`
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
