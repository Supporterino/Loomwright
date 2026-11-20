# Tasks — fix-tui-findings-log-styling

## 1. View model: findings and reword

- [ ] 1.1 Surface spec findings, the paused banner and the list summary
  - repo: loomwright
  - deps: none
  - touches: packages/tui/src/model/view-model.ts, packages/tui/src/strings.ts, packages/tui/src/views/run-list.tsx, packages/tui/src/views/header.tsx, packages/tui/test/view-model.test.ts
- [ ] 1.2 Decide reword availability and build its argv
  - repo: loomwright
  - deps: 1.1
  - touches: packages/tui/src/model/view-model.ts, packages/tui/src/launch/launcher.ts, packages/tui/test/view-model.test.ts, packages/tui/test/launcher.test.ts

## 2. Scoped activity

- [ ] 2.1 Derive a task's activity scope in one pure function
  - repo: loomwright
  - deps: 1.2
  - touches: packages/tui/src/model/activity-scope.ts, packages/tui/src/model/view-model.ts, packages/tui/test/scope.test.ts

## 3. Scroll and budgets

- [ ] 3.1 Add a pure viewport module for offsets and windows
  - repo: loomwright
  - deps: 2.1
  - touches: packages/tui/src/model/viewport.ts, packages/tui/test/viewport.test.ts
- [ ] 3.2 Give the run list and task graph row budgets and scroll offsets
  - repo: loomwright
  - deps: 3.1
  - touches: packages/tui/src/model/view-model.ts, packages/tui/src/model/keys.ts, packages/tui/src/views/run-list.tsx, packages/tui/src/views/task-graph.tsx, packages/tui/src/views/run-view.tsx, packages/tui/src/views/frame.tsx, packages/tui/src/entry.tsx, packages/tui/test/view-model.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**

## 4. Log pane

- [ ] 4.1 Add the scoped full-height activity pane and the four-row tail floor
  - repo: loomwright
  - deps: 3.2
  - touches: packages/tui/src/controls/activity-pane.ts, packages/tui/src/model/view-model.ts, packages/tui/src/model/keys.ts, packages/tui/src/views/activity.tsx, packages/tui/src/views/run-view.tsx, packages/tui/src/views/frame.tsx, packages/tui/src/entry.tsx, packages/tui/src/help.ts, packages/tui/test/activity-pane.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**

## 5. Questions

- [ ] 5.1 Let the questions pane compose, record and advance
  - repo: loomwright
  - deps: 4.1
  - touches: packages/tui/src/controls/questions.tsx, packages/tui/src/entry.tsx, packages/tui/test/controls.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**

## 6. Gate, reword and styling

- [ ] 6.1 Collapse the approval overlay to its banner
  - repo: loomwright
  - deps: 5.1
  - touches: packages/tui/src/approval/overlay.ts, packages/tui/src/entry.tsx, packages/tui/src/views/header.tsx, packages/tui/test/approval.test.ts, packages/tui/test/replay.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**
- [ ] 6.2 Add the reword panel with findings and a multi-line prompt
  - repo: loomwright
  - deps: 6.1
  - touches: packages/tui/src/controls/reword.ts, packages/tui/src/model/view-model.ts, packages/tui/src/entry.tsx, packages/tui/test/reword.test.ts, packages/tui/test/controls.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**
- [ ] 6.3 Apply the styling pass on the existing tokens
  - repo: loomwright
  - deps: 6.2
  - touches: packages/tui/src/views/**, packages/tui/src/approval/overlay.ts, packages/tui/src/controls/questions.tsx, packages/tui/test/views.test.ts, packages/tui/test/accessibility.test.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**

## 7. Snapshots

- [ ] 7.1 Add the new frame states and fixtures at both sizes
  - repo: loomwright
  - deps: 6.3
  - touches: packages/tui/test/frame-states.ts, packages/tui/test/frames.test.ts, packages/tui/test/fixtures/frames/**, packages/tui/test/replay.test.ts, test/fixtures/tui/approval-gate.jsonl, packages/tui/test/accessibility.test.ts

## 8. Docs and release

- [ ] 8.1 Document the keys and flows, add ADR-0048 and a changeset naming 1.3.0
  - repo: loomwright
  - deps: 7.1
  - touches: docs/tui.md, docs/decisions/README.md, docs/decisions/0048-tui-scroll-log-and-reword.md, .changeset/tui-findings-log-scroll.md
