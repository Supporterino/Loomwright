# Tasks: Typed event stream and command API

## 1. loomwright

- [x] 1.1 Capture the baseline goldens and the progress/control inventory
  - repo: loomwright
  - deps: none
  - touches: packages/cli/test/fixtures/baseline/**, packages/cli/test/baseline-capture.ts

## 2. loomwright

- [x] 2.1 Add the version 1 event protocol, snapshot/reducer and command union (including pause) to `packages/protocol`
  - repo: loomwright
  - deps: 1.1
  - touches: packages/protocol/src/**, packages/protocol/test/**, test/config.test.ts

## 3. loomwright

- [x] 3.1 Add the event sink interface, emitter, JSONL/terminal/in-memory sinks and land retention reporting
  - repo: loomwright
  - deps: 2.1
  - touches: packages/core/src/events/**, packages/core/src/pipeline/land.ts, packages/core/test/events.test.ts, packages/cli/test/land.test.ts

- [x] 3.2 Wire run, phase, approval, question, note and agent events through the terminal sink
  - repo: loomwright
  - deps: 3.1
  - touches: packages/core/src/pipeline/context.ts, packages/core/src/pipeline/design.ts, packages/core/src/pipeline/approve.ts, packages/core/src/pipeline/drive.ts, packages/core/src/pipeline/progress.ts, packages/core/test/progress.test.ts

- [x] 3.3 Wire task, gate, install, usage and heartbeat events through the terminal sink
  - repo: loomwright
  - deps: 3.2
  - touches: packages/core/src/pipeline/implement.ts, packages/core/src/pipeline/finish.ts, packages/core/src/pipeline/contracts.ts, packages/core/src/scheduler/scheduler.ts, packages/core/src/gates/run.ts, packages/core/test/scheduler.test.ts

## 4. loomwright

- [x] 4.1 Add `readEvents` and `tailEvents` with partial-line and gap handling
  - repo: loomwright
  - deps: 3.3
  - touches: packages/core/src/events/**, packages/core/test/events-reader.test.ts

- [x] 4.2 Add the `RunSnapshot` state projection and reducer parity helpers
  - repo: loomwright
  - deps: 4.1
  - touches: packages/core/src/events/**, packages/core/test/events-reduce.test.ts

## 5. loomwright

- [x] 5.1 Add the `Factory.open` read API for `status`, `listRuns` and `events`
  - repo: loomwright
  - deps: 4.2
  - touches: packages/core/src/factory.ts, packages/core/src/events/**, packages/core/test/factory.test.ts

- [x] 5.2 Add the `Factory` command methods, the answer/pause inbox and the pause safe point
  - repo: loomwright
  - deps: 5.1
  - touches: packages/core/src/factory.ts, packages/core/src/events/**, packages/core/src/pipeline/drive.ts, packages/core/test/factory-commands.test.ts

- [x] 5.3 Rewire `run`, `approve`, `resume`, `status`, `abort` and `retry` as thin `Factory` wrappers
  - repo: loomwright
  - deps: 5.2
  - touches: packages/cli/src/commands/pipeline-commands.ts, packages/cli/src/commands/state-commands.ts, packages/cli/test/pipeline.test.ts, packages/cli/test/state-commands.test.ts

- [x] 5.4 Add the `events` command and drive `status --watch` from `tailEvents`
  - repo: loomwright
  - deps: 5.3
  - touches: packages/cli/src/commands/events.ts, packages/cli/src/commands/state-commands.ts, packages/cli/src/main.ts, packages/cli/test/events-command.test.ts, packages/cli/test/state-commands.test.ts, packages/cli/test/cli-usage.test.ts, packages/cli/test/completion.test.ts, docs/cli.md

## 6. loomwright

- [x] 6.1 Add the golden event sequences and reducer parity tests for `single` and `submodules`
  - repo: loomwright
  - deps: 5.4
  - touches: packages/cli/test/events-golden.test.ts, packages/cli/test/fixtures/events/**

- [x] 6.2 Add the JSONL robustness and payload cap/redaction tests
  - repo: loomwright
  - deps: 6.1
  - touches: packages/core/test/events-robustness.test.ts, packages/core/src/events/**, packages/core/test/events-reader.test.ts

- [x] 6.3 Write `docs/events.md`, ADR-0046 and the architecture/README updates
  - repo: loomwright
  - deps: 6.2
  - touches: docs/events.md, docs/decisions/0046-typed-event-stream.md, docs/decisions/README.md, ARCHITECTURE.md, README.md, docs/cli.md, test/docs.test.ts

- [x] 6.4 Confirm acceptance and report follow-ups and protected-file edits (edits nothing)
  - repo: loomwright
  - deps: 6.3
  - touches: none
