# Proposal: `exec` ignores a child's stdin write failure instead of crashing the CLI

## Why

`packages/core/src/exec.ts` pipes every child's stdin and ends it with
`child.stdin.end(options.input ?? "")`. `child.stdin` is a `Socket`, and when the child exits or
closes fd 0 before that write completes the socket emits `error` (`EPIPE`, or
`ERR_STREAM_DESTROYED` on a destroyed stream). Nothing listens for it, and an `error` event with
no listener is thrown, so the process aborts even when the child itself exited 0. `loomwright
doctor` hits this reproducibly: `checkModels` imports stored credentials through
`opencode auth import --standalone` with the credential JSON on stdin, and when that invocation
exits early (unsupported flag, DB error, crash) the CLI dies with a stack trace instead of
reporting the import warning it already has. The same unguarded path carries `git hash-object -w
--stdin` during install/update and `git patch-id --stable` during a land, so the crash is not
limited to `doctor`.

## What Changes

- `exec` attaches a no-op `error` listener to `child.stdin` before calling `end()`, so a failed
  write to a child's stdin is treated as "the child stopped listening" rather than a fatal CLI
  error. Every stdin error is ignored, not only `EPIPE`, because Bun surfaces the same case as
  `EPIPE` and a destroyed stream can report `ERR_STREAM_DESTROYED`.
- The promise still settles only on `close` (or the existing `error`/timeout paths), so the exit
  code, stdout, stderr, `timedOut` and `durationMs` of `ExecResult` are unchanged and the stdin
  failure adds nothing to stderr.
- A regression test in `packages/core/test/exec.test.ts` runs a child that closes stdin and
  writes a 4 MiB payload (above the pipe buffer, so the race is deterministic), asserting the
  exit code and empty stderr without an uncaught throw.
- A control test proves stdin still arrives: `exec(["sh", "-c", "cat"], { input: "hello" })`
  returns `hello`.
- An end-to-end case in `packages/cli/test/doctor.test.ts` points the opencode stub at an
  `auth import` that exits non-zero without reading stdin and asserts `doctor --json` produces a
  report whose `import` check is a warning naming "could not import".
- A patch changeset for `@loomwright/cli` records the fix.

## Capabilities

### New Capabilities

- `process-execution`: the contract of the single child-process wrapper `exec`: how it feeds a
  child's stdin, which failures it ignores, and that a child's own exit code, stdout, stderr and
  timeout result are the only outcome it reports.

### Modified Capabilities

None.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** internal only. `exec`, `execOk`, `git` and `gitOk` keep their signatures;
  `ExecOptions` and `ExecResult` are unchanged. No exported type changes.
- **Contracts:** none configured; no API schema, event or Helm value changes.
- **Data:** none. No config schema, workspace format, lockfile or migration change.
- **Callers that write stdin:** `doctor/doctor.ts` (credentials import), `managed/sync.ts`
  (`git hash-object -w --stdin`), `git/pointers.ts` (`git patch-id --stable`), `openspec/cli.ts`
  and the gate/contracts paths. All keep working; a closed-stdin child now reports its own exit
  code instead of aborting the CLI.
- **Protected files:** none edited. `factory.config.jsonc`, `.opencode/`, `factory.lock.json`,
  `factory-records/` and `openspec/specs/` need no edit. The plugin bundle needs no rebuild
  because `packages/core/src/plugin/` and `packages/core/src/policy/` are untouched.
- **Out of scope:** exit codes and doctor output text stay as they are; no retry of a failed
  `opencode auth import`; no general stdout-EPIPE story for piped usage.
