# factory-tui Specification

## MODIFIED Requirements

### Requirement: Rendering and polling stay bounded

The UI SHALL render at most ten frames per second, batching events that arrive faster, SHALL keep
the activity tail in a ring buffer of the last 2,000 lines whatever their event type, and SHALL
poll at most once per second plus immediately after a spawn. While a run is open the poll SHALL
normally request only that run's status (`status(<selected id>)`) and MUST NOT read another run's
usage ledger or the workspace-usage slice. The full document — every run's usage and the
workspace-usage slice — MAY be read only on the initial load, on a run-list refresh, while a spawn
started from the run view is pending and no per-run call can discover it yet, and after the
selected run disappears because landing removed it, where the per-run call cannot resolve; a
control action that settles a land MAY use the same refresh. Folding SHALL stay O(1) per event,
and coalesced heartbeats SHALL NOT grow the retained state. Memory and retained event objects MUST
NOT grow over a long run.

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
- **THEN** at most ten status calls were made for the selected run
- **AND** a spawn triggers one immediately

#### Scenario: an open run reads only its own usage ledger

- **WHEN** a poll runs with run `add-health` open and another run on disk
- **THEN** the status call names `add-health`
- **AND** no call without an id is made during that poll
- **AND** the other run's usage ledger is not read

#### Scenario: a pending spawn takes one full refresh

- **WHEN** a spawn is started from the run view and the new run cannot be found by id yet
- **THEN** the poll takes one full `status()` refresh to discover it
- **AND** once the new run is selected, later polls name it again

#### Scenario: a landed run falls back to the full refresh

- **WHEN** the selected run's per-run status call reports that the run is gone
- **THEN** the poll takes one full refresh to settle the landing
- **AND** the other runs' usage ledgers may be read only by that refresh

#### Scenario: the run list still paints every run's usage

- **WHEN** the run list is shown or refreshed
- **THEN** the status call has no id and its document carries every listed run
- **AND** each listed run carries its own usage
- **AND** the open-run poll is not used for the list

## ADDED Requirements

### Requirement: Status and control wiring live behind injectable modules

`packages/tui/src/model/status.ts` SHALL own the status source used by the one-second poll, and
`packages/tui/src/model/controls.ts` SHALL own `performControl`, the resume and land guards,
`startResume`, `startLand`, `startReword` and the resume, land and reword state transitions.
`UiData` and its pure helpers SHALL live in `packages/tui/src/model/ui-data.ts`. `entry.tsx`
MUST NOT define those symbols; it MAY re-export them so existing importers keep working. The
entry module SHALL be at most 1,600 lines.

#### Scenario: the entry is a shell

- **WHEN** `packages/tui/src/entry.tsx` is read
- **THEN** it does not define `performControl`, `createResumeGuard`, `createLandGuard`,
  `startResume`, `startLand`, `startReword`, `createStatusSource` or `UiData`
- **AND** it is at most 1,600 lines

#### Scenario: the controllers are testable without Ink

- **WHEN** the extracted status and control modules are imported by their unit tests
- **THEN** neither module imports Ink or React
- **AND** the tests pass a fake `Factory` and launcher without rendering a terminal

#### Scenario: behaviour is unchanged

- **WHEN** the existing controls, replay, approval and view suites run
- **THEN** they pass with their existing assertions
- **AND** no key, argv, notice or frame changes
