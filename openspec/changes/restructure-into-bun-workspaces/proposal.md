# Proposal: Restructure into a Bun-workspaces monorepo

## Why

The CLI, the engine and the opencode plugin still live in one package, so the engine cannot be reused by a TUI, a node agent or a web UI without pulling in the command layer. The layering is already broken in two places: `src/errors.ts` imports the CLI's `ExitCode`, and `src/bench/ponytail.ts` plus `src/pipeline/refine.ts` import the CLI's `Io`. Splitting the checkout into workspace packages makes the boundary explicit and gives a later consumer a stable engine entry point without changing anything users see today.

## What Changes

- Turn the repository into a Bun-workspaces monorepo with a private root package and three packages: `@loomwright/protocol` (private, skeleton with `PROTOCOL_VERSION = 0`), `@loomwright/core` (private engine with subpath exports) and `@loomwright/cli` (the published package, name/bin/version unchanged).
- Move the engine out of `src/` into `packages/core/src` and the command layer into `packages/cli/src` with `git mv`, keeping `templates/`, `docs/` and `scripts/` at the repository root.
- Extract the two core-to-CLI references into core: `ExitCode` moves to core and `Io`/`RuntimeFactory` move to a core `io.ts`; the CLI re-exports `Io` for its command modules.
- Keep the opencode plugin in `core` at `packages/core/src/plugin/entry.ts`, still bundled to `templates/plugin/factory-plugin.txt` at the repository root.
- Enforce `cli → core → protocol` with a test that reads the import graph and fails CI on a reverse edge or a relative escape; `templates/` text imports remain the only allowed escape.
- Move tests next to the package they test, keep `test/setup.ts`, `test/helpers.ts` and `test/fixtures/**` shared at the root, and add a repo-level architecture test.
- Move the published manifest to `packages/cli`, keep the tarball file list identical, update build/release/CI paths, per-package tsconfigs, Changesets patterns, README/ARCHITECTURE/docs paths and add ADR-0043.
- Record the baseline before the first move and report the protected-file follow-ups (`loomwright update` for the committed plugin bundle) instead of editing those files.

## Capabilities

### New Capabilities

- `monorepo-layout`: the workspace package boundaries, the published-package location, the enforced dependency direction, the build/release/CI paths, test placement and the baseline/compatibility checks.

### Modified Capabilities

- `package-identity`: the published manifest moves to `packages/cli/package.json`; the root manifest becomes private; gate scripts stay in the root manifest with their exact commands.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** no public API, event or contract changes. Internal import paths change; the CLI entry, exit codes, output and workspace formats do not.
- **Contracts:** none configured.
- **Data:** no migration and no workspace format change. `factory.lock.json` is only refreshed later by `loomwright update`; this change does not edit it.
- **Distribution:** the published package is still `@loomwright/cli@1.0.0` with both binaries at `./dist/cli.js`; the tarball file list is unchanged. Bundle bytes change only through embedded source-path comments.

## Follow-ups (not in this change)

- Renaming the package, binary or organisation (the name is already `@loomwright/cli`).
- A typed event stream between the engine and a future UI.
- The TUI, a node agent or a web UI.
- New features, dependency upgrades and bug fixes.
