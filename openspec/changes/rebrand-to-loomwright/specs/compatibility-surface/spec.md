# compatibility-surface

## ADDED Requirements

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

Existing `CHANGELOG.md` sections, the `docs/decisions/**` files that predate this change, `docs/research/**`, `docs/e2e/**`, `docs/audit/**` and the `test/fixtures/install-*.json` replay snapshots MUST keep their existing text. None of the files under those directories may name the product `Loomwright`; new material added by this change, such as a new ADR, may name the `loomwright` command.

#### Scenario: the replay snapshot stays historical

- **WHEN** `test/fixtures/install-0.12.0.json` is read
- **THEN** it still contains `# Managed by ai-factory` and `<!-- ai-factory:start`
- **AND** it contains no `Loomwright`

#### Scenario: past changelog entries are preserved

- **WHEN** the `## 0.12.0` section of `CHANGELOG.md` is read
- **THEN** it still contains its original review-findings text
- **AND** the section is unchanged by this change

#### Scenario: historical docs do not mention the product name

- **WHEN** every file under `docs/decisions/`, `docs/research/`, `docs/e2e/` and `docs/audit/` is scanned
- **THEN** none contains the string `Loomwright`
- **AND** the command `loomwright` is allowed there, so a new ADR such as `docs/decisions/0041-unsandboxed-workspace.md` may name it
