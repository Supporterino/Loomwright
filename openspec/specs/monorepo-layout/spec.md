# monorepo-layout Specification

## Purpose
TBD - created by archiving change restructure-into-bun-workspaces. Update Purpose after archive.

## Requirements

### Requirement: The repository is a Bun-workspaces monorepo with three packages

The root `package.json` SHALL be a private workspace manifest and declare
`workspaces: ["packages/*"]`. The workspace SHALL hold four packages under `packages/`:
`packages/protocol`, the private package `@loomwright/protocol`, which SHALL export
`PROTOCOL_VERSION = 1` plus the run-event protocol (`RunEvent`, `RunSnapshot`, `reduce`,
`emptySnapshot` and `Command`) from its package root; `packages/core`, the private package
`@loomwright/core`, which SHALL expose its modules through subpath exports; `packages/cli`, the
published package `@loomwright/cli` with the version, bin map, engines and publish configuration it
had before the TUI change; and `packages/tui`, the private package `@loomwright/tui`, which SHALL
hold the terminal UI, SHALL export its modules through subpath exports, and MUST NOT be a
dependency of `protocol` or `core`. `templates/`, `docs/` and `scripts/` SHALL stay at the
repository root. The requirement title keeps its original wording so the OpenSpec delta applies;
the body is authoritative.

#### Scenario: the root manifest declares the workspaces and publishes nothing

- **WHEN** the root `package.json` is read
- **THEN** `private` is `true`
- **AND** `workspaces` equals `["packages/*"]`
- **AND** it has no `bin`, `files` or `publishConfig` entry

#### Scenario: the three package identities are correct

- **WHEN** `packages/protocol/package.json`, `packages/core/package.json` and
  `packages/cli/package.json` are read
- **THEN** their names are `@loomwright/protocol`, `@loomwright/core` and `@loomwright/cli`
- **AND** `protocol` and `core` have `private: true`
- **AND** `cli` is not private and keeps the version it had before the change

#### Scenario: the TUI package is a private workspace with subpath exports

- **WHEN** `packages/tui/package.json` and its source tree are read
- **THEN** its name is `@loomwright/tui` and `private` is `true`
- **AND** its `exports` map resolves a subpath such as `@loomwright/tui/strings` to the matching `src` module
- **AND** its dependencies are `@loomwright/core`, `@loomwright/protocol`, `ink` and `react`, each pinned to an exact version
- **AND** neither `@loomwright/protocol` nor `@loomwright/core` depends on it

#### Scenario: protocol is a versioned skeleton with no engine imports

- **WHEN** `packages/protocol/src/index.ts` is read
- **THEN** it exports `PROTOCOL_VERSION` with the value `1`
- **AND** it exports `RunEvent`, `RunSnapshot`, `reduce`, `emptySnapshot` and `Command`
- **AND** it imports nothing from `@loomwright/core`, `@loomwright/cli`, `@loomwright/tui` or a relative path outside `packages/protocol/src`

#### Scenario: core exposes subpath exports

- **WHEN** `packages/core/package.json` is read
- **THEN** its `exports` map resolves a subpath import such as `@loomwright/core/policy/permissions` to the matching `src` module
- **AND** the package does not need a barrel `index.ts` to be importable

#### Scenario: the published CLI identity is unchanged

- **WHEN** `packages/cli/package.json` is read
- **THEN** `name` is `@loomwright/cli`, `version` is unchanged from before the change
- **AND** `bin` equals `{ "loomwright": "./dist/cli.js", "ai-factory": "./dist/cli.js" }`
- **AND** `files` still lists `dist`, `README.md`, `CHANGELOG.md`, `LICENSE` and `templates/addons/ponytail/LICENSE`
- **AND** it has no runtime dependency on the private `@loomwright/core`, `@loomwright/protocol` or `@loomwright/tui` packages, because the tarball is a self-contained bundle

### Requirement: Dependencies flow cli → core → protocol

