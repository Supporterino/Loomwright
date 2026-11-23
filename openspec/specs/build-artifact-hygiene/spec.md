# build-artifact-hygiene Specification

## Purpose
How the repository's tests and standalone build scripts treat generated files: what they may
write, what they must leave alone, and which paths the repository ignores.

## Requirements

### Requirement: Tests build the plugin in memory and never write the tracked bundle

Suites that prove `templates/plugin/factory-plugin.txt` is current MUST compare the tracked
file with the result of an in-memory `bundlePlugin()` and MUST NOT write the tracked path.
`bundlePlugin()` MUST leave `templates/plugin/factory-plugin.txt` byte-identical. The only
writer of that path is `bun run build:plugin`, which MUST keep writing through a temp file and
a rename so a concurrent reader never sees a partial bundle and no temp file is left behind.

#### Scenario: an in-memory build leaves the tracked file alone

- **WHEN** `bundlePlugin()` is called and its result is compared with
  `templates/plugin/factory-plugin.txt`
- **THEN** the file's bytes are the same before and after the call
- **AND** the `templates/plugin/` directory holds no `factory-plugin.txt.*.tmp` file

#### Scenario: no test writes the tracked bundle

- **WHEN** every `*.test.ts` under `test/` and `packages/*/test/` is read
- **THEN** none writes `templates/plugin/factory-plugin.txt`, whether by `writePluginBundle`
  or by a direct write
- **AND** the only writer of that path is `scripts/build-plugin.ts` when it runs as a script

#### Scenario: a failed write leaves no partial or temp file

- **WHEN** `writePluginBundle` targets a path whose rename fails
- **THEN** it throws
- **AND** the target directory holds no `*.tmp` file and the target is unchanged

### Requirement: Standalone build scripts create their output directories

`scripts/write-dist-package.ts` MUST create `packages/cli/dist` recursively before it writes
`dist/package.json`, MUST be idempotent, and MUST write exactly the JSON body
`{ "type": "module" }` followed by a newline. The root `build` script's command order MUST stay
unchanged.

#### Scenario: the script works from a clean tree

- **WHEN** the dist package writer runs with no `packages/cli/dist` directory present
- **THEN** it exits successfully and `packages/cli/dist/package.json` contains
  `{ "type": "module" }`

#### Scenario: a second run is a no-op success

- **WHEN** the dist package writer runs again over its own output
- **THEN** it exits successfully and the file content is unchanged

### Requirement: `.gitignore` lists each generated path once

`dist/` already ignores `packages/cli/dist` at any depth, so `.gitignore` MUST NOT contain a
separate `packages/cli/dist/` line. The generated package files under `packages/cli`
(`README.md`, `LICENSE`, `templates/`) MUST stay ignored, and the root `build` script's
`dist/` output MUST stay ignored.

#### Scenario: the redundant line is gone

- **WHEN** `.gitignore` is read
- **THEN** it contains exactly one `dist/` line and no `packages/cli/dist/` line
- **AND** it still lists `packages/cli/README.md`, `packages/cli/LICENSE` and
  `packages/cli/templates/`

#### Scenario: the dist output is still ignored

- **WHEN** `git check-ignore packages/cli/dist/cli.js` and
  `git check-ignore packages/cli/README.md` run in the repository
- **THEN** both exit `0`

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
