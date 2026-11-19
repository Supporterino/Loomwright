# typed-event-stream Specification

## ADDED Requirements

### Requirement: The approval gate is announced before it is granted

The protocol SHALL add the additive event `approval.pending` with the payload
`{ specHash, changeDir }`, where `specHash` is the checkbox-normalised hash the later approval will
record and `changeDir` is the change directory relative to the workspace root
(`openspec/changes/<id>`, or `.factory/drafts/<id>/openspec/changes/<id>` for a drafted change).
`PROTOCOL_VERSION` SHALL stay `1` and the envelope `v` SHALL stay `1`.
Design SHALL emit one `approval.pending` each time it sets the phase to `awaiting-approval`, and
MUST NOT emit it when the spec does not validate and the phase becomes `paused`. The event SHALL
carry no spec commit and no approver: `approval.requested` and `approval.granted` stay the only
source for the spec commit and the approver. `reduce` SHALL carry the payload as
`pendingApproval: { specHash, changeDir } | null`, cleared by `approval.granted`; an older stream
without the event SHALL reduce to `null`. The terminal sink SHALL print nothing for it, so the
`run` output is unchanged, and the change SHALL update `EVENT_TYPES`, the union, `docs/events.md`,
the event goldens and the replay fixtures in the same task.

#### Scenario: design announces the gate with the hash

- **WHEN** design finishes a change that validates and sets the phase to `awaiting-approval`
- **THEN** the stream contains one `approval.pending` with `specHash` and `changeDir`
- **AND** no `approval.requested` or `approval.granted` is emitted at that point
- **AND** the `specHash` equals the hash the later `approve` records

#### Scenario: no gate is announced for an invalid spec

- **WHEN** design pauses because the spec does not validate
- **THEN** no `approval.pending` is emitted
- **AND** `reduce` leaves `pendingApproval` as it was

#### Scenario: the event is additive

- **WHEN** `RunEvent.parse` receives an `approval.pending` event and an older reader ignores it
- **THEN** the event validates with `v: 1`
- **AND** `PROTOCOL_VERSION` is still `1`
- **AND** a stream without the event still reduces and replays as before

#### Scenario: reduce exposes the pending gate

- **WHEN** `reduce` replays a stream up to and past `approval.pending`
- **THEN** `pendingApproval` holds the hash and the change dir
- **AND** `approval.granted` clears it and sets `approval`
- **AND** the parity check against the run state stays green, because `pendingApproval` is not part of the projection

#### Scenario: the terminal output is unchanged

- **WHEN** the `single` and `submodules` scenarios run with the new event
- **THEN** their stdout and stderr still equal the baseline goldens
- **AND** the committed event goldens contain the new line with normalised values