Source imports under `packages/` MUST follow `cli → core → protocol`, with `tui` beside `cli`:
`packages/cli` MAY import `@loomwright/core` and `@loomwright/tui`; `packages/tui` MAY import
`@loomwright/core` and `@loomwright/protocol`; `packages/core` MAY import
`@loomwright/protocol`; `packages/protocol` MUST NOT import `@loomwright/core`,
`@loomwright/cli` or `@loomwright/tui`; `packages/core` MUST NOT import `@loomwright/cli` or
`@loomwright/tui`; `packages/tui` MUST NOT import `@loomwright/cli`; and `packages/cli` MUST NOT
import `@loomwright/protocol` directly. A relative import MUST NOT leave its package, except for
text imports of the root `templates/` assets and, from a package's test files, the shared root
`test/` support (`test/setup.ts`, `test/helpers.ts`, `test/fixtures/**`). A bun:test that reads the
real tree, backed by a pure checker with unit cases, MUST fail the suite on any violation.

#### Scenario: allowed edges are accepted

- **WHEN** the checker sees a `cli` file importing `@loomwright/core/policy` and a `core` file importing `@loomwright/protocol`
- **THEN** it reports no violation
- **AND** a `tui` file importing `@loomwright/core/factory` and a `tui` file importing `@loomwright/protocol` are also accepted
- **AND** a `cli` file importing `@loomwright/tui` is accepted

#### Scenario: core importing cli is rejected

- **WHEN** the checker sees a file under `packages/core/src` importing `@loomwright/cli/main`
- **THEN** it reports a `core → cli` violation

#### Scenario: protocol importing core is rejected

- **WHEN** the checker sees a file under `packages/protocol/src` importing `@loomwright/core/errors`
- **THEN** it reports a `protocol → core` violation

#### Scenario: cli importing protocol directly is rejected

- **WHEN** the checker sees a file under `packages/cli/src` importing `@loomwright/protocol`
- **THEN** it reports a `cli → protocol` shortcut violation

#### Scenario: the TUI may not reach the CLI or the engine

- **WHEN** the checker sees a file under `packages/tui/src` importing `@loomwright/cli/main`
- **THEN** it reports a `tui → cli` violation
- **AND** a `core` file importing `@loomwright/tui` and a `protocol` file importing `@loomwright/tui` are each reported as a violation

#### Scenario: a relative import that escapes its package is rejected

- **WHEN** the checker sees a file under `packages/core/src` importing `../../../cli/src/main.ts`
- **THEN** it reports an escape violation

#### Scenario: root templates text imports are allowed

- **WHEN** the checker sees `packages/core/src/render/workspace.ts` importing `../../../../templates/agents/architect.md`
- **THEN** it reports no violation

#### Scenario: package tests may reach the shared root test support

- **WHEN** the checker sees `packages/cli/test/completion.test.ts` importing `../../../test/fixtures/workspaces.ts`
- **THEN** it reports no violation
- **AND** the same relative import from `packages/cli/src` is reported as an escape

#### Scenario: the real tree obeys the rule

- **WHEN** the architecture test scans every TypeScript file under `packages/`
- **THEN** it finds no forbidden import
- **AND** its package checker knows all four package names

### Requirement: The published package and CLI behaviour stay unchanged

The published package name, version, bin map, engines, publish configuration and tarball file list
MUST stay identical to the baseline, except for the second bundle entry `package/dist/tui.js` that
this change adds. CLI stdout, stderr, exit codes, JSON output, the plugin id, the plugin output path
and every workspace file format MUST stay unchanged. The primary bundle entry MUST stay
`packages/cli/src/bin.ts` building to `dist/cli.js`, and the TUI MUST NOT be part of that bundle;
bundle bytes MAY change only through embedded source-path comments.

#### Scenario: the tarball file list matches the baseline

- **WHEN** `npm pack --dry-run --json` runs in `packages/cli` after `bun run build`
- **THEN** the file list is exactly `package/package.json`, `package/README.md`, `package/CHANGELOG.md`, `package/LICENSE`, `package/dist/cli.js`, `package/dist/tui.js`, `package/dist/package.json` and `package/templates/addons/ponytail/LICENSE`

