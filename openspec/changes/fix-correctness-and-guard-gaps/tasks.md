# Tasks — fix-correctness-and-guard-gaps

Every task runs `bun run format` and leaves `bun run check` green. Any task that changes
`packages/core/src/policy/` or `packages/core/src/plugin/` regenerates
`templates/plugin/factory-plugin.txt` with `bun run build:plugin` and keeps `test/plugin.test.ts`
green. Guard behaviour changes carry a `minor` changeset; every other task carries a `patch`
changeset where the repo convention requires one. `npx`/`pnpx`, the silent-catch scan and the
sandbox guard all touch files another task owns; the dependency lines below keep them serial.

## 1. loomwright

- [ ] 1.1 Add the sandbox nesting marker and record the superseded workspace exception
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/policy/sandbox.ts, packages/core/src/gates/run.ts, packages/core/src/plugin/entry.ts, packages/core/src/runtime/opencode.ts, packages/core/src/doctor/doctor.ts, packages/core/test/sandbox.test.ts, packages/cli/test/doctor.test.ts, test/plugin.test.ts, test/docs.test.ts, templates/plugin/factory-plugin.txt, docs/decisions/0026-hardening-and-sandbox.md, docs/decisions/0041-unsandboxed-workspace.md, .changeset/sandbox-nesting-guard.md

- [ ] 1.2 Pin the plugin build root and regenerate the committed bundle
  - repo: loomwright
  - deps: 1.1
  - touches: scripts/build-plugin.ts, test/plugin.test.ts, templates/plugin/factory-plugin.txt, .changeset/plugin-bundle-cwd.md

- [ ] 1.3 Inspect `npx` and `pnpx` as package runners and record the decision
  - repo: loomwright
  - deps: 1.2
  - touches: packages/core/src/policy/shell.ts, packages/core/test/shell-policy.test.ts, packages/core/test/hardening.test.ts, test/docs.test.ts, templates/plugin/factory-plugin.txt, docs/decisions/0049-package-runner-aliases.md, docs/decisions/README.md, .changeset/guard-runner-aliases.md

- [ ] 1.4 Honour help only as the first token after the command
  - repo: loomwright
  - deps: none
  - touches: packages/cli/src/main.ts, packages/cli/test/cli-usage.test.ts, docs/cli.md, .changeset/cli-help-values.md

- [ ] 1.5 Extract the TUI status/control seams and poll the selected run only
  - repo: loomwright
  - deps: none
  - touches: packages/tui/src/entry.tsx, packages/tui/src/model/status.ts, packages/tui/src/model/controls.ts, packages/tui/src/model/ui-data.ts, packages/tui/test/status.test.ts, packages/tui/test/controls.test.ts, test/architecture.test.ts, .changeset/tui-status-seam.md

- [ ] 1.6 Share the tarball artifact check and record the measured TUI size
  - repo: loomwright
  - deps: none
  - touches: scripts/check-tarball.ts, .github/workflows/ci.yml, .github/workflows/release.yml, test/release-scripts.test.ts, test/docs.test.ts, docs/decisions/0047-tui.md

- [ ] 1.7 Make the `status --watch` test wait for frames instead of a clock
  - repo: loomwright
  - deps: none
  - touches: packages/cli/test/state-commands.test.ts, .changeset/watch-test-flake.md

- [ ] 1.8 State a reason at every silent catch and surface doctor's unreadable `package.json`
  - repo: loomwright
  - deps: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
  - touches: packages/core/src/**, packages/cli/src/**, packages/tui/src/**, scripts/**, packages/core/test/silent-catch.test.ts, packages/cli/test/doctor.test.ts, templates/plugin/factory-plugin.txt, .changeset/silent-catch-reasons.md
