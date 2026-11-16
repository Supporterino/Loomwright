# compatibility-surface Specification

## Purpose
TBD - created by archiving change rebrand-to-loomwright. Update Purpose after archive.

## Requirements

### Requirement: The on-disk and runtime compatibility surface is unchanged

The change MUST NOT rename `factory.config.jsonc`, `factory.lock.json`, `.factory/`, `factory-records/`, `.opencode/plugins/factory.js`, the `AI_FACTORY_*` environment variables, the plugin id or the `.opencode/` layout, and MUST keep the managed-block, hook and completion markers byte-identical.

#### Scenario: an old install still updates

- **WHEN** the 0.12.0 install snapshot is replayed and `update` runs with the new build
- **THEN** the update succeeds with one commit
- **AND** `factory.lock.json` and the `.factory/` paths keep their names

#### Scenario: managed block markers are unchanged

- **WHEN** `AGENTS.md` and `.gitignore` are rendered
- **THEN** their start markers are exactly `<!-- ai-factory:start (managed by ai-factory; edit outside this block) -->` and `# ai-factory:start (managed)`
- **AND** their end markers are exactly `<!-- ai-factory:end -->` and `# ai-factory:end`

#### Scenario: the plugin id is unchanged

- **WHEN** the bundled plugin is loaded
- **THEN** `plugin.id` is `ai-factory`

#### Scenario: the agent marker environment variable is unchanged

- **WHEN** `agentGitEnv({})` builds the agent environment
- **THEN** the result contains `AI_FACTORY_AGENT=1`
- **AND** appending to existing `GIT_CONFIG_*` entries still yields `url.ai-factory-push-blocked://.pushInsteadOf`

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

### Requirement: This workspace stays unsandboxed until the nesting guard lands

`factory.config.jsonc` MUST keep `security.sandbox: "off"`, with the comment beside it naming `docs/decisions/0041-unsandboxed-workspace.md`. The product's sandbox code, profile and tests are unchanged, every other workspace keeps the `"auto"` default, and a change that flips the setting updates the ADR, the comment and this requirement together.

#### Scenario: the workspace sandbox setting is pinned

- **WHEN** `factory.config.jsonc` is read
- **THEN** `security.sandbox` is `"off"`
- **AND** the comment beside it names ADR-0041
