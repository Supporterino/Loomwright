# fix-exec-stdin-epipe: done

`loomwright doctor` crashes with an unhandled `write EPIPE` when a child process closes its stdin before the wrapper finishes writing. The requester wants `exec` to treat a failed write to a child's stdin as "the child stopped listening" rather than a fatal CLI error, keeping exit code, stdout, stderr and timeout semantics unchanged, with a regression test, a stdin control test, optional doctor end-to-end coverage, and a patch changeset for `@loomwright/cli`.

## Branches (local only; nothing was pushed)

- loomwright: `change/fix-exec-stdin-epipe` at 7d12d2d7bf70 (5 commits)
- AI repo: `change/fix-exec-stdin-epipe` (archive commit 7d12d2d7bf70)

## Tasks

- [x] 1.1 (loomwright, task): Guard `child.stdin` in `exec` and cover the guard with unit tests
- [x] 1.2 (loomwright, task): Add the doctor end-to-end case for an import that exits before reading stdin
- [x] 1.3 (loomwright, task): Add the patch changeset for `@loomwright/cli`
- [x] 1.4 (loomwright, task): Run the full gate and check `loomwright doctor` by hand
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test

## Spec

Archived as `openspec/changes/archive/2026-11-25-fix-exec-stdin-epipe`.

## Review findings

- review:loomwright: [nice] packages/core/src/exec.ts:103 The known limit—a child that silently drops its input and still exits 0 is reported as success—is documented only in design.md; the code has no `shortcut:` marker.
- review:loomwright: [nice] packages/cli/test/doctor.test.ts:137 Two copies of the `AI_FACTORY_OPENCODE_BIN` override/restore logic can drift, and the new helper adds about 12 lines for the same job.

## Risks and things not checked

- intake: The request text is untrusted issue content; it was used as scope information only, including the proposed patch shape, and no instructions in it were executed.
- intake: Escalation notes in the request (e.g. avoid a global uncaughtException handler, do not shrink the test payload, keep finish() semantics) are recorded as scope constraints, not verified against the code.
- design: Shell was denied, so `openspec validate --strict`, the tasks-metadata parser and the gate were not run against the new files.
- design: No graph query was possible; symbol locations and line numbers come from the explorer summary and files I read directly (exec.ts:99, doctor.ts:716/731, sync.ts:203, pointers.ts:85).
- design: Ignoring every stdin error could hide a child that ignores its input and exits 0; accepted because the previous behaviour aborted the process, and the main consumers fail loudly.
- design: The doctor e2e fixture must produce a scoped StoredCredential via `auth export`; a malformed stub would silently test the no-credentials branch instead.
- design: The 4 MiB scenarios allocate a few MB per run and the timeout scenario relies on a 0.2 s/lower-bound timing assertion; both are kept deliberate but may be the slowest part of exec's suite.
- context-packs: Shell and graphify were unavailable in this session (permission denied), so the packs were built by reading files directly rather than querying the workspace graph; symbols and line ranges were verified in the sources I read.
- context-packs: 1.4's manual run in this repo's own tree can show unrelated warn/fail checks (stale graph, environment); the pack says to prove the exit-code rule through the 1.2 test instead of changing unrelated checks.
- context-packs: The doctor E2E assertion assumes a fresh single-repo fixture has no failing check apart from the stubbed opencode path; existing tests that expect ExitCode.Precondition only when the floor is unmet support that, but it was not executed.
- 1.1: Ran gates: `bun test packages/core/test/exec.test.ts` (7 pass), `bun run typecheck`, `bun run lint`, `bun run format:check` clean, and full `bun run test` (1726 pass, 11 skip, 0 fail).
- 1.1: Repo convention wants a changeset for changes under packages/; I did not add one because the task scope is limited to exec.ts and test files — a human or a later task must add it.
- 1.1: Timing assertion (`>=190ms`) could be sensitive on a heavily loaded machine; the full suite passed, but the 60s per-test timeout does not cover slow-clock rounding under extreme load.
- 1.3: Did not run format:check/lint/typecheck/test: biome excludes .changeset via "!.changeset" and the pack states the full gate runs in task 1.4, so this file cannot affect them.
- 1.3: bunx changeset status resolved (not blocked) and reports @loomwright/cli patch as expected.
- 1.2: Verified by temporarily removing child.stdin.on('error', ...) from packages/core/src/exec.ts: the doctor test still passed, because Bun 1.4.5 on macOS swallows the unhandled stdin EPIPE for this stub/payload. The guard itself is proven deterministically by packages/core/test/exec.test.ts (stubs close fd 0 explicitly); this e2e test proves the user-visible report/exit-code outcome.
- 1.2: The temporary exec.ts edit was restored from a backup; git diff shows only the test file changed.
- 1.2: Ran the file's suite, typecheck, lint and format:check; did not run the full bun run test suite locally.
- 1.4: Did not reproduce the fail-before EPIPE stack trace on the base commit: that needs main's pre-fix exec.ts and the worktree branch must not change. The regression proof relies on the 1.2 test 'reports an import that exits before reading stdin as a warning' (packages/cli/test/doctor.test.ts, 19/19 pass), which covers the guard.
- 1.4: The shim's `auth import` wrote nothing to stderr, so the warn detail ends with a trailing ': ' — cosmetic only.
- review:loomwright: Could not run the new tests, typecheck or lint; runtime behavior on Bun and Node is unverified.
- review:loomwright: The design says behavior is verified on Node, but the repo test script is Bun-only and the CI Node job only smoke-tests the built CLI; the Node stdin-error path has no automated test.
- review:loomwright: The doctor end-to-end test uses a small credential payload, so it does not necessarily reproduce EPIPE itself; the exec unit tests are the regression guard, as the design states.
- test-loomwright: I did not modify tests because none were missing; the tests were authored in the implementation commits 08b29e1 and 21b4f8c.
- test-loomwright: The graphify CLI is broken in this environment (ModuleNotFoundError: anyio), so code location was done with grep instead of the workspace graph.

## Usage

Total: 7.60M tokens (6.65M cache read, 51.1k out) · cost n/a over 10 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| implementer-loomwright | 3.03M | 40% | cost n/a |
| architect | 2.14M | 28% | cost n/a |
| reviewer | 1.67M | 22% | cost n/a |
| explorer | 442.3k | 6% | cost n/a |
| tester | 297.7k | 4% | cost n/a |
| orchestrator | 11.5k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 1.67M | 22% | cost n/a |
| 1.2 | 1.56M | 20% | cost n/a |
| context-packs | 1.34M | 18% | cost n/a |
| 1.4 | 1.11M | 15% | cost n/a |
| design | 797.0k | 10% | cost n/a |
| explore:loomwright | 442.3k | 6% | cost n/a |
| test-loomwright | 297.7k | 4% | cost n/a |
| 1.1 | 285.3k | 4% | cost n/a |
| 1.3 | 77.0k | 1% | cost n/a |
| intake | 11.5k | 0% | cost n/a |

Top consumers: review:loomwright (1.67M), 1.2 (1.56M), context-packs (1.34M), 1.4 (1.11M), design (797.0k).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 12.
