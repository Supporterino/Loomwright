---
"@loomwright/cli": minor
---

Every run now writes an append-only event stream to `.factory/events/<id>.jsonl`, a JSONL file
with a versioned envelope and one event type per milestone (run, phase, task, gate, review,
usage). The schemas live in the new `@loomwright/protocol` package and the stream is redacted
the same way state files are.

Two commands read it: `loomwright events <id> [--follow] [--from <n>] [--json]` prints the
stored stream unchanged, and `loomwright status <id> --watch` now reprints its view when an
event arrives instead of only every two seconds, while `--interval` stays the heartbeat and the
fallback poll period. The decision is documented in ADR-0046 and `docs/events.md`.
