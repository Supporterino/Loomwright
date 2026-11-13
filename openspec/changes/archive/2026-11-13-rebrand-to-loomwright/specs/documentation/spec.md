# documentation

## ADDED Requirements

### Requirement: README presents the Loomwright brand

`README.md` SHALL open with the mark image, the `# Loomwright` wordmark and the tagline `Spec in. Woven software out.`, and SHALL include a "Renamed from ai-factory" note linking to `brand/BRAND.md`. Every install, run and update example SHALL use `loomwright` and `@loomwright/cli`.

#### Scenario: the README header carries the brand

- **WHEN** the top of `README.md` is read
- **THEN** it contains `brand/icons/mark-on-light-512.png`, `# Loomwright` and `Spec in. Woven software out.`
- **AND** it links to `brand/BRAND.md` and mentions `Renamed from ai-factory`

#### Scenario: README commands use the new package and binary

- **WHEN** `README.md` is read
- **THEN** the install, `init`, `doctor` and `update` examples use `@loomwright/cli` and `loomwright`
- **AND** the rename note documents that the `ai-factory` binary still works as a deprecated alias

### Requirement: Current-facing docs use Loomwright

`ARCHITECTURE.md`, `docs/cli.md`, `docs/plan.md` and `docs/fleet-update.sh` SHALL name the product Loomwright and SHALL show `loomwright` in every command example.

#### Scenario: the CLI reference names the new package

- **WHEN** `docs/cli.md` is read
- **THEN** its first paragraph says `loomwright [-C <dir>] <command> [options]` and `@loomwright/cli`
- **AND** no command synopsis starts with `ai-factory`

#### Scenario: the architecture and plan name Loomwright

- **WHEN** `ARCHITECTURE.md` and `docs/plan.md` are read
- **THEN** the architecture intro names Loomwright and the diagram label is `Loomwright CLI`
- **AND** `docs/plan.md` starts `# Loomwright v1 build plan`

#### Scenario: the fleet update example uses the new package

- **WHEN** `docs/fleet-update.sh` is read
- **THEN** it calls `bunx "@loomwright/cli@${version}"`
- **AND** its rollback hint says `loomwright rollback`
