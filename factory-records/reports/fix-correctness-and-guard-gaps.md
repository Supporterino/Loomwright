# fix-correctness-and-guard-gaps: done

One bounded correctness-and-structure pass over the whole monorepo that re-verifies and then closes the flaws already recorded but never fixed: restore the sandbox nesting guard, make the committed plugin bundle cwd-independent, stop the TUI's one-second poll from reading every run's usage, extract testable poll/launcher seams out of the oversized TUI entry, unify the tarball artifact check across ci.yml and release.yml, close the npx/pnpx package-runner gap and the unexpanded `bun --cwd . run` form, fix the -h/--help value collision, de-flake `status --watch`, establish a silent-catch convention, and triage the reports and audit follow-ups (S11/S14, G1, G9, P20, TUI replay, already-fixed items) so nothing is silently dropped. Findings come first in design.md, at most 8 fix tasks ship, shell.ts work runs serially, no new deps, no network or real models, and every behaviour fix has a failing-then-passing test plus the relevant ADR/changeset updates.

## Branches (local only; nothing was pushed)

- loomwright: `change/fix-correctness-and-guard-gaps` at c85479203e42 (34 commits)
- AI repo: `change/fix-correctness-and-guard-gaps` (archive commit c85479203e42)

## Tasks

- [x] 1.1 (loomwright, task): Add the sandbox nesting marker and record the superseded workspace exception
- [x] 1.2 (loomwright, task): Pin the plugin build root and regenerate the committed bundle
- [x] 1.3 (loomwright, task): Inspect `npx` and `pnpx` as package runners and record the decision
- [x] 1.4 (loomwright, task): Honour help only as the first token after the command
- [x] 1.5 (loomwright, task): Extract the TUI status/control seams and poll the selected run only
- [x] 1.6 (loomwright, task): Share the tarball artifact check and record the measured TUI size
- [x] 1.7 (loomwright, task): Make the `status --watch` test wait for frames instead of a clock
- [x] 1.8 (loomwright, task): State a reason at every silent catch and surface doctor's unreadable `package.json`
- [x] fix-loomwright-1-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:494): `printf 'git push' | npx -c 'bash'` and `npx -c 'bash' < script.sh` are allowed: the wrapped bare shell reads the alias'
- [x] fix-loomwright-1-2 (loomwright, review-fix): Fix review finding (test/docs.test.ts:413): No test asserts ADR-0026's off-macOS residual (heuristic globs/other languages, parser and edit-scope backstop), ADR-004
- [x] fix-loomwright-1-3 (loomwright, review-fix): Fix review finding (packages/cli/test/cli-usage.test.ts:80): The scenario also requires the request to be read from that file; the test would still pass if `run`'s parser rejected `
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test
- [x] fix-loomwright-2-1 (loomwright, review-fix): Fix review finding (.github/workflows/release.yml:93): The new test/docs.test.ts `changeBase()` runs `git log --diff-filter=A -- openspec/changes/fix-correctness-and-guard-gap
- [x] fix-loomwright-2-2 (loomwright, review-fix): Fix review finding (packages/cli/test/gates-run.test.ts:196): When the suite itself runs inside a wrapped gate (exactly what the manual `security.sandbox: "auto"` flip named in ADR-0
- [x] fix-loomwright-3-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1864): The call text runs in a subprocess, but a `cd` inside it moves the guard's cwd for the rest of the outer line: `npx -c '
- [x] fix-loomwright-3-2 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:500): `npx -c='git push'` arrives as `-c=git push`, is skipped, leaves no wrapped command, and is allowed; npx expands `-c=...
- [x] fix-loomwright-4-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:403): Every other npm config flag that takes a value is treated as boolean, so its value becomes the wrapped command and the r
- [x] fix-loomwright-4-2 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1862): The call text runs in a subprocess, but `npx -c 'alias git=echo' ; git push` leaks the alias to the outer script and is 
- [x] fix-loomwright-5-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1470): A `cd` inside those texts moves the guard's cwd for the rest of the outer line, although watch/flock/make/npm run it in 
- [x] fix-loomwright-6-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1965): A subshell's own input never reaches the inner shell, so `printf 'git push' | (bash)` and `npx -c '(bash) < scripts/rele
- [x] fix-loomwright-6-2 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:620): `npx -p= npm publish` (and `-w=`, `-C=`...) skips `npm` as the flag's value and checks only `publish`, while `npx --pack
- [x] fix-loomwright-6-3 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:648): `npm exec -- git push` and `npm x -c 'git push'` have no publish/global word, so they are allowed and the wrapped comman
- [x] fix-loomwright-7-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1613): `npx npm@latest publish`, `npx npm@10 install -g left-pad` and `npx -c 'npm@latest publish'` pass: the base is `npm@late
- [x] fix-loomwright-7-2 (loomwright, review-fix): Fix review finding (packages/tui/src/entry.tsx:759): `n` opens the intake over a run screen; submitting sets `spawnBaseline` and kicks the poll, but the poll never calls `re
- [x] fix-loomwright-7-3 (loomwright, review-fix): Fix review finding (packages/core/test/shell-policy.test.ts:474): These flags are security-critical: if one is missing or misspelled, its value becomes the wrapped command and the real c
- [x] fix-loomwright-7-4 (loomwright, review-fix): Fix review finding (test/docs.test.ts:475): After landing, the test still uses the old base. Any later change that edits an existing ADR appears in `git diff base` 
- [x] fix-loomwright-8-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:1706): npx npm@latest run deploy reaches checkPackageManager('npm') but not checkPackageScript, so the deploy body's `git push`
- [x] fix-loomwright-8-2 (loomwright, review-fix): Fix review finding (packages/core/test/shell-policy.test.ts:370): The repo standard requires a test whose name mentions each scenario; the same gap exists for 'doctor reports an unreadab
- [x] fix-loomwright-9-1 (loomwright, review-fix): Fix review finding (packages/cli/test/watch-parallel.test.ts:19): The `-t` filter skips watch tests whose names lack that string, including the two this change fixed for determinism: 'th
- [x] fix-loomwright-10-1 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:407): The hand list does not match npm. Value-taking configs and aliases are missing (`--expires`, `--min-release-age`, `--pas
- [x] fix-loomwright-10-2 (loomwright, review-fix): Fix review finding (packages/core/src/policy/shell.ts:686): npm reads `--call`/`-c` from the whole argv, but the pre-subcommand tokens are dropped unseen: `npm --call='git push' ex

## Spec

Archived as `openspec/changes/archive/2026-11-23-fix-correctness-and-guard-gaps`.

## Review findings

- review:loomwright: [must] packages/core/src/policy/shell.ts:407 The hand list does not match npm. Value-taking configs and aliases are missing (`--expires`, `--min-release-age`, `--password`, `--name`, `--allow-git`, `--scopes`, `--orgs`, `--packages`, `--token-description`, aliases `--enjoy-by`=`--before` and `--reg`=`--registry`), and `-p` is value-taking only for npx, while npm exec's `-p` is the boolean `--parseable`. So `npx --enjoy-by 2020-01-01 npm publish`, `npx --reg http://evil npm publish` and `npm exec -p npm publish` are allowed while npm runs npm publish (blocked when direct). The test named 'every npm config flag with a value is skipped' only covers a subset.
- review:loomwright: [must] packages/core/src/policy/shell.ts:686 npm reads `--call`/`-c` from the whole argv, but the pre-subcommand tokens are dropped unseen: `npm --call='git push' exec`, `npm --call 'git push' exec` and `npm -c 'git push' exec` are allowed while npm runs the call text via its shell. npmSubcommand also lacks `c` in its value-taking letters, so `npm -c 'x' exec` misreads `exec`.
- review:loomwright: [nice] openspec/changes/fix-correctness-and-guard-gaps/design.md:98 packages/core/test/silent-catch.test.ts uses a hand-written tokenizer/regex scanner, not the TypeScript parser; the design records an approach that was not taken.
- review:loomwright: [nice] packages/cli/test/state-commands.test.ts:418 The scenario has coverage but no test whose name mentions it, so the traceability rule the same change enforces for its other scenarios is not met.

## Risks and things not checked

- intake: Request names more findings than the 8-fix-task cap allows; the architect must triage must/should into tasks and record the rest as report follow-ups.
- intake: Two decisions are delegated to design rather than a human: the npx/pnpx route-vs-block choice and whether `bun --cwd . run` is fixed or closed with a `shortcut:` comment. Both are answerable inside the change, so no question was raised.
- intake: Protected files (.opencode/, factory.config.jsonc, factory.lock.json, AGENTS.md, openspec/specs/, package.json gate scripts) mean the `security.sandbox: "auto"` flip is a manual post-landing step and must be named in the final report.
- design: The shell tool was permission-denied in this design session: graphify, bun test, bun run check, bun run build and bun run build:plugin were not run. All verdicts come from reading the cited code, tests and reports; implementation must re-run every gate.
- design: Whether bun test is still blocked from the repository root could not be observed live (F20); the code and tests carry the ADR-0044 fix, and the final report must record the result.
- design: The sandbox flip to auto is a protected-file manual step after landing; until then the nesting guard is proven by unit tests only.
- design: Four tasks write templates/plugin/factory-plugin.txt (1.1, 1.2, 1.3, 1.8); they are serialised on that glob and on shell.ts. A stale bundle fails test/plugin.test.ts.
- design: ADR-0047's size must be re-measured after bun run build; the report's 2,294,754 bytes is evidence, not a value to copy blind.
- design: The silent-catch task edits many core, cli, tui and scripts files after the other tasks; the diff is noisy and must remain comment-only where no failure is hidden.
- design: The TUI selected-run merge must preserve the run list and the land/refresh path; a run removed during land must fall back to a full status.
- design: A report line is phrased as an instruction ('make sure --replay stays read-only'); it was treated as evidence and no action was taken on it.
- context-packs: The shell tool is permission-denied in this session, so graphify, bun test, bun run check/typecheck and bun run build could not run. Every symbol and line hint comes from reading the tree; line numbers are hints only and the implementer must re-run all gates.
- context-packs: 1.6 cannot state the ADR-0047 byte count here: the implementer must run bun run build and measure packages/cli/dist/tui.js, and must not copy a number from a report or from the pack.
- context-packs: 1.8's scan assumes typescript@7.0.2 exposes createSourceFile/forEachChild; the pack names a tokenizer fallback that keeps the scanSilentCatches(file, source) contract if the JS API is unavailable.
- context-packs: 1.1 changes the plugin's generated shell line, so test/plugin.test.ts's toStartWith('exec /usr/bin/sandbox-exec') assertion must change with it; the pack says so, but the two edits must land together or the suite fails.
- context-packs: 1.5 is the highest-risk task: a naive status document merge silently truncates the run list.
- context-packs: 1.1, 1.2, 1.3 and 1.8 all rewrite templates/plugin/factory-plugin.txt and 1.1, 1.3, 1.6 all touch test/docs.test.ts; the scheduler serialises them on those globs, but a rebase before each build keeps the bundle diff readable.
- 1.4: No real-command test for a file literally named -h; the recorder test pins the argv contract, but the run command's --request file read is not exercised end to end.
- 1.4: Full gate (bun run check) passed: 1672 pass, 5 skip, 0 fail.
- 1.7: Watch tests no longer carry an abort safety net; a regression hangs until the bun test timeout (30 s) instead of failing via AbortSignal.timeout.
- 1.7: Test names were kept as specified by the task; the spec scenario wording is not reflected verbatim in test names.
- 1.1: The macOS Seatbelt integration suite was skipped in this workspace because the ambient `AI_FACTORY_SANDBOX=off` makes `onMac` false; overriding the variable is blocked by the factory guard, so that suite was only verified by unchanged profile code plus the full green `bun run check` (CI runs it with no marker).
- 1.1: The new sandbox test named for the wrapped-suite scenario asserts the skip condition (a wrapped environment disables `sandboxEnabled`) rather than spawning the integration suite under a real outer profile; the actual nesting proof needs CI or a manual run outside the factory shell.
- 1.5: While a run view is open, the plain UiData.runs list is not refreshed each second; status.runs stays authoritative and the next list-screen poll refreshes fully, matching the spec's bounded-poll allowance.
- 1.5: No build:plugin was run because packages/core/src/plugin and policy were untouched.
- 1.6: The workflows were not executed locally; coverage is the static assertions plus a manual run of the script against good/bad/stdin listings.
- 1.6: The full `bun run check` ran before the last type-only change (readonly annotations on the two exported lists); format, lint, typecheck and the three affected suites were rerun green afterwards.
- 1.6: build artifacts under packages/cli/dist and generated package copies were produced by the build but are gitignored; nothing was committed.
- 1.2: Label normalisation splits on `\n` and matches only lines shaped like a module path ending in a JS/TS extension; a future Bun banner format change would need this revisited.
- 1.2: Bundle equality is only proven on the current platform/path separators (macOS); no Windows run was performed.
- 1.3: The full `bun run check` ran before the final test-only assertion was added; the affected shell-policy suite passed afterwards.
- 1.3: Runner flags that take a value but are outside NPX_VALUE_FLAGS would be read as the wrapped command; documented as the ADR upgrade trigger.
- 1.8: templates/plugin/factory-plugin.txt did not change after bun run build:plugin because the entry.ts edits are comments only; test/plugin.test.ts is green.
- 1.8: Tokenizer skips template interpolation bodies wholesale, so a future catch inside `${...}` would not be scanned; no such code exists today.
- review:loomwright: Could not run bun test/gates (shell denied for everything except git diff/read), so the committed bundle freshness, ADR-0047's 2,372,222-byte count and test greenness were reviewed statically only.
- review:loomwright: pnpx flag arity was not verified against pnpm's dlx docs; the finding names npx and npm exec where npm's docs are explicit.
- review:loomwright: test/watch-parallel.test.ts spawns the whole state-commands suite three times, adding several minutes to every bun test run (per spec, but costly).
- fix-loomwright-1-1: Regenerated the committed plugin bundle with `bun run build:plugin`; the diff is the bundled guard change.
- fix-loomwright-1-1: Inherited redirects are re-checked in the wrapped command after the alias already checked them; harmless duplication, no behaviour change observed.
- fix-loomwright-1-1: Full test suite and all cheap gates were run locally; CI build/bundle comparison was not run beyond test/plugin.test.ts.
- fix-loomwright-1-2: No changeset added: the change only touches test/, which the repo convention does not require a changeset for.
- fix-loomwright-1-2: Assertions pin exact ADR prose, so future rewordings of those sentences will fail the docs test by design.
- fix-loomwright-1-3: The parser normalization covers long string options; there are currently no short string options registered through parseCommandArgs.
- fix-loomwright-1-3: Arbitrary dash-leading values other than `-h`/`--help` (e.g. a file named `-x`) still require `--request=-x`; this matches the scenario's scope.
- fix-loomwright-1-3: Did not rerun the full suite in serial mode; parallel run passed completely.
- test-loomwright: The 'every other historical file keeps its text' test reads git history (base = parent of the commit that added the change proposal). CI checks out with fetch-depth 0 so it passes there; a shallow local clone would fail to resolve the base.
- test-loomwright: The 'repeated parallel runs' test spawns `bun test` three times (about 4s); it intentionally runs only state-commands.test.ts with -t 'status --watch' so it cannot recurse.
- test-loomwright: The 'regenerated bundle is committed' and 'behaviour is unchanged' scenarios are covered by the existing equality test and the existing suites rather than a new literal `bun run build:plugin` + `git diff` test; the in-memory bundle equality proves the same property.
- test-loomwright: Full `bun run test`, lint, typecheck and format:check were run and green; the macOS-only sandbox tests were included in that run.
- fix-loomwright-2-1: The guard test only covers release.yml; ci.yml's package/e2e jobs still use shallow checkouts, which is fine today because they do not run the docs test.
- fix-loomwright-2-1: No changeset added: the diff touches only .github/ and test/, not packages/, templates/ or package.json.
- fix-loomwright-2-2: Could not simulate the wrapped run by setting AI_FACTORY_SANDBOX externally: the factory guards that override. The change was verified by targeted tests, typecheck, lint, format and the full suite (1699 pass, 11 skip, 0 fail), plus reading sandboxEnabled.
- fix-loomwright-2-2: No changeset added: this is a test-only fix and release mechanics are explicitly left to humans in AGENTS.md.
- fix-loomwright-3-1: Did not run `bun run check` itself, but ran its components (format:check, lint, typecheck, full test) individually.
- fix-loomwright-3-1: The plugin bundle now embeds the fixed guard; workspaces still need `loomwright update` on the base branch to pick it up, per the repo's dogfooding note.
- fix-loomwright-3-2: Unknown single-dash letters inside a cluster are treated as boolean flags; a letter npm treats as value-taking other than `-p` could still shift the wrapped command (e.g. `-w <workspace>`). Not covered because npx's `-w` was not part of the finding.
- fix-loomwright-3-2: Did not verify against the real npm binary; behaviour was derived from npm's documented shorthand expansion and the repo's existing tests.
- fix-loomwright-4-1: The npm config list is versioned to the definitions inspected locally; new value-taking npm flags added later would need adding here (the --fetch-* prefix is future-proofed).
- fix-loomwright-4-1: No spec or changeset edit: the approved requirement already says flags that take a value, and the existing guard-runner-aliases changeset covers the behavior.
- fix-loomwright-4-2: Aliases defined in package scripts (`npm run`), make recipes and find -exec could still leak in the guard's model; that predates this change and was not touched.
- fix-loomwright-4-2: No changeset added; existing .changeset/guard-runner-aliases.md covers the npx/pnpx inspection behaviour.
- fix-loomwright-5-1: No changeset added, matching the recent review-finding fix commits (the factory task did not request one and the gates do not enforce it).
- fix-loomwright-5-1: The new make test reuses a `jump` recipe added to shell-policy.test.ts's FILES fixture; the existing hardening Makefile fixture is untouched.
- fix-loomwright-6-1: Subshell redirects are now checked twice (once on the subshell, once when merged into the inner first command); checks are idempotent, but a future write-tracking change should keep that in mind.
- fix-loomwright-6-1: Full `bun run test` passed after the plugin rebuild (1708 pass, 0 fail); no other suites were spot-checked beyond shell-policy and plugin.
- fix-loomwright-6-2: No changeset added; the task did not ask for one and sibling changesets already cover the surrounding guard work, but the repo convention asks for one per packages/ change.
- fix-loomwright-6-2: Did not check the `-c=` path: `npx -c= bash` still takes the next word as call text (unchanged, existing tests cover it).
- fix-loomwright-6-3: Same-class gaps left untouched: pnpm exec / yarn exec and pnpm dlx / yarn dlx still stop at the runner word. Not in this finding's scope; worth a follow-up.
- fix-loomwright-6-3: The plugin bundle is rebuilt but the dogfooding workspace runs the previously installed bundle, so live behaviour changes only after bun run build plus loomwright update on the base branch.
- fix-loomwright-7-1: A local executable literally named e.g. npm@latest would now be treated as npm; this is a safe false positive for the guard.
- fix-loomwright-7-1: Full gate `bun run test` previously failed only on the stale plugin bundle; rerun after build:plugin passes (1711 pass, 11 skip).
- fix-loomwright-7-1: Did not add cases for unbounded version forms like npm@^10; lastIndexOf('@') handles them the same way.
- fix-loomwright-7-2: The entry-level wiring is a one-line callback; the status-source test covers the behaviour but not the React wiring itself.
- fix-loomwright-7-2: No plugin bundle rebuild was needed: packages/core/src/plugin and packages/core/src/policy are untouched.
- fix-loomwright-7-3: Did not add `=<value>` spellings for these seven flags for publish; other flags' `=` form is already covered by an existing row.
- fix-loomwright-7-3: No implementation change, so the vendored plugin bundle is untouched.
- fix-loomwright-7-4: No new test simulates a post-landing commit (that would need throwaway commits, which the task forbids); correctness of the bounded range was verified by running the suite on the change branch where changeTip resolves to HEAD.
- fix-loomwright-7-4: The fallback path (squash landing) assumes a future ADR edit does not also touch the change's openspec directory; an archive commit moving that directory after later ADR edits would be ordered after them by commit date and is not expected in this repo's flow.
- fix-loomwright-7-4: No changeset added: test-only change, outside the packages/templates/package.json rule.
- fix-loomwright-8-1: Ran only the listed gates: format:check, lint, typecheck and the full test suite (all pass); did not run the build gate or the opt-in real-opencode E2E.
- fix-loomwright-8-1: Behaviour for version-tagged package managers now follows the untagged path everywhere in that dispatch (e.g. `bun@1 test` inspects preinstall/postinstall hooks); full suite shows no regressions, but this is a slight widening beyond the literal deploy case.
- fix-loomwright-8-2: Only the test names changed; no production code was touched. Full `bun run test` was not run, only the four affected suites plus watch-parallel.
- fix-loomwright-8-2: No changeset added because the change is test-only and no packages/ source or template changed.
- fix-loomwright-9-1: The repetition test is ~3x slower (25s vs ~9s) because it now runs the whole state-commands file three times; still far below its timeout.
- fix-loomwright-9-1: Did not re-run the full suite a second time to hunt for unrelated flakes; only the repetition test and the standard gates were exercised.
- fix-loomwright-10-1: The value table mirrors npm 11.16; npm versions with different definitions rely on the both-interpretation fallback, which is conservative and may block unusual commands where a boolean flag is followed by a blocked-looking word.
- fix-loomwright-10-1: Multiple -c/--call flags on one runner command still inspect only the first call text, matching the previous behavior; that pre-existing edge was not changed.
- fix-loomwright-10-2: Pre-subcommand scanning stops at the first positional token, but any positional before exec would already be npm's subcommand; unknown-arity long options are still scanned both ways by npmSubcommands.
- fix-loomwright-10-2: No new changeset added: the change already carries guard-npm-exec.md.

## Usage

Total: 220.64M tokens (214.42M cache read, 367.1k out) · cost n/a over 45 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| reviewer | 155.20M | 70% | cost n/a |
| implementer-loomwright | 37.04M | 17% | cost n/a |
| architect | 19.49M | 9% | cost n/a |
| explorer | 5.02M | 2% | cost n/a |
| tester | 3.87M | 2% | cost n/a |
| orchestrator | 12.0k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 155.20M | 70% | cost n/a |
| design | 11.75M | 5% | cost n/a |
| context-packs | 7.74M | 4% | cost n/a |
| 1.5 | 5.63M | 3% | cost n/a |
| explore:loomwright | 5.02M | 2% | cost n/a |
| fix-loomwright-10-1 | 4.89M | 2% | cost n/a |
| test-loomwright | 3.87M | 2% | cost n/a |
| 1.8 | 3.52M | 2% | cost n/a |
| fix-loomwright-4-1 | 2.63M | 1% | cost n/a |
| 1.1 | 2.12M | 1% | cost n/a |
| fix-loomwright-1-3 | 1.34M | 1% | cost n/a |
| fix-loomwright-2-2 | 1.12M | 1% | cost n/a |
| fix-loomwright-7-2 | 1.05M | 0% | cost n/a |
| 1.3 | 1.05M | 0% | cost n/a |
| fix-loomwright-1-1 | 1.05M | 0% | cost n/a |
| fix-loomwright-5-1 | 999.3k | 0% | cost n/a |
| fix-loomwright-4-2 | 894.2k | 0% | cost n/a |
| fix-loomwright-7-1 | 874.5k | 0% | cost n/a |
| fix-loomwright-7-4 | 822.3k | 0% | cost n/a |
| fix-loomwright-10-2 | 807.3k | 0% | cost n/a |
| fix-loomwright-3-2 | 805.2k | 0% | cost n/a |
| fix-loomwright-8-1 | 787.4k | 0% | cost n/a |
| 1.6 | 771.5k | 0% | cost n/a |
| fix-loomwright-6-1 | 731.1k | 0% | cost n/a |
| fix-loomwright-8-2 | 703.2k | 0% | cost n/a |
| fix-loomwright-6-3 | 673.7k | 0% | cost n/a |
| fix-loomwright-3-1 | 636.1k | 0% | cost n/a |
| 1.2 | 526.1k | 0% | cost n/a |
| fix-loomwright-7-3 | 497.8k | 0% | cost n/a |
| 1.4 | 485.5k | 0% | cost n/a |
| 1.7 | 479.2k | 0% | cost n/a |
| fix-loomwright-2-1 | 342.6k | 0% | cost n/a |
| fix-loomwright-1-2 | 289.0k | 0% | cost n/a |
| fix-loomwright-6-2 | 287.0k | 0% | cost n/a |
| fix-loomwright-9-1 | 228.9k | 0% | cost n/a |
| intake | 12.0k | 0% | cost n/a |

Top consumers: review:loomwright (155.20M), design (11.75M), context-packs (7.74M), 1.5 (5.63M), explore:loomwright (5.02M).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 323.
