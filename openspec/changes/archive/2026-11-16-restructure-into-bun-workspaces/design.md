# Design: Restructure into a Bun-workspaces monorepo

## Context

The checkout is one package (`@loomwright/cli@1.0.0`) whose engine, command layer and opencode plugin share one `src/` tree. A TUI, a node agent or a web UI cannot import the engine without also carrying the CLI, and two core modules already import CLI types. This change makes the package boundary real without changing what the CLI does, what it prints, how it exits, what it writes into a workspace, or what the published tarball contains.

The hard constraints are:

- `git mv` for every move; content edits only for import paths, manifests, tsconfig and build config.
- `bun run check` green after every task, so a move and the import/tsconfig edits that make it compile are one task.
- The published identity, the bundles' entry points, the workspace file formats and the tarball file list stay the same.
- Protected files are reported, never edited.

## Baseline

Captured from the checkout before any move. Task 1.1 re-runs the commands and records the exact byte counts and test count in its handoff before its first edit; the thresholds below are fixed so the baseline cannot be adjusted afterwards.

| Item | Baseline |
| --- | --- |
| Published manifest | `@loomwright/cli`, version `1.0.0`, `bin` `{ loomwright, ai-factory }` → `./dist/cli.js`, `files` `[dist, README.md, CHANGELOG.md, LICENSE, templates/addons/ponytail/LICENSE]`, engines `node >=20.3`, `bun >=1.3.0`; every dependency is a `devDependency` at the root. |
| Tarball (`npm pack --dry-run --json` after `bun run build`) | 7 files: `package/package.json`, `package/README.md`, `package/CHANGELOG.md`, `package/LICENSE`, `package/dist/cli.js`, `package/dist/package.json`, `package/templates/addons/ponytail/LICENSE`. |
| `dist/cli.js` | Byte size recorded by task 1.1. It is expected to move by the length difference of the embedded `// packages/...` source-path comments, not by a change in dependency closure. |
| Tests | 52 `*.test.ts` files, more than 100 `../src/...` import lines; `test/helpers.ts` and `test/setup.ts` are shared from the root. The exact `bun test` count is recorded by task 1.1 and must not fall. |
| `bun run check` | Green before the change. |
| CLI entry | `src/cli/bin.ts` → `runCli` in `src/cli/main.ts` → `COMMANDS`; `FactoryError` maps to `ExitCode`. |
| Plugin entry | `src/plugin/entry.ts` → `scripts/build-plugin.ts::bundlePlugin` → `templates/plugin/factory-plugin.txt`, rendered to `.opencode/plugins/factory.js`. |
| Core → CLI references | `src/errors.ts:1` imports `src/cli/exit-codes.ts::ExitCode` (fan-in about 30 modules); `src/bench/ponytail.ts:12` and `src/pipeline/refine.ts:3` import `src/cli/command.ts::Io`. No other core module imports the command layer. |
| CLI → core references | Expected: the command layer imports engine modules. No reverse gate, but the direction is currently the only one. |
| Pure modules | `src/handoff/schema.ts` (zod only), `src/cli/exit-codes.ts` (no imports), `src/versions.ts` (constants), `src/config/schema.ts` (zod + constants). |
| Bundles | Both bundles embed source paths (`// src/cli/main.ts`, `// src/plugin/entry.ts`), so their bytes necessarily change when files move. The entry point, dependency closure and size class must not. |

## Decisions

### 1. Bun workspaces with a private root and three packages

The root becomes a private workspace manifest (`workspaces: ["packages/*"]`) that owns the gate scripts, devDependencies and the build/release orchestration. `packages/protocol` is private and only exports `PROTOCOL_VERSION = 0`; `packages/core` is private and owns everything except the command layer; `packages/cli` is the published package and owns the command layer.

All external libraries and both workspace links (`@loomwright/core`, `@loomwright/protocol`) stay in the root `devDependencies`. The published CLI manifest therefore has no runtime or `workspace:` dependency: its tarball is a self-contained bundle, and consumers must not be asked to install a private package. The private packages do not need their own dependency sections for this change.

Rejected: independent repositories (no shared lockfile or package resolution) and a single package with directory conventions (no enforced boundary and no reusable engine entry).

### 2. The published manifest moves to `packages/cli`, the root is not publishable

