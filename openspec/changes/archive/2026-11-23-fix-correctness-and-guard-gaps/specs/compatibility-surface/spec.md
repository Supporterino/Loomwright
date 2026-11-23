# compatibility-surface Specification

## MODIFIED Requirements

### Requirement: Historical material stays untouched

The `CHANGELOG.md` sections, the `docs/research/**` and `docs/audit/**` files, every
`docs/decisions/**` file other than the ADR files and index rows named here, and the
`test/fixtures/install-*.json` snapshots that exist when a change starts MUST keep their
existing text, and no file under those paths may name the product `Loomwright`; the
`loomwright` command is allowed. The `fix-correctness-and-guard-gaps` change is the one
exception: it MAY correct `docs/decisions/0026-hardening-and-sandbox.md`,
`docs/decisions/0041-unsandboxed-workspace.md` and `docs/decisions/0047-tui.md`, MAY add
`docs/decisions/0049-package-runner-aliases.md`, and MAY change the decisions-index rows for
0041 and 0049. Those edits MUST keep the no-capitalised-name rule. Under `docs/e2e/`, a
transcript that records a version at or below `0.12.0` MUST NOT name `Loomwright`, and a
transcript that records a later version MAY. The rebrand change that introduced this
requirement narrowed the scan to that rule (see the next requirement) and then re-recorded the
two pre-rename transcripts, `docs/e2e/single.md` and `docs/e2e/submodules.md`, with the current
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

#### Scenario: the named ADRs are corrected

- **WHEN** `docs/decisions/0026-hardening-and-sandbox.md`,
  `docs/decisions/0041-unsandboxed-workspace.md`, `docs/decisions/0047-tui.md` and
  `docs/decisions/0049-package-runner-aliases.md` are read after the change
- **THEN** each exists with its required sections
- **AND** none contains the string `Loomwright`

#### Scenario: every other historical file keeps its text

- **WHEN** a historical file under `docs/decisions/`, `docs/research/` or `docs/audit/` is
  compared with its text at the start of this change
- **THEN** its body is unchanged
- **AND** only the four named ADRs and the two index rows differ

#### Scenario: the pre-rename transcripts are re-recorded, not kept

- **WHEN** `docs/e2e/single.md` and `docs/e2e/submodules.md` are read after this change
- **THEN** each records a version above `0.12.0` with the current product name
- **AND** the scan classifies both as current, so the no-name rule does not apply to them
