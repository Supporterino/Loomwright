# product-voice

## ADDED Requirements

### Requirement: CLI help, usage and errors use `loomwright`

Every usage line, help text, example and usage-error hint printed by the CLI SHALL name the `loomwright` command.

#### Scenario: top-level help names loomwright

- **WHEN** the CLI runs with `--help`
- **THEN** stdout contains `Usage: loomwright [-C <dir>] <command> [options]`
- **AND** stdout does not contain `Usage: ai-factory`

#### Scenario: every command help names loomwright

- **WHEN** each visible command runs with `--help`
- **THEN** its first line starts `Usage: loomwright <command>`
- **AND** no command synopsis starts `Usage: ai-factory`

#### Scenario: a usage error points at loomwright help

- **WHEN** an unknown flag is passed to `run`
- **THEN** stderr contains ``see `loomwright run --help` ``

### Requirement: Runtime output and fix hints use Loomwright

Doctor checks, pipeline next-steps, pause reasons, lock and downgrade errors, config and migration errors, state locks, update and rollback hints, artifact messages, workspace-sync errors and add-on messages SHALL name Loomwright and SHALL show `loomwright` in command examples.

#### Scenario: doctor suggests the new command

- **WHEN** the workspace graph has not been built
- **THEN** the graph check's `fix` is `loomwright graph`
- **AND** no check's `fix` contains `ai-factory`

#### Scenario: a change paused on spec findings points at loomwright reword

- **WHEN** a change pauses on spec findings
- **THEN** `pausedReason` contains `loomwright reword <id>`

#### Scenario: the downgrade error names Loomwright

- **WHEN** a workspace was installed by a newer factory version
- **THEN** stderr contains `installed by Loomwright <version>`
- **AND** stderr contains `npx @loomwright/cli@<version>`

#### Scenario: task commits carry the new product name

- **WHEN** a task leaves uncommitted work in its worktree and the factory commits it
- **THEN** the commit message starts `loomwright <change-id> <task-id>`

### Requirement: Generated agent and workspace text uses Loomwright

Rendered agent descriptions, the AGENTS.md managed block body, the managed-file header, the initial config header, the config-schema title, the handoff schema id and the bundled plugin SHALL name Loomwright.

#### Scenario: rendered agent descriptions name Loomwright

- **WHEN** a workspace is initialised
- **THEN** `.opencode/agents/orchestrator.md` has the description `Loomwright intake: request to change id and summary. No tools.`
- **AND** `.opencode/agents/implementer-<repo>.md` has a description starting `Loomwright implementer for <repo>`

#### Scenario: the AGENTS.md managed block names Loomwright

- **WHEN** a workspace is initialised
- **THEN** `AGENTS.md` contains `## Loomwright` inside the managed block
- **AND** the block body says `This workspace is driven by Loomwright`

#### Scenario: generated file headers name Loomwright

- **WHEN** a workspace is initialised
- **THEN** the managed header says "Managed by Loomwright." and tells the reader to run `loomwright update`
- **AND** `openspec/config.yaml`, `.graphifyignore` and `.opencode/opencode.jsonc` carry that header
- **AND** `.opencode/agents/*.md` descriptions and `.opencode/schemas/factory.config.schema.json`'s title say Loomwright
- **AND** `.opencode/schemas/handoff.schema.json` has `$id` `loomwright/handoff.schema.json`

#### Scenario: the bundled plugin names Loomwright

- **WHEN** `templates/plugin/factory-plugin.txt` is read
- **THEN** it starts `// Loomwright opencode plugin`
- **AND** it contains `Loomwright blocked this call:`
- **AND** `bun run build:plugin` produces the same file
