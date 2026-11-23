# typed-event-stream Specification

## ADDED Requirements

### Requirement: The `status --watch` suite is deterministic

The `status --watch` tests MUST drive their assertions from observed frames — the first frame
plus one further frame, event- or interval-triggered — and then abort, or inject the clock and
interval. They MUST NOT assert a frame count inside a fixed wall-clock window. The suite MUST
pass across repeated parallel runs.

#### Scenario: two observed frames, then abort

- **WHEN** the watch starts on a change with no event log
- **THEN** the test waits until two `updated ` frames have been written
- **AND** it aborts the watch and awaits the exit code
- **AND** it uses no `AbortSignal.timeout(80)` or other fixed frame window

#### Scenario: an event-triggered frame is awaited

- **WHEN** an event is appended to the watched change's log
- **THEN** the test waits for the frame that reflects the change
- **AND** then aborts and asserts the rendered state

#### Scenario: repeated parallel runs stay green

- **WHEN** the watch suite is run repeatedly with `bun test --parallel`
- **THEN** every run passes
- **AND** the final report records the number of repetitions
