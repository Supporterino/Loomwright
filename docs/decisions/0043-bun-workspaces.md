# 0043 — Bun workspaces: protocol, core and cli

## Context

The repository was one package: engine and command layer shared `src/`, one tsconfig
covered both, and the publish manifest sat next to test files and fixtures. Nothing in the
tree said which modules belonged to the published CLI and which were internal, so a relative
import could cross that boundary unnoticed. The rename and the move to `@loomwright/cli`
made the published package a distinct unit; the code that builds the CLI should be distinct
too.

## Decision

The repository is a Bun workspace with a private root manifest (`workspaces:
["packages/*"]`) and three packages:
- `packages/protocol` is a private skeleton for what both sides share. It exports only
  `PROTOCOL_VERSION = 0` today and depends on nothing.
- `packages/core` is the private engine. Its subpath exports (`"./*": "./src/*.ts"`) expose
  modules such as `@loomwright/core/policy`; there is no barrel file, so a caller names the
  module it needs and the dependency graph stays readable.
- `packages/cli` is the only published package. Its name, the `loomwright` binary and the
  deprecated `ai-factory` alias, its version and its `files` list are unchanged. The command
  layer lives in `packages/cli/src/`, and the build writes `packages/cli/dist/cli.js`.

Imports flow one way: `cli → core → protocol`. A CLI module may import core but not protocol
directly; a core module may import protocol but never the CLI; protocol imports neither. A
test walks every `.ts` file under `packages/` and fails on a forbidden cross-package
specifier or on a relative import that resolves outside the importing package. Relative
imports of root `templates/` text are the only allowed escape, because the rendered workspace
text lives there; tests under `packages/*/test` may also reach the shared `test/` fixtures.

The plugin stays in core at `packages/core/src/plugin/entry.ts`. `bun
scripts/build-plugin.ts` bundles it with the `policy/` code it uses into
`templates/plugin/factory-plugin.txt`, which `init` renders to
`.opencode/plugins/factory.js`. The bundle path, the plugin id and the runtime boundary (no
opencode import) do not change.

The published tarball is unchanged by keeping the package's `files` entries and generating
the repository-level inputs at build time: `bun scripts/prepare-package.ts` copies `README.md`,
`LICENSE` and `templates/addons/ponytail/LICENSE` into `packages/cli/`, and the root
`CHANGELOG.md` is a symlink to `packages/cli/CHANGELOG.md`. Those copies are git-ignored build
artifacts; `bun run build` produces them before packing. Changesets writes the changelog in
`packages/cli`, where the published manifest lives.

Alternatives rejected:
- **Independent repositories.** Splitting engine, command layer and protocol into separate
  checkouts would add cross-repo versioning and release choreography for three packages that
  always ship together.
- **One package with directory conventions.** Keeping one manifest and relying on
  `src/engine` / `src/commands` naming gives no enforced boundary; any file can still import
  any other file relatively.
- **A fourth package for the plugin.** The plugin shares the policy and approval code with the
  CLI, so a separate package would either duplicate that code or depend on core anyway. It
  stays a bundle entry in core.
- **Duplicating `README` and `LICENSE` in git.** Committed copies drift from the root files.
  Generating them at build time keeps one source and leaves the tarball unchanged.
- **Biome `noRestrictedImports`.** The formatter can flag forbidden specifiers, but it cannot
  see relative paths that escape a package, and it would encode the layout in lint config
  instead of in a test that reads the tree.

## Consequences

- The package boundary is executable: `test/architecture.test.ts` fails on a violation, and
  the baseline test count keeps the move honest.
- `tsc --noEmit` covers the workspace from the root, so the packages share one compiler
  configuration and one gate.
- A published checkout needs `bun run build` before `npm pack` in `packages/cli`; packing
  without it produces a tarball missing `README.md`, `LICENSE` and the ponytail licence.
- `packages/cli` is the only package whose version matters; changesets is scoped there and
  the other two stay at `0.0.0`.