The request's target layout puts the CLI in `packages/cli`, so the npm identity moves with it. The root `package.json` keeps the gate scripts and the workspace list; it has no `bin`, `files` or `publishConfig`.

Rejected: keeping the published manifest at the root. That is the easiest way to preserve the tarball, but it contradicts the target layout and leaves the CLI as a root special case. The packaging decision below keeps the tarball identical instead.

### 3. Packaging: real files in `packages/cli`, generated README/LICENSE, CHANGELOG moved

npm packs the package root, and the root `files` entry `templates/addons/ponytail/LICENSE` is package-root-relative. To keep the tarball file list identical:

- `CHANGELOG.md` moves to `packages/cli/CHANGELOG.md`; the root `CHANGELOG.md` becomes a relative symlink so the historical tests, release notes and GitHub view keep working. Changesets writes the real file.
- `scripts/prepare-package.ts`, run at the end of `bun run build`, copies the root `README.md`, `LICENSE` and `templates/addons/ponytail/LICENSE` into the matching paths under `packages/cli`. They are build artifacts, gitignored, and explicitly listed in `files`, so `npm pack` includes them exactly as it included the root files before.
- `packages/cli/dist/` is the build output. CI packs after `bun run build`, so `npm pack --ignore-scripts` sees every file.

Rejected: duplicating README/LICENSE in git (drift), symlinking them into the package (npm does not follow symlinks), and changing the `files` list (it would change the tarball contents).

### 4. Protocol stays a skeleton; the one qualifying module is deferred

`src/handoff/schema.ts` is the only module that is pure schema/type code with no engine imports, so it is the first real candidate. It is not moved in this change: doing so would either force a `packages/core/src/protocol.ts` re-export or let the CLI import `@loomwright/protocol` directly, which weakens the `cli → core → protocol` chain before there is a consumer. `PROTOCOL_VERSION = 0` fixes the contract now; moving the handoff schema is a follow-up once the TUI or node agent needs it. The candidates are listed in the baseline.

### 5. The opencode plugin lives in `core`, not in its own package

The plugin is an internal entry at `packages/core/src/plugin/entry.ts`. It imports only core modules (`policy`, `approval`, `logs`, `tasks`), is never imported by the CLI at runtime, and is bundled into one file for opencode. A fourth package would add another manifest, test root and dependency edge without removing any coupling: it would still depend on core for policy and approval. Keeping it in core also keeps the build script and the plugin test at the root, where the committed bundle lives.

### 6. Fix the two reverse references by extraction

`ExitCode` moves to `packages/core/src/exit-codes.ts`; `errors.ts` imports it locally. `Io` and `RuntimeFactory` move to `packages/core/src/io.ts`; `bench/ponytail.ts` and `pipeline/refine.ts` import from there, and `packages/cli/src/command.ts` imports `Io` from core and re-exports the type for its command modules. The values and interfaces do not change.

