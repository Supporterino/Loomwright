# Tasks

## 1. loomwright

- [x] 1.1 Rename the package, version output and lock message to Loomwright
  - repo: loomwright
  - deps: none
  - touches: package.json, bun.lock, src/version.ts, src/lock/lock.ts, test/config.test.ts, test/init.test.ts

- [x] 1.2 Rename CLI usage, help, usage errors and shell completion to loomwright
  - repo: loomwright
  - deps: 1.1
  - touches: src/cli/**, test/cli-usage.test.ts, test/detect-command.test.ts, test/completion.test.ts, test/adopt.test.ts, test/init.test.ts

- [x] 1.3 Rename pipeline, doctor, update, state and artifact output to Loomwright
  - repo: loomwright
  - deps: 1.2
  - touches: src/pipeline/**, src/doctor/**, src/update/**, src/config/load.ts, src/migrations/**, src/state/**, src/artifacts/**, src/workspace/**, src/addons/**, src/scheduler/**, src/graph/**, src/git/hooks.ts, test/doctor.test.ts, test/pipeline.test.ts, test/reword.test.ts, test/review-loop.test.ts, test/update.test.ts, test/hooks.test.ts, test/detect-command.test.ts

- [x] 1.4 Rename generated workspace text and regenerate the plugin bundle
  - repo: loomwright
  - deps: 1.3
  - touches: src/render/workspace.ts, src/config/render.ts, src/config/schema.ts, src/plugin/entry.ts, src/handoff/schema.ts, scripts/build-plugin.ts, scripts/e2e-transcript.ts, templates/plugin/factory-plugin.txt, test/plugin.test.ts, test/policy-lists.test.ts, test/rebrand.test.ts, test/detect-command.test.ts, test/update.test.ts

- [x] 1.5 Rewrite the README brand header and current-facing docs for Loomwright
  - repo: loomwright
  - deps: none
  - touches: README.md, ARCHITECTURE.md, docs/cli.md, docs/plan.md, docs/fleet-update.sh, test/docs.test.ts

- [x] 1.6 Add the breaking changeset and CHANGELOG entry for the rename
  - repo: loomwright
  - deps: none
  - touches: .changeset/**, CHANGELOG.md, test/release-notes.test.ts

- [x] 1.7 Point release automation at @loomwright/cli and the loomwright binary
  - repo: loomwright
  - deps: 1.1
  - touches: .github/workflows/ci.yml, .github/workflows/release.yml, test/release-scripts.test.ts
