# documentation Specification

## ADDED Requirements

### Requirement: E2E transcripts are classified by recorded version

Every file under `docs/e2e/` SHALL be classified by the version in its
`Recorded <date> with … (<product> <version>)` header. A transcript recording a version at or
below `0.12.0` is historical: it MUST NOT contain `Loomwright`. A transcript recording a newer
version is current: it MAY contain `Loomwright`, and the suite MUST accept it without an edit to
`test/docs.test.ts`. A file under `docs/e2e/` whose header carries no parseable version SHALL be
treated as historical. The recorder's header line SHALL come from one shared helper used by both
`scripts/e2e-transcript.ts` and the test, so the recorded format and the classification cannot
drift. `docs/e2e/single.md` and `docs/e2e/submodules.md` SHALL be re-recorded with the current
recorder after the guard bundle is regenerated, so both transcripts record the current version
and the fixed guard. Files under `docs/decisions/`, `docs/research/` and `docs/audit/` SHALL stay
strict at every version.

#### Scenario: the recorder's header classifies as current

- **WHEN** the shared header helper is called for the `single` layout with version `1.0.0` and
  the result is classified
- **THEN** the line contains `bun scripts/e2e-transcript.ts single` and `(Loomwright 1.0.0)`
- **AND** the transcript is classified as current, not historical

#### Scenario: the re-recorded transcripts are current

- **WHEN** `docs/e2e/single.md` and `docs/e2e/submodules.md` are read
- **THEN** each header records a version above `0.12.0` and names the layout it was recorded
  with
- **AND** each may contain `Loomwright` and `$ loomwright …`
- **AND** `bun test test/docs.test.ts` passes without editing the scan

#### Scenario: a pre-rename transcript stays historical

- **WHEN** a transcript whose header records `(ai-factory 0.2.0)` is classified
- **THEN** its recorded version is `0.2.0` and it is historical
- **AND** the scan reports nothing when its body does not name `Loomwright`

#### Scenario: a current transcript may name the product

- **WHEN** the scan is given a transcript whose header records `(Loomwright 1.0.0)` and whose
  body names `Loomwright`
- **THEN** it reports no violation

#### Scenario: a historical transcript naming the product fails

- **WHEN** the scan is given a transcript whose header records `(ai-factory 0.2.0)` and whose
  body names `Loomwright`
- **THEN** it reports that file as a violation

#### Scenario: a transcript without a version is history

- **WHEN** the scan is given a file under `docs/e2e/` with no `Recorded … (<version>)` line and
  a body naming `Loomwright`
- **THEN** it reports that file as a violation

#### Scenario: decisions, research and audit stay strict

- **WHEN** the scan is given a file under `docs/decisions/`, `docs/research/` or `docs/audit/`
  that names `Loomwright`
- **THEN** it reports that file as a violation, whatever version the name suggests

#### Scenario: the real tree passes

- **WHEN** `bun test test/docs.test.ts` runs on the repository
- **THEN** every historical transcript and every strict directory file passes the scan
- **AND** the suite holds at least its current number of tests
