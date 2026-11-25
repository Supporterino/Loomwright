# Tasks: persist an answer when no driver consumes the inbox

## 1. loomwright
- [ ] 1.1 Add the shared answer application, the run-lock helper and the standalone event writer; refactor the driver path
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/pipeline/answer.ts, packages/core/src/pipeline/drive.ts, packages/core/src/pipeline/clarify.ts, packages/core/src/pipeline/design.ts, packages/core/src/state/run.ts, packages/core/src/events/standalone.ts
- [ ] 1.2 Make `Factory.answer` persist immediately when no driver owns the run; cover the idle, driven, double-delivery, fallback, malformed-id and no-install cases
  - repo: loomwright
  - deps: 1.1
  - touches: packages/core/src/factory.ts, packages/core/test/factory-commands.test.ts, packages/core/test/factory.test.ts
- [ ] 1.3 Cover the refreshed and restarted questions pane in the TUI tests
  - repo: loomwright
  - deps: 1.2
  - touches: packages/tui/test/controls.test.ts
- [ ] 1.4 Document the immediate answer path, the recorded/answered split and the residual sequence race; record ADR-0050, keep ADR-0046 and the pinned TUI phrases untouched, and cover ADR-0050 and the inbox wording in the docs suite
  - repo: loomwright
  - deps: 1.1
  - touches: docs/events.md, docs/tui.md, docs/cli.md, ARCHITECTURE.md, docs/decisions/0050-answer-without-driver.md, docs/decisions/README.md, test/docs.test.ts
- [ ] 1.5 Add the patch changeset for `@loomwright/core` and `@loomwright/cli`
  - repo: loomwright
  - deps: 1.2
  - touches: .changeset/**
- [ ] 1.6 Run the full gate plus the factory-command and TUI control suites, and verify an idle answer by hand in a temporary workspace
  - repo: loomwright
  - deps: 1.1, 1.2, 1.3, 1.4, 1.5
  - touches: none
