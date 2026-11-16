# compatibility-surface Specification

## MODIFIED Requirements

### Requirement: Historical material stays untouched

The `CHANGELOG.md` sections, the `docs/decisions/**`, `docs/research/**` and `docs/audit/**`
files, and the `test/fixtures/install-*.json` snapshots that exist when this change starts MUST
keep their existing text, and no file under those paths may name the product `Loomwright`; the
`loomwright` command is allowed. Under `docs/e2e/`, a transcript that records a version at or
below `0.12.0` MUST NOT name `Loomwright`, and a transcript that records a later version MAY.
This change narrows the scan to that rule (see the next requirement) and then re-records the two
pre-rename transcripts, `docs/e2e/single.md` and `docs/e2e/submodules.md`, with the current
recorder; no historical transcript remains and the old text stays in git history.

#### Scenario: the replay snapshot stays historical

- **WHEN** `test/fixtures/install-0.12.0.json` is read
- **THEN** it still contains `# Managed by ai-factory` and `<!-- ai-factory:start`
- **AND** it contains no `Loomwright`

#### Scenario: past changelog entries are preserved

- **WHEN** the `## 0.12.0` section of `CHANGELOG.md` is read
- **THEN** it still contains its original review-findings text
- **AND** the section is unchanged by this change

#### Scenario: historical docs do not mention the product name

- **WHEN** every file under `docs/decisions/`, `docs/research/` and `docs/audit/`, and every
  `docs/e2e/` transcript whose recorded version is at or below `0.12.0`, is scanned
- **THEN** none contains the string `Loomwright`
- **AND** the command `loomwright` is allowed there, so the new ADR `docs/decisions/0041-unsandboxed-workspace.md` may name it

#### Scenario: the pre-rename transcripts are re-recorded, not kept

- **WHEN** `docs/e2e/single.md` and `docs/e2e/submodules.md` are read after this change
- **THEN** each records a version above `0.12.0` with the current product name
- **AND** the scan classifies both as current, so the no-name rule does not apply to them

### Requirement: Naming the product in a historical directory is a separate change

A transcript re-recorded by `scripts/e2e-transcript.ts` is an addition, not a rewrite, and this
change narrows the scan in `test/docs.test.ts` so it can happen. The scan MUST classify
`docs/e2e/` files by their recorded version and apply the no-name rule only to historical ones.
The scan MUST keep the strict no-name rule for `docs/decisions/`, `docs/research/` and
`docs/audit/`; a new file there that names the product still fails.

#### Scenario: a re-recorded transcript updates the scan first

- **WHEN** a transcript under `docs/e2e/` is re-recorded with the updated recorder
- **THEN** the change that re-records it also narrows the scan in `test/docs.test.ts` to the historical files
- **AND** this change does both in that order: it version-gates the scan, then re-records `docs/e2e/single.md` and `docs/e2e/submodules.md`

#### Scenario: an unversioned e2e file is treated as history

- **WHEN** a file under `docs/e2e/` has no `Recorded … (<version>)` header
- **THEN** the scan applies the no-name rule to it

#### Scenario: the strict directories keep the strict rule

- **WHEN** a new file under `docs/decisions/`, `docs/research/` or `docs/audit/` names
  `Loomwright`
- **THEN** `test/docs.test.ts` fails
- **AND** narrowing the e2e rule does not change that

#### Scenario: the current ADR stays name-free

- **WHEN** `docs/decisions/0044-*.md` and the decisions index are read
- **THEN** the ADR is the next free number, is listed in the index, and contains no
  `Loomwright`
