# gate-opencode-feature-versions: done

The requester wants Loomwright to accept every opencode 2.x minor release instead of tying support to a specific 2.3.0 cut, without raising the currently supported minimum version. Because only major opencode releases are treated as breaking, compatibility should be expressed per feature: a feature that depends on a function or capability only present from a given opencode version should declare that requirement itself, so only users of that feature need the newer opencode, while everyone else keeps running on the current floor. Minor versions otherwise stay universally supported.

## Branches (local only; nothing was pushed)

- loomwright: `change/gate-opencode-feature-versions` at 3b9d52e25747 (11 commits)
- AI repo: `change/gate-opencode-feature-versions` (archive commit 3b9d52e25747)

## Tasks

- [x] 1.1 (loomwright, task): Widen the opencode base range to `>= 2.1.2 < 3.0.0`, replace the range comment and the `VersionRange.min` comment with the major-only policy, and add `packages/core/src/opencode-features.ts` with `OPENCODE_FEATURES` (`mcp.roles` → 2.2.0 with its `why`), `enabledOpencodeFeatures` (a role with an empty pattern list does not enable it) and `opencodeRequirement` (highest floor plus reason); unit-test the range, the registry invariant and the empty/non-empty/empty-list cases in `packages/core/test/opencode-features.test.ts`
- [x] 1.2 (loomwright, task): Add an optional `ToolRequirement` (`min`, `reason`) to `checkTool`/`checkTools` and append the reason to the below-floor problem; add `packages/core/test/tools.test.ts` with version stubs for 2.1.1, 2.1.2, 2.2.0, 2.2.7, 2.3.0, 2.99.0 and 3.0.0, asserting the accepted set, both rejections and the reason text
- [x] 1.3 (loomwright, task): Let `buildLock` take an optional opencode floor and have `syncWorkspace` write `opencodeRequirement(config)?.min ?? OPENCODE.min`; test the default and overridden pin in `packages/core/test/lock.test.ts`
- [x] 1.4 (loomwright, task): In `init`, read an existing `factory.config.jsonc` before the tool check, pass its `opencodeRequirement` to `checkTools`, and add a test that `mcp.roles` with opencode 2.1.2 exits 4 naming the feature while 2.2.0 succeeds and writes `tools.opencode.min` 2.2.0
- [x] 1.5 (loomwright, task): In `update`, compute the requirement from `plan.config` and pass it to the warning-only tool check; add a test that `mcp.roles` with opencode 2.1.2 warns naming the feature, succeeds, and writes `tools.opencode.min` 2.2.0
- [x] 1.6 (loomwright, task): In `doctor`, load the config before the tool check, pass the requirement to `checkTools`, add a `fail` for an unmet feature floor and a warning when the lock's opencode floor is behind the config; add tests for the fail, the stale-lock warning and the unchanged 2.1.2 base case
- [x] 1.7 (loomwright, task): Update the README support table and `docs/cli.md` (init, update, doctor) to describe the 2.x range and the `mcp.roles` floor; add `docs/decisions/0045-*.md` with a name-free index row and a `patch` changeset for `@loomwright/cli`
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test

## Spec

Archived as `openspec/changes/archive/2026-11-16-gate-opencode-feature-versions`.

## Review findings

- review:loomwright: [should] openspec/changes/gate-opencode-feature-versions/specs/opencode-compatibility/spec.md:55 A custom agent's non-empty `mcp` list (schema.ts:169, rendered through customAgentRules) allows the same MCP tool actions and needs the same 2.2.0 execute-denied exposure, but no config.mcp.roles key exists, so opencodeRequirement returns undefined and init/update/doctor let opencode 2.1.2 through. Those agent MCP tools are then silently hidden.
- review:loomwright: [nice] packages/core/src/opencode-features.ts:21 Two copies of the same {min, reason} shape must stay in sync, and the TS standard asks for `interface` rather than `type` for object shapes.
- review:loomwright: [nice] packages/core/src/doctor/doctor.ts:206 The registry invariant already guarantees requirement.min >= OPENCODE.min, and checkTool applies its own clamp, so doctor carries a second copy of the floor rule that must change together.
- review:loomwright: [nice] packages/core/test/lock.test.ts:61 A future GIT or GRAPHIFY bump makes this opencode-floor test fail even though buildLock is unchanged.

## Risks and things not checked

