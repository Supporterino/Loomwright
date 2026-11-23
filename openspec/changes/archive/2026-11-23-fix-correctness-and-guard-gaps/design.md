# Design — fix-correctness-and-guard-gaps

## Context

The 2026-10-26 audit, the nine reports under `factory-records/reports/` and ADR-0041 record
gaps that outlived the changes that found them. Most "blocked by the guard" bullets are stale
after ADR-0044: `bun test`, `bun run test`, `bun run check` and `bun run build` are covered by
the builtin/cycle fix, and `bun --cwd . run <script>` is covered by the 6-1 review fix
(`packages/core/test/shell-policy.test.ts:335-343` asserts the `git push` block). This design
re-verifies each candidate against the current tree, then fixes only what is still open and
within the eight-task cap.

This session's shell tool is permission-denied, so graphify and the gates could not be run.
Candidate verdicts below come from reading the cited code and tests; the implementation must
re-run the gates, and the final report must say whether `bun test` is still blocked from the
repo root.

## Findings

Severity is `must`, `should` or `nice`. Only `must` and `should` become tasks; `nice` and every
item beyond the cap are reported.

| ID  | File:line                                                                  | Probe / reproduction                                                                                                  | Sev    | Fix                                                                                                          | Test                                                                 | Decision |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| F1  | `policy/sandbox.ts:18`, `gates/run.ts:120`, `plugin/entry.ts:315`, `runtime/opencode.ts:87` | ADR-0041:13 says a wrapped command is marked and `sandboxEnabled` returns false; nothing sets or reads such a marker. | must   | One `AI_FACTORY_SANDBOX` variable with `off`/`seatbelt`/`wrapped`; gate runner and plugin mark what they wrap. | `sandbox.test.ts` marker cases; a wrapped gate/plugin hook leaves the command unwrapped. | Fix as 1.1. |
| F2  | `scripts/build-plugin.ts:14-20`; report `fix-guard-and-e2e-followups.md:78` | `Bun.build` labels follow `process.cwd()`; the bundle equality test passes only from the repo root.                   | must   | Pin the build root to the repo root, normalise any remaining absolute banner, regenerate.                     | Build from a subdirectory equals the committed file.                 | Fix as 1.2. |
| F3  | `policy/shell.ts:400`, `1466`, `1664-1669`                                   | `npx`/`pnpx` are in neither `PACKAGE_MANAGERS` nor `INTERPRETERS`, so `npx sh -c …` and `npx npm publish` pass.       | must   | Add both aliases and route their wrapped command through the `bunx` checks; ADR-0049 records route-not-block. | `shell-policy.test.ts`/`hardening.test.ts` probes; `npx vitest run` stays allowed. | Fix as 1.3. |
| F4  | `packages/cli/src/main.ts:147`                                               | Any `-h`/`--help` in the tail prints help, so `reword <id> --prompt -h` and `run --request -h` are unreachable.       | should | Help only when it is the first token after the command; inject the command list for tests.                    | Help as first token, as value, after `--`, and `--help` positional.  | Fix as 1.4. |
| F5  | `tui/src/entry.tsx:1208-1210`, `model/poll.ts:21`, `core/src/factory.ts:249-250` | The one-second poll calls `status()` without an id; every run's ledger and workspace usage are scanned for a one-run view. | should | Poll `status(<selected id>)` on the run view, merge the run, full status only on the list/initial load.      | A read-based fake: an open run reads only its own ledger.             | Fix as 1.5. |
| F6  | `tui/src/entry.tsx` (2,005 lines, 934-1774)                                  | Status wiring and control orchestration live in the entry; tests import them from there and no Ink harness exists.      | should | Move status and controls to `model/`, move `UiData` too, keep re-exports; entry ≤1,600 lines.                 | Direct controller tests; entry-size and no-definition assertions.     | Fix as 1.5. |
| F7  | `.github/workflows/ci.yml:70-82`, `release.yml:112-122`, ADR-0047:45       | CI checks `tui.js`, release does not; the ADR claims "about 1 MB" while the built bundle measured 2,294,754 bytes.     | should | One `scripts/check-tarball.ts` used by both; ADR states measured bytes and the command.                       | Shared-list unit tests; both workflows call it; ADR assertion.        | Fix as 1.6. |
| F8  | `packages/cli/test/state-commands.test.ts:136-148`                           | An 80 ms wall clock races a frame count; failed under `--parallel` in several reports.                                | should | Wait for two observed frames, then abort; no fixed window.                                                    | Repeated parallel runs recorded in the report.                        | Fix as 1.7. |
| F9  | 93 `catch {` matches under `packages/` (tests included); `doctor.ts:383-393`, `usage.ts:40` | No rule distinguishes a documented fallback from a swallowed failure; doctor's unreadable `package.json` is silent.   | should | Comment-as-reason convention; surface the doctor parse failure; TS-parser rule test over `src`/`scripts`.      | Rule scan (and a failing fixture); doctor warns on bad JSON.          | Fix as 1.8. |
| F10 | `policy/shell.ts:430-452`, `559-607`; `shell-policy.test.ts:335-343`         | `bun --cwd . run deploy` was reported unexpanded.                                                                     | should | None — already fixed by the 6-1 review fix.                                                                   | Existing test asserts the `deploy` body's `git push` block.           | Close as stale. |
| F11 | `docs/audit/2026-10-26.md:22-23,48`; ADR-0026                               | S11/S14 residuals are heuristic off macOS and were never written into the ADR.                                        | should | Add the residual sentence to ADR-0026.                                                                        | ADR assertion in 1.1's spec.                                          | Fold into 1.1 (no code). |
| F12 | `docs/audit/2026-10-26.md:44`                                                | `bench ponytail` has never run on real models and needs a human cost OK.                                              | nice   | None; keep as a recorded follow-up.                                                                           | None.                                                                 | Report only. |
| F13 | `docs/audit/2026-10-26.md:45`                                                | Reviews after merges and tester after reviewer are cited as open.                                                     | nice   | None; intentional per ADR-0019.                                                                               | None.                                                                 | Close as intentional. |
| F14 | `docs/audit/2026-10-26.md:46`                                                | `maxAgents` is per process.                                                                                           | nice   | None; confirm and record as a known limit.                                                                    | None.                                                                 | Report only. |
| F15 | report `implement-factory-tui.md:133`                                        | Replay is tested only against the approval fixture; questions/help screens are untested.                              | nice   | None in this pass; report as a follow-up.                                                                     | None.                                                                 | Report only. |
| F16 | `packages/cli/src/commands/tui.ts:55-67`                                     | `--replay` with an unreadable file was said to exit 1.                                                                | nice   | None — already maps to `UsageError` (exit 2).                                                                 | Existing TUI command suite.                                           | Close as already fixed. |
| F17 | `tui/src/entry.tsx:968-978`                                                  | `eventsRef` was said to grow unbounded.                                                                               | nice   | None — `flushFrame` drains it every frame.                                                                    | Existing fold/performance suites.                                     | Close as already fixed. |
| F18 | `policy/shell.ts:466-470`                                                    | `bunx` was said to bypass the wrapped checks.                                                                         | nice   | None — it recurses as `bun x`.                                                                                | Existing hardening probes.                                            | Close as already fixed. |
| F19 | `doctor/doctor.ts:409-410`                                                   | Doctor was said to warn about overridden gate scripts.                                                                | nice   | None — overridden pairs are skipped.                                                                          | Existing doctor suite.                                                | Close as already fixed. |
| F20 | repo root                                                                   | The reports say `bun test` is blocked from the root.                                                                  | nice   | None — code and tests carry the ADR-0044 fix; not run in this shell-denied session.                           | Re-run at implementation; report if still blocked.                    | Verify at implementation. |

