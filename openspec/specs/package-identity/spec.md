# package-identity Specification

## Purpose
TBD - created by archiving change rebrand-to-loomwright. Update Purpose after archive.

## Requirements

### Requirement: Package metadata names Loomwright

The package SHALL be named `@loomwright/cli`, its `description` MUST name Loomwright, and `bin` MUST expose `loomwright` at `./dist/cli.js` while keeping `ai-factory` at the same entry as a deprecated alias.

#### Scenario: package metadata exposes both binaries

- **WHEN** `package.json` is read
- **THEN** `name` is `@loomwright/cli`
- **AND** `bin` equals `{ "loomwright": "./dist/cli.js", "ai-factory": "./dist/cli.js" }`
- **AND** `description` contains `Loomwright`

#### Scenario: the deprecated alias keeps existing scripts working

- **WHEN** `package.json` is read
- **THEN** `bin["ai-factory"]` is the same entry as `bin.loomwright`
- **AND** no other binary name is added

### Requirement: Version output uses the new package

`PACKAGE_NAME` SHALL equal the `package.json` name, `runVersion(v)` MUST return `npx @loomwright/cli@v`, and `--version` MUST print the bare version without a product name.

#### Scenario: runVersion names the new package

- **WHEN** `runVersion("1.2.3")` is called
- **THEN** it returns `npx @loomwright/cli@1.2.3`

#### Scenario: the version flag prints only the version

- **WHEN** the CLI runs with `--version`
- **THEN** stdout is exactly `<FACTORY_VERSION>` followed by a newline
- **AND** stdout does not contain `Loomwright` or `ai-factory`

### Requirement: Package URLs stay unchanged for now

The `repository`, `homepage` and `bugs` URLs MUST stay at their current `Supporterino/AI-Factory` locations in this change; flipping them is a follow-up after the repository moves.

#### Scenario: the repository URLs are unchanged

- **WHEN** `package.json` is read
- **THEN** `repository.url` is `git+https://github.com/Supporterino/AI-Factory.git`
- **AND** `homepage` and `bugs.url` still point at `Supporterino/AI-Factory`

### Requirement: Gate script definitions are preserved

The existing gate entries in `package.json` (`format:check`, `lint`, `typecheck`, `test`) MUST keep their exact commands, and no gate script may be renamed or repointed in this change.

#### Scenario: gate scripts keep their exact definitions

- **WHEN** the `scripts` block of `package.json` is read
- **THEN** `format:check` is `biome format .`
- **AND** `lint` is `biome check .`
- **AND** `typecheck` is `tsc --noEmit`
- **AND** `test` is `bun test --timeout 60000`
