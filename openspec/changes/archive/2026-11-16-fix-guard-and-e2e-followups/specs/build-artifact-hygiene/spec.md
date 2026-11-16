# build-artifact-hygiene Specification

## Purpose

How the repository's tests and standalone build scripts treat generated files: what they may
write, what they must leave alone, and which paths the repository ignores.

## ADDED Requirements

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
