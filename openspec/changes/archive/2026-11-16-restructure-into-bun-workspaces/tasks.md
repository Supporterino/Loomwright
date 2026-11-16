# Tasks: Restructure into a Bun-workspaces monorepo

## 1. loomwright

- [x] 1.1 Capture the baseline and scaffold the Bun workspaces
  - repo: loomwright
  - deps: none
  - touches: package.json, packages/**, tsconfig.json, bunfig.toml, biome.json, test/config.test.ts, .changeset/config.json, bun.lock
- [x] 1.2 Move the engine into `packages/core` and fix the two reverse imports
  - repo: loomwright
  - deps: 1.1
  - touches: src/**, packages/core/**, test/**, scripts/**, tsconfig.json, templates/plugin/factory-plugin.txt
- [x] 1.3 Move the command layer into `packages/cli` and retarget the build entry
  - repo: loomwright
  - deps: 1.2
  - touches: src/**, packages/cli/**, packages/core/**, test/**, scripts/**, tsconfig.json, package.json, .gitignore
- [x] 1.4 Move tests next to their packages and add the dependency-rule test
  - repo: loomwright
  - deps: 1.3
  - touches: test/**, packages/core/test/**, packages/cli/test/**, bunfig.toml
- [x] 1.5 Prepare the published package and update the release scripts
  - repo: loomwright
  - deps: 1.4
  - touches: package.json, scripts/**, .gitignore, .changeset/**, CHANGELOG.md, packages/cli/**, packages/core/src/version.ts
- [x] 1.6 Update the CI and release workflows for the new paths
  - repo: loomwright
  - deps: 1.5
  - touches: .github/workflows/**, test/release-scripts.test.ts, biome.json, bunfig.toml
- [x] 1.7 Update the documentation and add ADR-0043
  - repo: loomwright
  - deps: 1.6
  - touches: README.md, ARCHITECTURE.md, docs/cli.md, docs/plan.md, docs/decisions/**
- [x] 1.8 Confirm the acceptance rows are covered and leave the tree unchanged
  - repo: loomwright
  - deps: 1.7
  - touches: docs/e2e/**
    This task edits nothing. It reports the evidence and stops: `bun run lint`,
    `bun run typecheck` and the suite (849 pass, 5 skip) are green, `test/publish.test.ts`
    covers the pack file list and `--version`, `test/plugin.test.ts` covers the committed
    plugin bundle and `test/docs.test.ts` covers the historical scan.
    `docs/e2e/**` MUST stay byte-identical: do not run `scripts/e2e-transcript.ts` and do
    not re-record or edit the transcripts — the legacy header/command text against
    `test/docs.test.ts` is a separate compatibility change. Do not run the gate scripts
    either; the factory runs them after this task.