Rejected: duplicating `ExitCode` or `Io` (drift) and putting `Io` in protocol (it references core's `FactoryConfig` and `AgentRuntime`).

### 7. Dependency rule enforced by a test, not only by tsconfig paths

`test/architecture.test.ts` walks every `.ts` file under `packages/`, extracts static imports and applies the allowed-edge table. Relative imports may not leave the package except for root `templates/` text assets and, from test files, the shared root `test/` support. The checker is a pure function with unit cases, so a synthetic violation fails a test rather than only the real tree. tsconfig `paths` make the editor fast; they do not enforce direction.

Rejected: a Biome `noRestrictedImports` rule (per-package configuration, weak on relative escapes) and package `exports` alone (they cannot stop a relative path).

### 8. Core exposes subpath exports, no barrel index

`packages/core/package.json` uses `"exports": { "./*": "./src/*.ts" }`, so `@loomwright/core/policy/permissions` resolves without a hand-written barrel per directory. A barrel index would be new code and a cycle risk. `protocol` exposes its root index only.

### 9. Tests move with their package, shared fixtures stay

Engine tests move to `packages/core/test`; command tests move to `packages/cli/test`; repo-level suites (`docs`, `config`, `release-scripts`, `plugin`, `rebrand`, `architecture`) stay at the root. `test/setup.ts`, `test/helpers.ts` and `test/fixtures/**` stay shared; moved tests reach them with `../../../test/...`. `bunfig.toml` keeps preloading the root setup file. `biome.json` needs no rule change: it already includes `**` and respects `.gitignore`, which covers the generated package files and `dist`.

### 10. Build, release and CI stay root-orchestrated

The root scripts remain the gate surface. `build` bundles `packages/cli/src/bin.ts` to `packages/cli/dist/cli.js`, writes `packages/cli/dist/package.json`, regenerates the root plugin bundle from `packages/core/src/plugin/entry.ts` and runs `scripts/prepare-package.ts`. `scripts/sync-version.ts` reads `packages/cli/package.json` and writes `packages/core/src/version.ts`; `scripts/changelog-section.ts` reads `packages/cli/CHANGELOG.md`. Changesets watches `packages/**`. CI packs in `packages/cli` and keeps the Node 20.3/22/24 smoke matrix. Each package has a tsconfig that extends the root for editor and package-local runs; the root `tsc --noEmit` still includes `packages`, `test` and `scripts`, so `bun run check` sees the whole tree.

The existing CI triggers have no `paths` filters; adding filters would change when CI runs, which is outside a pure restructure. Only the file/path references inside the workflow change.

### 11. ADR-0043 and a patch changeset

ADR-0043 records the layout, the dependency rule and the plugin placement. It avoids the capitalised product name so the historical scan in `test/docs.test.ts` stays valid without narrowing it. The tarball's file list is unchanged, but the bundle bytes inside it change with the embedded source paths, so the change carries a patch changeset for `@loomwright/cli`.

## Contract changes

None. No API schema, event, Helm value or workspace file format changes. The package manifest path and the source layout are internal.

## Protected files

No protected file is edited. The moved paths are checked as follows:

- `factory.config.jsonc`: `instructions` is empty, `graph.exclude` already matches `**/dist/**` (which covers `packages/cli/dist`), and `gates.overrides` is empty. No edit.
- `factory.lock.json`: contains no source paths. Its hash for `.opencode/plugins/factory.js` changes after the next `loomwright update`, not here.
- `.opencode/plugins/factory.js`: still the old bundle. The final report must ask for `loomwright update` after landing to regenerate it and refresh the lock.
- `.opencode/` standards and agents, `openspec/specs/`: no moved source path. No edit.
- `AGENTS.md`: names the old layout (`src/cli/`, `src/config/`, `src/policy/`, `src/plugin/`, `src/version.ts`, `test/gates-resolve.test.ts`, `test/opencode-runtime.e2e.test.ts`). It is protected, so the final report lists the `packages/cli/src/…`, `packages/core/src/…` and `packages/*/test/…` rewrite as a post-landing follow-up and does not edit it here.
- `openspec/config.yaml`: workspace layout stays `single`; no edit.

## Risks

- Bundle bytes change because both bundles embed source paths. The entry point, dependency closure and size class must stay; the verification compares size class and the e2e transcripts, not exact bytes.
- The root `CHANGELOG.md` is a symlink after this change. Node, git, Changesets and GitHub follow it; a tool that refuses symlinks would break the release notes.
- `packages/cli/README.md`, `packages/cli/LICENSE` and `packages/cli/templates/addons/ponytail/LICENSE` only exist after `bun run build`. Packing without building would produce a short tarball, so CI keeps build before pack and the task documentation says so.
- `bun run release:version` regenerates `test/fixtures/install-1.0.0.json`; the new plugin bundle comment paths would change that snapshot. Do not run it during this change; the release flow owns it.
- The design environment does not execute the build. Task 1.1 captures the exact baseline numbers before its first edit; the verifier compares the test count and tarball list against them.
- The e2e transcripts stay historical in this change: `docs/e2e/**` must keep its existing text, and task 1.8 verifies the acceptance rows only. A re-record is deferred to a separate compatibility change, because the current recorder writes the capitalised product name (`scripts/e2e-transcript.ts`) while `test/docs.test.ts` still forbids it under `docs/e2e/`; that change narrows the historical scan first, then records. The committed transcripts are not touched here.
- Protected files must be refreshed by the human/factory after landing (`loomwright update`), because this change cannot edit them.
- Out of scope: package/bin/org rename, typed event stream, TUI, new features, dependency upgrades, bug fixes.
