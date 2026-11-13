# release-notes Specification

## Purpose
TBD - created by archiving change rebrand-to-loomwright. Update Purpose after archive.

## Requirements

### Requirement: The rename ships as a breaking changeset

A changeset SHALL mark `@loomwright/cli` with a `major` bump and state that the package and binary are renamed while `ai-factory` keeps working as an alias.

#### Scenario: the changeset records the breaking rename

- **WHEN** the pending changeset files are read
- **THEN** one has frontmatter `"@loomwright/cli": major`
- **AND** its body names `loomwright` and the `ai-factory` alias

### Requirement: CHANGELOG announces the new package

`CHANGELOG.md` SHALL gain a new section above the released history stating that the package is published as `@loomwright/cli` with the `loomwright` binary and that `ai-factory` keeps working as an alias.

#### Scenario: the new changelog section announces the rename

- **WHEN** the top of `CHANGELOG.md` is read
- **THEN** the first section after the header names `@loomwright/cli`, `loomwright` and the alias
- **AND** the `## 0.12.0` section below it is unchanged

### Requirement: Release automation targets the new package

The release workflow SHALL query `@loomwright/cli` when deciding whether a version is already published, and the tarball smoke test SHALL invoke the `loomwright` binary. The trusted-publisher configuration SHALL stay unchanged.

#### Scenario: the release plan checks the new package

- **WHEN** `.github/workflows/release.yml` is read
- **THEN** it contains `npm view "@loomwright/cli@$VERSION"`
- **AND** it contains no `@supporterino/ai-factory`

#### Scenario: the tarball smoke test runs the new binary

- **WHEN** the CI and release workflows are read
- **THEN** the install step runs `"$PREFIX/bin/loomwright" --version`

#### Scenario: trusted publishing is untouched

- **WHEN** the publish job of `.github/workflows/release.yml` is read
- **THEN** it still declares `environment: npm` and the `id-token: write` permission
- **AND** it still publishes with `--provenance --access public`
