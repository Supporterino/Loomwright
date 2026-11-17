# monorepo-layout Specification

## MODIFIED Requirements

### Requirement: The repository is a Bun-workspaces monorepo with three packages

The root `package.json` SHALL be a private workspace manifest and declare `workspaces: ["packages/*"]`. `packages/protocol` SHALL be the private package `@loomwright/protocol` and export `PROTOCOL_VERSION = 1` plus the run-event protocol (`RunEvent`, `RunSnapshot`, `reduce`, `emptySnapshot` and `Command`) from its package root. `packages/core` SHALL be the private package `@loomwright/core` and expose its modules through subpath exports. `packages/cli` SHALL be the published package `@loomwright/cli` with the version, bin map, engines and publish configuration it had before the change. `templates/`, `docs/` and `scripts/` SHALL stay at the repository root.

#### Scenario: the root manifest declares the workspaces and publishes nothing

- **WHEN** the root `package.json` is read
- **THEN** `private` is `true`
- **AND** `workspaces` equals `["packages/*"]`
- **AND** it has no `bin`, `files` or `publishConfig` entry

#### Scenario: the three package identities are correct

- **WHEN** `packages/protocol/package.json`, `packages/core/package.json` and `packages/cli/package.json` are read
- **THEN** their names are `@loomwright/protocol`, `@loomwright/core` and `@loomwright/cli`
- **AND** `protocol` and `core` have `private: true`
- **AND** `cli` is not private and has version `1.0.0`

#### Scenario: protocol is a versioned skeleton with no engine imports

- **WHEN** `packages/protocol/src/index.ts` is read
- **THEN** it exports `PROTOCOL_VERSION` with the value `1`
- **AND** it exports `RunEvent`, `RunSnapshot`, `reduce`, `emptySnapshot` and `Command`
- **AND** it imports nothing from `@loomwright/core`, `@loomwright/cli` or a relative path outside `packages/protocol/src`

#### Scenario: core exposes subpath exports

- **WHEN** `packages/core/package.json` is read
- **THEN** its `exports` map resolves a subpath import such as `@loomwright/core/policy/permissions` to the matching `src` module
- **AND** the package does not need a barrel `index.ts` to be importable

#### Scenario: the published CLI identity is unchanged

- **WHEN** `packages/cli/package.json` is read
- **THEN** `name` is `@loomwright/cli`, `version` is `1.0.0`
- **AND** `bin` equals `{ "loomwright": "./dist/cli.js", "ai-factory": "./dist/cli.js" }`
- **AND** `files` still lists `dist`, `README.md`, `CHANGELOG.md`, `LICENSE` and `templates/addons/ponytail/LICENSE`
- **AND** it has no runtime dependency on the private `@loomwright/core` or `@loomwright/protocol` packages, because the tarball is a self-contained bundle