#### Scenario: the version flag and both binaries still work

- **WHEN** the built CLI runs with `--version`
- **THEN** stdout is exactly `<FACTORY_VERSION>` followed by a newline
- **AND** the installed `loomwright` and `ai-factory` binaries both point at `dist/cli.js`

#### Scenario: the plugin output path and id are unchanged

- **WHEN** the committed plugin bundle is loaded
- **THEN** `plugin.id` is `ai-factory`
- **AND** it was generated from `packages/core/src/plugin/entry.ts` into `templates/plugin/factory-plugin.txt`

#### Scenario: exit codes are unchanged

- **WHEN** the existing CLI tests run
- **THEN** `ExitCode` still exposes `0`, `1`, `2`, `3`, `4`, `5`, `6` and `10` with their existing meanings
- **AND** no command other than the new `tui` returns a different code

#### Scenario: workspace formats are unchanged

- **WHEN** `init` and `update` run against the 0.12.0 and 1.0.0 install snapshots
- **THEN** `factory.config.jsonc`, `factory.lock.json`, the managed markers and `.opencode/plugins/factory.js` keep their names and formats
- **AND** the update commits exactly as before

#### Scenario: the bundle entry is unchanged

- **WHEN** `bun run build` runs
- **THEN** it bundles `packages/cli/src/bin.ts` to `packages/cli/dist/cli.js`
- **AND** `dist/cli.js` does not contain the TUI entry or the Ink module graph
- **AND** the built CLI does not need the source tree at runtime

### Requirement: Build, release and CI run from the new layout

`bun run build` SHALL bundle `packages/cli/src/bin.ts` to `packages/cli/dist/cli.js`, bundle the
TUI entry `packages/tui/src/entry.tsx` to a self-contained `packages/cli/dist/tui.js` for Node,
write `packages/cli/dist/package.json`, regenerate `templates/plugin/factory-plugin.txt` from
`packages/core/src/plugin/entry.ts`, and prepare the files the published package needs under
`packages/cli`. `scripts/sync-version.ts` SHALL read `packages/cli/package.json` and write
`packages/core/src/version.ts`. Changesets SHALL watch `packages/**`. CI SHALL pack from
`packages/cli`, upload `packages/cli/dist/**` plus the replayed event fixture, and smoke-test the
built bundle on Node 20.3, 22 and 24, including `tui --replay <fixture> --once`. The root gate
scripts `format:check`, `lint`, `typecheck` and `test` SHALL keep their exact commands.

#### Scenario: the build writes the CLI bundle and the plugin bundle

- **WHEN** `bun run build` runs
- **THEN** `packages/cli/dist/cli.js` and `packages/cli/dist/package.json` exist
- **AND** `packages/cli/dist/tui.js` exists and runs on the Node floor without the source tree
- **AND** `templates/plugin/factory-plugin.txt` equals a fresh `bun run build:plugin` output

#### Scenario: sync-version keeps the version file in lockstep

- **WHEN** `bun scripts/sync-version.ts` runs after a Changesets bump
- **THEN** it reads the version from `packages/cli/package.json`
- **AND** it rewrites `FACTORY_VERSION` in `packages/core/src/version.ts`
- **AND** a second run reports that the file is already current

#### Scenario: Changesets sees package changes

- **WHEN** `.changeset/config.json` is read
- **THEN** `changedFilePatterns` includes `packages/**`
- **AND** `packages/core`, `packages/protocol` and `packages/tui` are private, so Changesets does not publish them

#### Scenario: CI packs and smoke-tests the new paths

- **WHEN** `.github/workflows/ci.yml` is read
- **THEN** the pack step runs in `packages/cli`
- **AND** the artifact upload includes `packages/cli/dist/cli.js` and `packages/cli/dist/tui.js`
- **AND** the node matrix still contains `20.3.0`, `22` and `24`
- **AND** each matrix entry runs `tui --replay <fixture> --once` against the uploaded fixture

