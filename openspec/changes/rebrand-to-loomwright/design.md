# Design

## Context

A single TypeScript repo is both the product and its own factory workspace. Identity comes from `package.json` (`name`, `description`, `bin`) and `src/version.ts` (`PACKAGE_NAME`, `runVersion`). User-facing text is spread across `src/cli/**`, the pipeline/doctor/update/lock/state modules, and text rendered from source (`src/render/workspace.ts`, `src/config/render.ts`, `src/plugin/entry.ts` → `templates/plugin/factory-plugin.txt`). The on-disk contract is load-bearing: `factory.config.jsonc`, `factory.lock.json`, `.factory/`, `factory-records/`, `.opencode/`, the `AI_FACTORY_*` variables and the plugin id are baked into existing workspaces.

## Decisions

1. **Rename the identity, not the common noun.** Change the literal product name, package name, binary and command examples. Keep generic prose such as "this factory", "the factory CLI" and the `factory-*` file names. The generated agent prompts and standards contain no instance of the old name — they say "the factory" generically — so they are not rewritten. Rewriting every "factory" would touch hundreds of unrelated lines, rewrite historical text and turn a rename into a redesign.

2. **Keep every persisted marker and identifier byte-identical.** `BLOCK_MARKERS` (`AGENTS.md`, `.gitignore`), the clarify question markers, `HOOK_MARKER`/`CHAINED_HOOK`, the completion rc block markers and shell function identifiers, `.ai-factory-*` temp suffixes and the `url.ai-factory-push-blocked://` git scheme stay as they are. Alternative: rename them with a migration — rejected because the AGENTS.md block lives in user-edited files, the update path is a three-way merge, and existing rc files would gain a second completion block. Changing the hook's human-readable text while keeping the marker is safe: `doctor` reports the old hook as `outdated` and `init` refreshes it.

3. **Keep `ai-factory` as a permanent deprecated bin alias.** `bin` exposes both names at `./dist/cli.js`. Alternative: drop the alias — rejected: it breaks existing scripts and the CI/release steps that invoke `$PREFIX/bin/ai-factory`, and the task explicitly wants backwards compatibility.

4. **Completion registers both commands, keeps its markers.** The generated bash/zsh/fish scripts register `loomwright` and `ai-factory`, invoke `loomwright __complete`, and keep the existing rc block markers and function identifiers so an existing `completion --install` block is replaced in place instead of duplicated.

5. **Generated files are changed at their source only.** `.opencode/**`, `factory.lock.json`, `AGENTS.md` and the rendered `openspec/config.yaml` in this repo are off-limits to tasks. The change updates `src/render/`, `src/config/render.ts` and `src/plugin/`, then the human re-renders with the new build after landing.

6. **Plugin id stays `ai-factory`; its user-facing message changes.** The id is an allow-list/governance value; the blocked-call message (`Loomwright blocked this call:`) is text an agent or user reads.

7. **Historical material is frozen.** Past `CHANGELOG.md` sections, `docs/decisions/**`, `docs/research/**`, `docs/e2e/**`, `docs/audit/**` and `test/fixtures/install-*.json` keep their text. The e2e transcript recorder's own header is updated, but the recorded transcripts are not regenerated. A test asserts the historical corpus never mentions `Loomwright`, which is cheap proof that it was not rewritten.

8. **CHANGELOG gets an `## Unreleased` section.** Writing a guessed version heading would be duplicated when `changeset version` prepends the real section at release. The release step replaces the placeholder; release mechanics stay human. The changeset itself is `major`, which is what "breaking" means to changesets.

9. **Release automation changes only the package probe and the smoke-test binary.** `release.yml` queries `@loomwright/cli`; both workflows invoke `$PREFIX/bin/loomwright`. The `npm` environment, `id-token: write` and `--provenance` trusted-publisher configuration are untouched, and nothing is published from this change.

10. **Lockfile.** The `package.json` rename changes the workspace name recorded in `bun.lock`, so the packaging task regenerates it with `bun install`; it is never hand-edited.

11. **URLs stay.** `repository`, `homepage` and `bugs` still point at `Supporterino/AI-Factory`; the flip is a follow-up in the change report, not a task, because `loomwright/cli` does not exist yet.

## Contract changes

None. No API, event or Helm contract is configured in this workspace.

## Risks

- A `major` changeset on `0.12.0` makes changesets propose `1.0.0`. If a `0.13.0` release is intended, the bump must be changed before `bun run release:version`; this is recorded as an open question.
- README's relative mark path renders on GitHub; npm resolves relative README images against the repository URL, which still points at the old repository until the follow-up.
- Existing workspaces will see their installed pre-push hook as `outdated` until `init` refreshes it, and this repo's own `.opencode/**`, `AGENTS.md`, `factory.lock.json` and `openspec/config.yaml` keep the old name until the human re-renders. `doctor` will report drift until then.
- A change to guard code (`src/policy/`, `src/plugin/`) runs under the previous bundle; unit suites and a fixture run prove it, not dogfooding alone.
- The completion script keeps `_ai_factory_*` identifiers and the rc markers, and the AGENTS.md start marker keeps its `(managed by ai-factory; …)` parenthetical, on purpose: renaming them would duplicate blocks in existing user files. A reviewer may read that as an incomplete rename.

## After landing

The change report must say:

1. Re-render the workspace with the new build: `bun run build && bun run dev update`, then check `ai-factory doctor` (the alias still works).
2. Follow-up: flip `repository`, `homepage` and `bugs` to the `loomwright` org once the repository has moved.

No secrets were read and nothing was published.