## Decisions

**D1 — One sandbox variable, three states.** `AI_FACTORY_SANDBOX` is already the runtime/plugin
signal (`off`, `seatbelt`). Add `wrapped` as the marker rather than a second
`AI_FACTORY_SANDBOXED` variable. `sandboxEnabled` takes an optional environment argument
(default `process.env`) so tests need no global mutation. The gate runner adds
`AI_FACTORY_SANDBOX=wrapped` to the child env; the plugin prefixes the wrapped shell with
`export AI_FACTORY_SANDBOX=wrapped;` because opencode may omit the shell event's env. `doctor`
reports the workspace setting by calling `sandboxEnabled` with an empty environment, so a
doctor run inside a wrapped gate still says the workspace is configured for the sandbox.
*Rejected:* a separate marker variable (ADR-0041 says reconcile, not duplicate); detecting the
parent process (not portable, no shell access).

**D2 — Pin the Bun build root.** Pass the repository root to `Bun.build` and strip any
remaining absolute working-directory prefix from the generated banner. *Rejected:* normalising
only the banners (leaves the build input cwd-dependent); checking in a cwd-stamped bundle
(keeps the equality test cwd-sensitive).

**D3 — A status source, not a changed `Factory`.** The TUI gets `model/status.ts` with an
injected `Factory`, selected-run getter and update callback. An open run polls
`status(<id>)`; the result is merged into the last full document so the run list and approval
sync keep working, and a missing run falls back to a full status (landing removes the run).
The TUI does not paint `workspaceUsage` anywhere (a grep of `packages/tui/src` finds no reader),
so the open-run poll omits it; the initial load and a list refresh still take the full document
because `Factory.status()` always computes that slice and every run's usage together.
*Rejected:* making `Factory.status()` lazy (changes the `status --json` shape); polling
`status()` and discarding fields (still reads every ledger); caching only usage (does not
remove the per-run scan).