#### Scenario: gate scripts keep their exact definitions

- **WHEN** the root `package.json` is read
- **THEN** `format:check` is `biome format .`
- **AND** `lint` is `biome check .`
- **AND** `typecheck` is `tsc --noEmit`
- **AND** `test` is `bun test --timeout 60000 --parallel`

### Requirement: Tests and documentation follow the packages

Tests SHALL live under `packages/core/test` or `packages/cli/test` according to the code they test. Repo-level suites, `test/setup.ts`, `test/helpers.ts` and `test/fixtures/**` SHALL stay at the root; end-to-end fixtures stay shared. The README "Development" and "Adding a language profile" paths, the ARCHITECTURE "Where" column, `docs/cli.md`, `docs/plan.md` and the new ADR-0043 SHALL use the new paths. Historical material under `docs/decisions/`, `docs/research/`, `docs/e2e/`, `docs/audit/` and the `install-*.json` snapshots MUST keep its existing text.

#### Scenario: moved tests sit with their package

- **WHEN** the test tree is listed
- **THEN** `packages/core/test/` contains the engine tests, for example `tasks.test.ts` and `gates-resolve.test.ts`
- **AND** `packages/cli/test/` contains the command tests, for example `cli-usage.test.ts` and `completion.test.ts`
- **AND** every moved test reaches its own package through `../src/`; none imports the removed root `src/`

#### Scenario: shared fixtures and setup stay at the root

- **WHEN** the test tree is listed
- **THEN** `test/setup.ts`, `test/helpers.ts` and `test/fixtures/workspaces.ts` still exist at their root paths
- **AND** `bunfig.toml` still preloads `./test/setup.ts`
- **AND** the total number of tests is not lower than the baseline

#### Scenario: current-facing docs use the new paths

- **WHEN** `README.md`, `ARCHITECTURE.md`, `docs/cli.md` and `docs/plan.md` are read
- **THEN** they name `packages/core/src`, `packages/cli/src` and `packages/protocol` where they name source paths
- **AND** the README brand header, the ARCHITECTURE opening and the CLI reference's first paragraphs still pass their existing tests

#### Scenario: ADR-0043 records the layout and the rule

- **WHEN** `docs/decisions/0043-bun-workspaces.md` and the decisions index are read
- **THEN** the ADR is the next free number and records the package layout, the `cli → core → protocol` rule and the plugin placement
- **AND** the index has a row for it
- **AND** the file does not contain the capitalised product name, so the historical scan stays valid

#### Scenario: historical material is untouched

- **WHEN** `docs/decisions/0042-fewer-git-processes.md`, `docs/e2e/single.md` and `test/fixtures/install-0.12.0.json` are read
- **THEN** their text is unchanged by this change

### Requirement: Protected files are reported, not edited

This change MUST NOT edit `factory.config.jsonc`, `factory.lock.json`, `.opencode/**`, `openspec/specs/**`, `AGENTS.md` or `factory-records/**`. If a protected file references a moved path, the final report SHALL name the file and the exact edit. The committed `.opencode/plugins/factory.js` SHALL be regenerated by `loomwright update` after landing, not by this change.

#### Scenario: the protected paths have no diff

- **WHEN** the change's diff is inspected
- **THEN** it contains no edit under `factory.config.jsonc`, `factory.lock.json`, `.opencode/`, `openspec/specs/`, `AGENTS.md` or `factory-records/`

#### Scenario: the report lists the protected-file follow-up

- **WHEN** the final report is read
- **THEN** it says that `loomwright update` must regenerate `.opencode/plugins/factory.js` and the matching `factory.lock.json` hash
- **AND** it names every other protected-file edit, or says there is none

#### Scenario: protected configuration is checked for moved paths

- **WHEN** `factory.config.jsonc` is read
- **THEN** `instructions` has no source-path entry, `graph.exclude` still matches `**/dist/**` and `gates.overrides` is empty
- **AND** no edit to the file is required
