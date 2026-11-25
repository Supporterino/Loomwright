# Proposal: an answer recorded in the TUI is persisted even when no driver runs

## Why

`Factory.answer` only writes `.factory/commands/<id>/answer-<ts>.json` and returns. The only reader
is a live driver: `drive()` consumes the inbox before and after each step. On a run that is not
being driven — `awaiting-approval`, `paused`, `queued`, or one whose driver died — nothing ever
reads the file, so the run stays `unanswered`, no `question.answered` is appended,
`questions.md` keeps `_(not answered yet)_`, and a fresh TUI shows the question as unanswered
again. Even when a driver does consume the file, `applyAnswer` updates run state and emits the
event but never rewrites the clarification files, so `questions.md` stays stale for an answer the
run accepted.

## What Changes

- `Factory.answer` validates the command, then checks the active lock. When a live driver owns the
  run it keeps today's behaviour: write one validated inbox file, change no state, and let the
  driver apply it at its next safe point.
- When no live driver owns the run, `Factory.answer` applies the answer immediately: take the run
  lock, mark the matching clarification answered (or append the existing step-`answer` fallback),
  emit exactly one `question.answered` from the writing process, rewrite both
  `.factory/clarifications/<id>.md` and the change's `questions.md` (the draft's copy when the run
  has a `draft`), and leave no inbox file behind. Stale `answer` files for the same question are
  removed so a later driver cannot apply an outdated answer.
- The apply logic becomes one shared function used by the driver and the direct path, so the
  driver also refreshes `questions.md`.
- A re-delivered or stale answer for a record that is already answered is a no-op: no second
  event and no changed answer text.
- The direct path writes through the JSONL event sink only and does not load the install config,
  so `openReadOnly` can answer in a workspace where the questions pane already opens.
- Documentation, a new ADR-0050 extending ADR-0046, a patch changeset and tests for both the
  immediate and the live-driver paths land with the fix. The TUI keeps its keys, composer and
  `recorded` label; a refreshed run reads the persisted answer from run state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `typed-event-stream`: `answer` reaches the inbox only while a live driver owns the run and is
  otherwise persisted immediately, idempotently, with the clarification files refreshed; the
  library API and the documentation/ADR requirement follow.
- `factory-tui`: the questions pane reads an immediately persisted answer as `answered — <text>`
  and keeps `recorded — applies at the next step` for the live-driver window only.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** `Factory.answer(changeId, answer, question?)` keeps its signature and now resolves
  after the answer is durable when no driver owns the run. No other `Factory` member changes.
- **Contracts:** none configured. No event type, payload, API schema or Helm value changes; the
  clarification record schema is unchanged.
- **Data:** run state's `clarifications` gains the answer/`answered` status, `.factory/events/`
  gains one `question.answered` (plus `run.started` only when the log was empty),
  `.factory/clarifications/<id>.md` and `openspec/changes/<id>/questions.md` are rewritten, and
  `.factory/commands/<id>/` keeps no answer file.
- **Docs:** `docs/events.md`, `docs/tui.md`, `docs/cli.md`, `ARCHITECTURE.md`, the new ADR-0050
  and the decisions index.
- **Protected files:** none edited. No plugin or policy change, so no `bun run build:plugin`.
- **Out of scope:** the stale `port-agent-runtime` run in this workspace; input chunks that carry
  text and `Enter` together; frame write stalls on a slow terminal; any TUI key or composer change.
