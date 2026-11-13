# Rebrand to Loomwright

## Why

The product, its npm package and its CLI are still named `ai-factory`, while the brand and the GitHub organisation are Loomwright (`brand/BRAND.md`). Users meet two identities in every command, generated agent prompt and page of documentation. Renaming now, before the repository moves, lets the name change in one reviewable step while the on-disk compatibility surface and the sandbox/gate guarantees stay exactly as they are.

## What Changes

- Publish the package as `@loomwright/cli`, describe it as Loomwright, and expose `loomwright` as the primary binary at `./dist/cli.js`; keep `ai-factory` as a deprecated alias at the same entry so existing scripts and CI keep working.
- Make `PACKAGE_NAME`/`runVersion` print `npx @loomwright/cli@<version>`; `--version` still prints the bare version.
- Rename every user-facing string: CLI usage, help and usage errors; gate, pipeline, review, doctor, update, lock, migration, state, artifact and add-on output; report and usage text.
- Rename generated text: agent descriptions, the AGENTS.md managed block body, the managed-file header, the initial config header, the config-schema title, the handoff schema id, and the plugin's blocked-call message. Regenerate `templates/plugin/factory-plugin.txt` with `bun run build:plugin` and update the strings in `scripts/build-plugin.ts` and `scripts/e2e-transcript.ts`.
- Rewrite README's header with the mark (`brand/icons/mark-on-light-512.png`), the `# Loomwright` wordmark and the tagline "Spec in. Woven software out.", plus a "Renamed from ai-factory" note and a link to `brand/BRAND.md`; update `ARCHITECTURE.md`, `docs/cli.md`, `docs/plan.md` and `docs/fleet-update.sh`.
- Move every test and current-facing fixture assertion to the new names so `bun run check` passes; keep the historical install snapshots and the on-disk compatibility names unchanged.
- Add a breaking changeset for `@loomwright/cli` and a new `CHANGELOG.md` section announcing the rename and the retained alias.
- Point the release workflow's published-version probe at `@loomwright/cli` and smoke-test the `loomwright` binary from the packed tarball; leave the trusted-publisher configuration alone.
- Leave `repository`, `homepage` and `bugs` pointing at `Supporterino/AI-Factory`; flipping them is a follow-up after the repository moves.

## Capabilities

### New Capabilities

- `package-identity`: package name, description, binaries, version output, preserved URLs and gate scripts.
- `product-voice`: user-facing CLI, runtime and generated text.
- `compatibility-surface`: the on-disk names, environment variables, plugin id, markers and historical material that must not change.
- `documentation`: README brand header and current-facing docs.
- `release-notes`: breaking changeset, changelog entry and release-automation package name.

### Modified Capabilities

None. This checkout has no `openspec/specs/` files; every delta is additive.

## Impact

- **Repo:** `loomwright` (single-repo layout; this repository is the product and its own workspace).
- **Package:** `package.json`, `bun.lock`, `src/version.ts`, `src/cli/**`, `src/pipeline/**`, `src/doctor/**`, `src/update/**`, `src/render/workspace.ts`, `src/config/**`, `src/plugin/entry.ts`, `src/git/hooks.ts`, `src/handoff/schema.ts`.
- **Generated artifacts:** `templates/plugin/factory-plugin.txt` (rebuilt), `test/fixtures` assertions (not the historical snapshots).
- **Docs and release:** `README.md`, `ARCHITECTURE.md`, `docs/cli.md`, `docs/plan.md`, `docs/fleet-update.sh`, `CHANGELOG.md`, `.changeset/`, `.github/workflows/{ci,release}.yml`.
- **Contracts:** none configured.
- **Data:** no migration. `factory.config.jsonc`, `factory.lock.json`, `.factory/`, `factory-records/`, `.opencode/` and the `AI_FACTORY_*` variables keep their names. `.opencode/**`, `factory.lock.json`, `AGENTS.md` and the rendered `openspec/config.yaml` are not edited by tasks; the human re-renders them after landing.
