# package-identity Specification

## Purpose
TBD - created by archiving change rebrand-to-loomwright. Update Purpose after archive.

## Requirements

### Requirement: Package metadata names Loomwright

The published manifest SHALL be `packages/cli/package.json`. It SHALL be named `@loomwright/cli`, its `description` MUST name Loomwright, its `version` SHALL stay `1.0.0` for this change, and `bin` MUST expose `loomwright` at `./dist/cli.js` while keeping `ai-factory` at the same entry as a deprecated alias. The root `package.json` SHALL be a private workspace manifest without `bin`, `files` or `publishConfig`.

#### Scenario: package metadata exposes both binaries

- **WHEN** `packages/cli/package.json` is read
- **THEN** `name` is `@loomwright/cli`
- **AND** `version` is `1.0.0`
- **AND** `bin` equals `{ "loomwright": "./dist/cli.js", "ai-factory": "./dist/cli.js" }`
- **AND** `description` contains `Loomwright`

#### Scenario: the deprecated alias keeps existing scripts working

- **WHEN** `packages/cli/package.json` is read
- **THEN** `bin["ai-factory"]` is the same entry as `bin.loomwright`
- **AND** no other binary name is added

#### Scenario: the root manifest is not publishable

- **WHEN** the root `package.json` is read
- **THEN** `private` is `true`
- **AND** it has no `bin`, `files` or `publishConfig`
- **AND** it still contains the root scripts and devDependencies

### Requirement: Version output uses the new package

`FACTORY_VERSION` in `packages/core/src/version.ts` SHALL equal the `version` in `packages/cli/package.json`, `PACKAGE_NAME` SHALL equal its `name`, `runVersion(v)` MUST return `npx @loomwright/cli@v`, and `--version` MUST print the bare version without a product name.

#### Scenario: runVersion names the new package

- **WHEN** `runVersion("1.2.3")` is called
- **THEN** it returns `npx @loomwright/cli@1.2.3`

#### Scenario: the version flag prints only the version

- **WHEN** the CLI runs with `--version`
- **THEN** stdout is exactly `<FACTORY_VERSION>` followed by a newline
- **AND** stdout does not contain `Loomwright` or `ai-factory`

#### Scenario: the version file matches the published manifest

- **WHEN** `scripts/sync-version.ts` has run
- **THEN** `FACTORY_VERSION` in `packages/core/src/version.ts` equals `packages/cli/package.json`'s `version`
- **AND** `PACKAGE_NAME` in the same file equals its `name`

### Requirement: Package URLs stay unchanged for now

The `repository`, `homepage` and `bugs` URLs MUST stay at their current `Supporterino/AI-Factory` locations in this change; flipping them is a follow-up after the repository moves.

#### Scenario: the repository URLs are unchanged

- **WHEN** `package.json` is read
- **THEN** `repository.url` is `git+https://github.com/Supporterino/AI-Factory.git`
- **AND** `homepage` and `bugs.url` still point at `Supporterino/AI-Factory`

### Requirement: Gate script definitions are preserved

The root `package.json` SHALL keep the existing gate entries (`format:check`, `lint`, `typecheck`, `test`) with their exact commands, and no gate script may be renamed or repointed in this change. The published manifest MAY omit them.

#### Scenario: gate scripts keep their exact definitions

- **WHEN** the root `package.json` is read
- **THEN** `format:check` is `biome format .`
- **AND** `lint` is `biome check .`
- **AND** `typecheck` is `tsc --noEmit`
- **AND** `test` is `bun test --timeout 60000 --parallel`

#### Scenario: the published manifest does not own the gates

- **WHEN** `packages/cli/package.json` is read
- **THEN** it does not need to define `format:check`, `lint`, `typecheck` or `test`
- **AND** the root scripts still run from the repository root
