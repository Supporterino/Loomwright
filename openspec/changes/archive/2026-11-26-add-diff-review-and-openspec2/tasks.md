## 1. loomwright

- [x] 1.1 Widen the OpenSpec version range and update its pin assertions
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/versions.ts, packages/core/src/tools.ts, packages/core/test/tools.test.ts, packages/core/test/lock.test.ts, packages/cli/test/doctor.test.ts

- [x] 1.2 Render OpenSpec 2.x output from `.agents` and commit it on install
  - repo: loomwright
  - deps: 1.1
  - touches: packages/core/src/openspec/cli.ts, packages/core/src/workspace/sync.ts, packages/core/test/openspec-2.test.ts

- [x] 1.3 Protect generated `.agents/skills` and rebuild the plugin bundle
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/policy/paths.ts, packages/core/src/policy/permissions.ts, packages/core/src/policy/sandbox.ts, packages/core/test/policy-lists.test.ts, packages/core/test/render.test.ts, templates/plugin/factory-plugin.txt

- [x] 1.4 Add the read-only change diff reader and share land's repo/base resolution
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/git/change-repos.ts, packages/core/src/pipeline/diff.ts, packages/core/src/pipeline/land.ts, packages/core/test/diff.test.ts

- [x] 1.5 Add the `diff` CLI command and the pre-land next-step hint
  - repo: loomwright
  - deps: 1.4
  - touches: packages/cli/src/commands/diff.ts, packages/cli/src/main.ts, packages/cli/src/commands/pipeline-commands.ts, packages/core/src/factory.ts, packages/cli/test/diff.test.ts, packages/cli/test/cli-usage.test.ts, packages/cli/test/pipeline.test.ts, docs/cli.md

- [x] 1.6 Narrow the focused task's activity scope to its own lines
  - repo: loomwright
  - deps: none
  - touches: packages/tui/src/model/activity-scope.ts, packages/tui/src/model/view-model.ts, packages/tui/test/scope.test.ts, packages/tui/test/activity-pane.test.ts

- [x] 1.7 Add the TUI `d` diff pane for done runs
  - repo: loomwright
  - deps: 1.4, 1.6
  - touches: packages/tui/src/model/keys.ts, packages/tui/src/model/view-model.ts, packages/tui/src/model/ui-data.ts, packages/tui/src/controls/diff-pane.ts, packages/tui/src/entry.tsx, packages/tui/src/help.ts, packages/tui/src/strings.ts, packages/tui/test/diff-pane.test.ts, packages/tui/test/keys.test.ts, packages/tui/test/help.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/views.test.ts, packages/tui/test/replay.test.ts, packages/tui/test/fixtures/frames/finished-80x24.txt, packages/tui/test/fixtures/frames/finished-120x40.txt, packages/tui/test/fixtures/frames/diff-80x24.txt, packages/tui/test/fixtures/frames/diff-120x40.txt

- [x] 1.8 Record the ADRs and the changeset
  - repo: loomwright
  - deps: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
  - touches: docs/decisions/0051-openspec-2-support.md, docs/decisions/0052-pre-land-diff-review.md, docs/decisions/README.md, .changeset/add-diff-review-and-openspec2.md
