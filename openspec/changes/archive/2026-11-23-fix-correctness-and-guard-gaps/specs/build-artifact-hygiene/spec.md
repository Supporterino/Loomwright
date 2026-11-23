# build-artifact-hygiene Specification

## ADDED Requirements

### Requirement: The plugin bundle is identical from every working directory

`bundlePlugin()` MUST pin the build root to the repository root, so the module labels it emits
are repository-relative and do not depend on the process working directory. The committed
`templates/plugin/factory-plugin.txt` SHALL be the output of that build, regenerated with
`bun run build:plugin` in the same change.

#### Scenario: a root build matches the committed file

- **WHEN** `bundlePlugin()` runs from the repository root
- **THEN** its output equals `templates/plugin/factory-plugin.txt`

#### Scenario: a subdirectory build matches the committed file

- **WHEN** `bundlePlugin()` runs with the process working directory set to a subdirectory
- **THEN** its output equals the committed file byte for byte
- **AND** it equals the output of the root build
- **AND** the output contains repository-relative labels such as
  `// packages/core/src/plugin/entry.ts` and no `../` or absolute working-directory prefix

#### Scenario: the regenerated bundle is committed

- **WHEN** `bun run build:plugin` runs and `git diff --exit-code -- templates/plugin/factory-plugin.txt`
  is checked
- **THEN** the diff is empty

### Requirement: One artifact list governs the packed tarball

A single script SHALL own the required entries and the forbidden prefixes for the packed
tarball. Both `.github/workflows/ci.yml` and `.github/workflows/release.yml` MUST call that
script and MUST NOT duplicate the list inline. The required entries SHALL be
`package/dist/cli.js`, `package/dist/tui.js` and `package/dist/package.json`; the forbidden
prefixes SHALL be `package/src/`, `package/test/` and `package/scripts/`.

#### Scenario: both workflows use the one list

- **WHEN** `ci.yml` and `release.yml` are read
- **THEN** each calls the shared tarball check with the packed file list
- **AND** neither contains an inline `grep -qx "package/dist/...` list

#### Scenario: a missing lazy entry fails

- **WHEN** the shared check receives a tarball listing without `package/dist/tui.js`
- **THEN** it fails and the message names `package/dist/tui.js`

#### Scenario: source files fail

- **WHEN** the shared check receives a listing with `package/src/main.ts`
- **THEN** it fails and the message names the unexpected source path

### Requirement: ADR-0047 states the measured TUI bundle size

ADR-0047 SHALL replace the unmeasured "about 1 MB" claim with a measured byte count for
`packages/cli/dist/tui.js` and SHALL name how it was measured. The recorded size MUST be
reproducible with `bun run build` and the named command.

#### Scenario: the size is measured, not estimated

- **WHEN** `docs/decisions/0047-tui.md` is read
- **THEN** it gives a byte count for `packages/cli/dist/tui.js`
- **AND** it names the command used to measure it after `bun run build`
- **AND** it no longer says "about 1 MB"
- **AND** it keeps the pinned Ink and React versions, `approval.pending`, `--replay` and no
  capitalised product name
