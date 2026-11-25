# 0050 — answer without a driver

## Context

ADR-0046 made `answer` and `pause` inbox commands consumed at a safe point. That fits a run a
driver owns, but it leaves a run with no driver unable to record an answer: the TUI writes the
file, and nothing consumes it until a driver starts again. A run waiting at `awaiting-approval` or
`paused` does not need the pipeline to move to take an answer, so the question could stay
unanswered indefinitely even though the user answered it.

## Decision

This ADR extends ADR-0046; it does not supersede it.
- `answer` uses the inbox only while a live driver owns the run: the active lock names that run
  and `driverAlive` is true. A live driver keeps ADR-0046's safe-point contract.
- With no live driver the writing process persists the answer immediately. It takes the run's
  state lock, re-checks liveness under it, marks the clarification answered (or appends the
  unrecorded-question fallback at step `answer`), appends exactly one `question.answered`, and
  rewrites both `.factory/clarifications/<id>.md` and the change's `questions.md` (the draft's
  copy when the run has a `draft`). It leaves no `answer` file behind and removes a stale file for
  the same question, so a later driver cannot apply an outdated answer.
- The state change, the fallback and the clarification-file rewrite are one shared function used
  by the driver and the direct path.
- An already-answered record is idempotent: a re-delivered or stale answer neither appends a
  second `question.answered` nor changes the recorded text, though it may rewrite the files.
- The direct path writes its event through the same JSONL sink as the driver, so `seq`,
  redaction and the 8 KiB cap are unchanged. It does not load the install config or the install
  marker.
- `pause` stays an inbox request consumed at a safe point.

Alternatives rejected: a daemon that drains the inbox (a second process to supervise and a second
source of truth); leaving the answer unapplied until the next command starts a driver.

## Consequences

- An answer is recorded and visible immediately on a run that no driver owns, including at
  `awaiting-approval` and `paused`; the phase, approvals and tasks do not change.
- The TUI can read `answered — <answer>` from refreshed run state instead of `recorded — applies
  at the next step`, which now describes only the live-driver window.
- A driver can claim the run lock between the direct path's liveness re-check and its event
  append. The answer stays correct in the run file and the clarification files, but the two
  writers can reuse a `seq`: the state remains correct and a tailer reports a gap. This residual
  is accepted rather than adding a cross-process sequence lock.
- Answering needs no install marker or config, so a workspace mid-install or with a broken config
  can still record an answer.
