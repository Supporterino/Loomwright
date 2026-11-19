## 1. loomwright

- [ ] 1.1 Fold every run event into the activity facts
  - repo: loomwright
  - deps: none
  - touches: packages/tui/src/model/facts.ts, packages/tui/src/model/activity.ts, packages/tui/test/facts.test.ts, packages/tui/test/fold.test.ts, packages/tui/test/performance.test.ts
- [ ] 1.2 Wire the land action through the launcher, controls and footer
  - repo: loomwright
  - deps: 1.1
  - touches: packages/tui/src/launch/launcher.ts, packages/tui/src/controls/actions.ts, packages/tui/src/model/keys.ts, packages/tui/src/model/view-model.ts, packages/tui/src/entry.tsx, packages/tui/src/strings.ts, packages/tui/src/help.ts, packages/tui/test/controls.test.ts, packages/tui/test/launcher.test.ts, packages/tui/test/replay.test.ts, packages/tui/test/view-model.test.ts, packages/tui/test/help.test.ts
- [ ] 1.3 Render the run-level tail at every width and refresh the frame states
  - repo: loomwright
  - deps: 1.1, 1.2
  - touches: packages/tui/src/views/run-view.tsx, packages/tui/src/views/frame.tsx, packages/tui/src/views/activity.tsx, packages/tui/test/views.test.ts, packages/tui/test/frame-states.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**, packages/tui/test/accessibility.test.ts
- [ ] 1.4 Document the all-event tail and the land action, add the changeset
  - repo: loomwright
  - deps: 1.3
  - touches: docs/tui.md, docs/cli.md, README.md, docs/decisions/0047-tui.md, .changeset/*.md