**D4 — Extract the control orchestration, not the views.** `model/controls.ts` takes
`performControl`, the guards, `startResume`/`startLand`/`startReword` and the state
transitions; `model/ui-data.ts` takes `UiData` and its pure helpers. `entry.tsx` re-exports
them so existing tests keep their imports. *Rejected:* splitting `policy/shell.ts` (out of
scope, security-critical); rewriting the Ink views (no behaviour gain, high risk).

**D5 — Route `npx`/`pnpx`, do not block them.** They are common dev runners (`npx vitest run`
is already an allowed everyday command). Add them to `PACKAGE_MANAGERS`, skip their value
flags, and inspect the wrapped words with `checkSimple`; `-c`/`--call` text goes through
`checkScript`. *Rejected:* blocking the aliases outright (breaks ordinary use); treating them
as `bun x` (their flag sets differ and a value would be read as the command).

**D6 — Help only in one position.** `rest[0]` is the only help position after the command.
`runCli` takes an optional command list (default `COMMANDS`) so tests can record argv without a
real workspace. *Rejected:* scanning for `--` and help together (more rules, still ambiguous
for flag values); letting every command parser implement help (duplicated help text and exit
codes).

**D7 — One tarball script.** `scripts/check-tarball.ts` owns the required entries and forbidden
prefixes; both workflows write `tar -tzf` to a file and call it. *Rejected:* a composite action
(more CI plumbing for two call sites); keeping two inline lists (the drift this fixes).

**D8 — Comment-as-reason, TypeScript parser in the test.** A silent catch opens with a comment
naming the fallback. The test uses the existing `typescript` dev dependency to find
`CatchClause` nodes, so nested braces and comments are parsed rather than regex-matched.
*Rejected:* a helper wrapper at every site (churns 90 files and adds an abstraction);
a regex scanner (unreliable around nested blocks).

## Contract changes

None. No protocol event, command name, flag set, exit code or `status --json` shape changes.
The only CLI interpretation change is the position in which `-h`/`--help` means help.

## Manual post-landing steps (protected files)

1. After landing, run `loomwright update` in this workspace so `.opencode/plugins/factory.js`
   and `factory.lock.json` carry the regenerated bundle.
2. Edit `factory.config.jsonc` to `security.sandbox: "auto"` and run `loomwright doctor` to
   confirm the Seatbelt profile is active. This is the protected-file flip ADR-0041 now names.
3. Re-run `bun test` from the repository root once the updated bundle is installed and record
   whether the old guard false positive is gone (F20).

## Deferred / reported, not fixed

- Splitting `packages/core/src/policy/shell.ts` (1,807 lines) — a separate change.
- A real JS/TS parser for the guard's script scan — separate change.
- `bench ponytail` against real models — needs an explicit cost OK (G1).
- TUI replay goldens for the questions and help screens — reported (F15).
- Any further `nice` finding beyond the eight-task cap — reported in the final report.
- `npx`/`pnpx` flag handling beyond the listed value flags — named in ADR-0049 as the upgrade
  trigger.

## Risks

- The shell tool was denied in this design session: no graphify, `bun test`, `bun run check`,
  `bun run build` or `bun run build:plugin`. Every verdict is from reading the cited code,
  tests and reports. The implementation must re-run all gates.
- The sandbox guard is proven by unit tests until the bundle is regenerated and the workspace
  is flipped; dogfooding cannot happen on the change branch.
- Four tasks write `templates/plugin/factory-plugin.txt`; they are serialised on that glob and
  on `packages/core/src/policy/shell.ts`. A stale bundle fails `test/plugin.test.ts`.
- The silent-catch task edits many source files after the policy/TUI tasks; comments must not
  change behaviour, and the diff will be noisy.
- ADR edits must not introduce the capitalised product name; `test/docs.test.ts` enforces it.
- ADR-0047's byte count depends on the current build. Record the measured value and command;
  do not copy the report's number without re-measuring.
- The TUI merge of a selected-run status must preserve the run list and the landing/refresh
  path; a run that vanished during land must fall back to a full status.
