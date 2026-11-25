# Design: `exec` ignores a child's stdin write failure instead of crashing the CLI

## Context

`packages/core/src/exec.ts::exec` spawns every child with `stdio: ["pipe", "pipe", "pipe"]` and
then writes the optional input with `child.stdin.end(options.input ?? "")` (line 99). It listens
for `child.on("error")` (spawn failures such as `ENOENT`, mapped to code 127) and
`child.on("close")` (the real exit code), but not for `child.stdin.on("error")`.

`child.stdin` is a `Socket`. When the child exits or closes fd 0 before the wrapper finishes
writing, the write fails and the socket emits `error` with `EPIPE` (Bun and Node) or
`ERR_STREAM_DESTROYED` for a destroyed stream. An `error` event with no listener on an
`EventEmitter` is thrown; nothing in `runCli` catches it, so the process aborts with exit code 1
even when the child exited 0. The race becomes deterministic when the payload exceeds the pipe
buffer, because the write then blocks until the read end closes.

The user-visible symptom is `loomwright doctor`: `checkModels`
(`packages/core/src/doctor/doctor.ts:716`) writes the stored credential JSON into
`opencode auth import --standalone`. If that invocation exits early, the report never prints and
the existing `import` warning is never shown. `managed/sync.ts:203` (`git hash-object -w
--stdin`) and `git/pointers.ts:85` (`git patch-id --stable`) use the same path during
install/update and land.

`exec` never rejects for a child's own failure: non-zero exits are ordinary results, and
`execOk`/`gitOk` turn them into `ExecError`, which `main.ts::report` maps to an exit code. That
contract is what the fix must preserve.

## Decisions

### 1. Attach a no-op `error` listener to `child.stdin` before `end()`

The failure is delivered as an asynchronous event, so a `try`/`catch` around `end()` would not
see it. Attaching `child.stdin.on("error", () => {})` first converts the event into an ignored
one; the write and `end()` proceed normally and the promise still settles from `close`, the
existing `error` handler or the timeout.

Rejected: resolving the promise from the stdin error. `close` carries the real exit code; an
early settle from the stdin error would make a child that later fails look successful and would
change `ExecResult`.

Rejected: a global `process.on("uncaughtException")` or a `process.stdout` `error` handler. That
hides real defects and does not fix the emitter; piped stdout (`loomwright … | head`) is a
separate question and stays out of scope.

### 2. Ignore every stdin error, not only `EPIPE`

The same "child stopped listening" case surfaces as `EPIPE` under Bun and Node and as
`ERR_STREAM_DESTROYED` for a destroyed stream. There is no stdin error worth propagating: the
child's exit code and stderr already describe the failure, and `exec`'s contract is to report
the child, not its input stream. A narrow `code === "EPIPE"` check would leave the crash reachable
on a second code path.

Rejected: appending the ignored error to `stderr`. It would change `ExecResult.stderr` for a
case where the command's own diagnostics are the signal, and it would break tests that assert
empty stderr on a successful child.

### 3. Keep the regression test at 4 MiB and add a stdin control

The payload must exceed the pipe buffer for the write to block until the read end closes; at 1
MiB the failure reproduces on Bun but not always on Node, and a few bytes never reproduce it.
The test uses the deterministic form

```ts
exec(["sh", "-c", "exec 0<&-; sleep 0.05"], { input: "x".repeat(4 * 1024 * 1024), timeoutMs: 5_000 })
```

and asserts `code` 0 and `stderr` `""`. `exec(["sh", "-c", "cat"], { input: "hello" })` returning
`hello` proves the guard did not break normal stdin delivery; a second case without `input`
proves the empty write still closes stdin.

### 4. The doctor end-to-end case is secondary coverage

`packages/cli/test/doctor.test.ts` already swaps `AI_FACTORY_OPENCODE_BIN` for a stub and reads
`DoctorReport` through `cli(root, "doctor", "--json")`. A stub whose `auth export` returns one
`anthropic` credential and whose `auth import` exits 2 without reading stdin exercises the real
`checkModels` path and asserts the warning. The credential JSON is small, so this case does not
reliably produce `EPIPE` on its own; the unit test is the regression guard and the end-to-end
case proves the user-visible outcome.

### 5. Patch changeset for `@loomwright/cli`; no documentation edit

`packages/core` is private at `0.0.0`, so only `@loomwright/cli` (1.3.0) is released; the
changeset is a patch. No doc describes `exec`'s stdin internals: `ARCHITECTURE.md` only says
child processes go through `exec.ts`, `docs/plan.md` lists it as the shell-out wrapper, and the
`doctor` section of `docs/cli.md` describes checks, not stream handling. The behaviour a user
observes (a report instead of a crash) is already documented. Adding a note would describe an
implementation detail, so this change leaves the docs alone; if a reviewer wants it, the row in
`docs/plan.md` is the place.

## Contract changes

None configured. `ExecOptions` and `ExecResult` keep their fields and meaning; `exec`, `execOk`,
`git` and `gitOk` keep their signatures. `DoctorReport`, check names, statuses, exit codes and
doctor text are unchanged. No API schema, event or Helm value changes.

## Risks

- Ignoring every stdin error could hide a child that silently ignored its input and still exited
  0. In practice the consumers (`git hash-object`, `git patch-id`, `opencode auth import`) either
  consume stdin or fail, and the previous behaviour was a process abort, which is strictly worse.
- The 4 MiB regression test allocates a few megabytes per run and depends on the OS pipe buffer;
  that is the price of a deterministic reproduction. `timeoutMs: 5_000` keeps a hang from
  stalling the suite.
- Behaviour is verified on Bun (the factory's runtime) and Node (the published bundle). A
  runtime that reports a different stdin error code is still covered because every error is
  ignored.
- The doctor end-to-end case depends on `readStoredCredentials` returning a scoped credential, so
  the stub must answer `auth export` with a valid `StoredCredential` shape; a bad fixture would
  make the test assert the "no stored credentials" branch instead.
- `packages/core/src/plugin/` and `packages/core/src/policy/` are untouched, so the plugin
  bundle needs no rebuild.