- intake: I did not read any code, so where the current opencode floor is declared and how a per-feature requirement could be expressed (config schema, runtime client capability checks, doctor/preflight, templates) is unverified; the change may legitimately touch several of these areas.
- intake: Assumption: the existing minimum supported version stays exactly as it is now — this is a widening plus a feature-gating mechanism, not a floor bump.
- intake: Assumption: opencode 3.x is out of scope for this change. The 3.x answer was read as 'majors may break, so gate by feature rather than globally', not as 'certify 3.x now'. If 3.x support is wanted immediately, an additional feature-level requirement would have to be added for it.
- intake: How a feature detects the running opencode version (probe at startup vs. declared capability vs. static requirement list) is a design decision for the spec phase, not settled here.
- intake: No untrusted-content instructions were encountered in this intake.
- design: 2.3.0 is accepted but not exercised end to end by the E2E matrix; a real 2.3.0 run is a follow-up verification.
- design: The registry invariant (feature min between OPENCODE.min and OPENCODE.tested) is enforced by a test, not the type system.
- design: skills.roles, websearch, runtime and security.sandbox are assumed to have no 2.2-only capability; adding a floor for one needs its own evidence.
- design: docs/e2e transcripts and docs/research/tooling.md still show the old 2.3.0 pin because they are historical recordings/research and are not edited.
- design: update can write a lock floor the installed opencode does not meet; that is intentional, and doctor reports the gap until the tool is upgraded.
- design: .opencode/ and factory.lock.json are protected and rendered by the installed CLI; loomwright update regenerates the lock after landing.
- context-packs: The shell tool was denied in this session, so graphify could not be queried and no command (typecheck/test/format, wc for pack sizes) could be run; packs are based on direct file reads of the listed sources and the approved change files.
- context-packs: Packs were written against the approved tasks.md ids/metadata and were not re-derived from a fresh graph; file line numbers are hints only, as the packs state.
- context-packs: 1.7 leaves docs/e2e/*.md and docs/research/tooling.md untouched (recordings/historical, per design.md risks) and marks the README E2E sentence reword as optional for consistency.
- 1.1: factory.lock.json (protected, rendered) still records opencode maxExclusive 2.3.0; it is refreshed by task 1.3 / `loomwright update`, not this task. Historical install fixtures under test/fixtures keep their old pins deliberately.
- 1.1: checkTool behaviour and init/update/doctor floor enforcement are tasks 1.2-1.6 and were not exercised here; existing checkTool accepts 2.x through 3.0.0 already since it reads the constant.
- 1.7: Full bun run test had one flaky timing failure in packages/cli/test/state-commands.test.ts (status --watch, 80 ms abort); it passes in isolation and is unrelated to this docs-only change.
- 1.7: The new tests assert exact doc phrases, so future rewording of these sentences must update test/docs.test.ts.
- 1.7: Did not run bun run build or bunx changeset; release mechanics stay human, and the plugin bundle is untouched.
- 1.3: syncWorkspace's own use of the floor is not exercised end to end here; init/update fixtures in 1.4/1.5 must cover it.
- 1.3: No changeset added: adding one needs a new file outside the allowed touches, and release mechanics stay human per repo conventions.
- 1.2: No changeset added: .changeset/ is outside the task's touches globs (previous task 1.1 also has none), so packaging metadata for these packages/core changes is still owed before release.
- 1.2: Ran bun run test:fast (870 pass) plus the two targeted suites; the slower integration files (pipeline, init, gates-run, review-loop, etc.) were not rerun here, and callers were unchanged (optional third param).
- 1.5: Full `bun run test` had one flaky, unrelated failure in packages/cli/test/state-commands.test.ts ('status --watch reprints frames until interrupted', 80ms abort under --parallel); it passes standalone.
- 1.5: Did not check the real-opencode opt-in E2E; not needed for this warning-only path.
- 1.4: No changeset added: .changeset/ is outside the task's touched-file scope, though repo convention wants one for packages/ changes.
- 1.4: status --watch test in packages/cli/test/state-commands.test.ts is timing-flaky under 10x parallel load; unrelated and green on rerun.
- 1.4: Did not touch update/doctor (tasks 1.5/1.6).
- 1.6: No changeset added because the task's allowed paths exclude .changeset/; repo convention asks for one for packages/ changes, so the landing step may need one.
- 1.6: bun run check failed twice on pre-existing parallel-timing tests (state-commands watch, pipeline); both pass in isolation and are unrelated to this diff.
- review:loomwright: Tests were not run (shell blocked); findings rest on reading the code, so a failing gate could still appear.
- review:loomwright: The mcp-pattern-from-custom-agent gap may be a deliberate scope choice (design D2 rejects inferring from rendered agents); the architect should decide whether the spec's mcp.roles rule covers agents[].mcp.
- review:loomwright: New cli tests set AI_FACTORY_OPENCODE_BIN per test; with bun test --parallel, env stubs in init/update/doctor suites share one process, which can flake. Pre-existing pattern, not verified by running.
- review:loomwright: docs/e2e transcripts and docs/research/tooling.md still show the old 2.3.0 pin; the design says this is deliberate history.
- test-loomwright: No changeset was added: the task only permits editing test files, so the repo's change-under-packages changeset convention is left to the implementer/landing step.
- test-loomwright: Full suite: 974 pass, 5 skipped, 0 fail.

## Usage

Total: 22.43M tokens (21.37M cache read, 94.4k out) · cost n/a over 14 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| architect | 7.02M | 31% | cost n/a |
| reviewer | 6.95M | 31% | cost n/a |
| implementer-loomwright | 4.84M | 22% | cost n/a |
| explorer | 3.12M | 14% | cost n/a |
| tester | 498.4k | 2% | cost n/a |
| orchestrator | 16.2k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 6.95M | 31% | cost n/a |
| design | 3.99M | 18% | cost n/a |
| explore:loomwright | 3.12M | 14% | cost n/a |
| context-packs | 2.73M | 12% | cost n/a |
| 1.6 | 918.9k | 4% | cost n/a |
| 1.5 | 914.3k | 4% | cost n/a |
| 1.4 | 727.3k | 3% | cost n/a |
| 1.2 | 658.4k | 3% | cost n/a |
| 1.7 | 658.3k | 3% | cost n/a |
| 1.1 | 514.0k | 2% | cost n/a |
| test-loomwright | 498.4k | 2% | cost n/a |
| 1.3 | 447.2k | 2% | cost n/a |
| reword | 298.6k | 1% | cost n/a |
| intake | 16.2k | 0% | cost n/a |

Top consumers: review:loomwright (6.95M), design (3.99M), explore:loomwright (3.12M), context-packs (2.73M), 1.6 (918.9k).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 36.
