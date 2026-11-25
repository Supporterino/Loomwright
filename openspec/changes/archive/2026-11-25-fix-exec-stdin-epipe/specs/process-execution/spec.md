# process-execution Specification

## ADDED Requirements

### Requirement: A failed write to a child's stdin does not fail the wrapper

`exec` MUST NOT let an `error` event from a child's stdin escape as an uncaught exception. A
child may exit or close fd 0 before the wrapper finishes writing (for example an `opencode
auth import` that rejects its flags), and the resulting `EPIPE` or `ERR_STREAM_DESTROYED` means
only that the child stopped listening. The guard MUST be in place before `end()` is called, MUST
ignore every stdin error rather than only `EPIPE`, and MUST NOT settle the promise or attach
text to stderr. The child's exit code and stderr remain the failure signal.

#### Scenario: a child that closes stdin before a large write still settles

- **WHEN** `exec(["sh", "-c", "exec 0<&-; sleep 0.05"], { input: "x".repeat(4 * 1024 * 1024) })`
  runs
- **THEN** the call resolves with `code` 0 instead of throwing an uncaught `EPIPE`
- **AND** `stderr` is `""`

#### Scenario: a child that closes stdin and exits non-zero keeps its exit code

- **WHEN** `exec(["sh", "-c", "exec 0<&-; exit 3"], { input: "x".repeat(4 * 1024 * 1024) })`
  runs
- **THEN** the call resolves with `code` 3
- **AND** it does not throw or settle with an empty success

### Requirement: `exec` keeps feeding stdin normally

The stdin guard MUST NOT change the successful path. `exec` MUST still write `options.input`
(and write and close an empty stdin when `input` is absent) so commands that read stdin keep
receiving their payload.

#### Scenario: a child that reads stdin receives the input

- **WHEN** `exec(["sh", "-c", "cat"], { input: "hello" })` runs
- **THEN** the result has `code` 0 and `stdout` `"hello"`

#### Scenario: a child that reads stdin is still ended when there is no input

- **WHEN** `exec(["sh", "-c", "cat"], { cwd })` runs without `input`
- **THEN** the child sees end-of-file on stdin and exits
- **AND** the result has `code` 0 and empty `stdout`

### Requirement: A stdin failure leaves `ExecResult` unchanged

A stdin error MUST NOT alter the result contract: the exit code comes from the child's `close`
event, `stdout` and `stderr` contain only what the child wrote, `timedOut` reflects only the
timeout path, and `durationMs` is measured as before. The timeout path MUST keep killing the
child with `SIGKILL`, destroying its output streams and resolving with `code` null and
`timedOut` true, including when the child also closed stdin. Ignoring the stdin error MUST NOT
resolve the promise early, because `close` carries the real exit code.

#### Scenario: a stdin failure adds nothing to stderr and does not settle early

- **WHEN** `exec(["sh", "-c", "exec 0<&-; sleep 0.2"], { input: "x".repeat(4 * 1024 * 1024) })`
  runs
- **THEN** the result's `stderr` is `""` and `code` is 0
- **AND** the call takes at least the child's 0.2 s, so it settled on `close` and not on the
  stdin error

#### Scenario: a timed-out child that closed stdin still reports the timeout

- **WHEN** `exec(["sh", "-c", "exec 0<&-; sleep 2"], { input: "x".repeat(4 * 1024 * 1024), timeoutMs: 200 })`
  runs
- **THEN** the result has `timedOut` true and `code` null
- **AND** no uncaught stdin error replaces that result

### Requirement: `doctor` reports a credential import failure instead of crashing

When `opencode auth import --standalone` exits non-zero without reading its stdin during
`loomwright doctor`, the command MUST produce a complete report. The credential `import` check
MUST be a warning whose detail names the failure, and the CLI MUST NOT abort with an unhandled
`EPIPE` stack trace. The report MUST still print and the exit code MUST follow the existing rule
(warnings exit 0, failed checks exit 4).

#### Scenario: an import that exits early becomes a warning

- **WHEN** the opencode stub answers `auth export` with one `anthropic` credential and exits 2
  from `auth import` without reading stdin, and `loomwright doctor --json` runs
- **THEN** the command prints a parseable `DoctorReport`
- **AND** the `import` check has status `warn` and a detail containing "could not import"
- **AND** stderr contains no `EPIPE` stack trace
