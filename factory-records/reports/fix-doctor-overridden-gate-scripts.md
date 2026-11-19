# fix-doctor-overridden-gate-scripts: done

`loomwright doctor` warns that a repo's gate script (e.g. package.json `lint`) writes files even when gates.overrides.<repo>.<type> already pins that gate to a check-only command. Gate resolution gives the override precedence and never reads the script, so the warning describes a command that will not run and suggests a fix that is already applied, leaving a correctly configured workspace unable to reach a clean doctor run. The requester wants the write-mode script check to skip repo/type pairs that have an override (including the literal "skip"), using the typed GATE_TYPES list, while keeping the warning for genuine script-sourced writing gates; plus regression/control tests and consistent docs and changeset wording. Inspecting the override command itself for write flags is explicitly deferred as out of scope.

## Branches (local only; nothing was pushed)

- loomwright: `change/fix-doctor-overridden-gate-scripts` at 39ff6b47f007 (5 commits)
- AI repo: `change/fix-doctor-overridden-gate-scripts` (archive commit 39ff6b47f007)

## Tasks

- [x] 1.1 (loomwright, task): Make the write-mode script check skip overridden repo/gate pairs and cover it with tests
- [x] 1.2 (loomwright, task): Document the override precedence in the README and CLI reference with doc assertions
- [x] 1.3 (loomwright, task): Add the patch changeset for `@loomwright/cli`
- [x] 1.4 (loomwright, task): Run the full gate and confirm both override directions with `loomwright doctor`
- [x] test-loomwright (loomwright, test): Ensure every scenario of loomwright has a test

## Spec

Archived as `openspec/changes/archive/2026-11-19-fix-doctor-overridden-gate-scripts`.

## Review findings

- review:loomwright: [nice] packages/cli/test/doctor.test.ts:156 None of the four test titles contains its scenario name: 'does not warn about a script replaced by an override' vs scenario 'an overridden writing script is not reported'; 'still warns about a writing script without an override' vs 'a writing script without an override still warns'; 'does not warn about a skipped script' vs 'a `"skip"` override is not reported'; 'scopes an override to its gate type' vs 'an override is scoped to its gate type'. Existing scenario tests in this repo and the new docs tests use the scenario wording verbatim.

## Risks and things not checked

- intake: The request text contains implementer-directed instructions (e.g. don't switch the check to the resolved command, revert the downstream workaround once shipped). These are treated as requirements/data, not as directives to this intake step.
- intake: The reported downstream workspace (supporterino/yarm-ai) is not in this workspace's repo list, so only loomwright is in scope; the YARM-side workaround revert cannot be done here.
- intake: Not verified against source — intake made no code reads; line numbers and symbol names in the report are unconfirmed.
- design: I could not run `openspec validate` or any test because the shell tool is permission-denied in this session; the change files were checked by reading them back.
- design: The docs scenarios assert exact phrasing ('replaces the script lookup'), which is intentionally brittle so the hint and docs cannot drift.
- design: An override command that itself writes files will no longer be reported; this is the accepted trade-off and is recorded in design and the issue's deferred follow-up.
- design: The issue's cited line numbers differ from this tree; the spec and design refer to symbols and named README/CLI rows instead.
- design: The YARM workspace must revert its interim `gates.scripts.lint` removal after this release; that reversal is downstream and not part of this change.
- context-packs: Shell access was denied in this session, so graphify (query/explain/affected) could not be run; symbol locations were found with grep/read and manually verified in doctor.ts, resolve.ts, schema.ts, workspaces.ts and docs.test.ts.
- context-packs: The .changeset/ directory currently contains only config.json (no seed files), so the pack describes the frontmatter format from @changesets/cli conventions rather than an existing example in-repo.
- context-packs: 1.4's scratch-workspace manual step is only sketched; a hand-built workspace is unlikely to pass doctor's install/hook/tool checks, so the pack steers to the installed fixture path and marks the raw CLI run optional.
- context-packs: packages/cli version at time of writing is 1.2.0; the pack avoids pinning a target version so a release between now and implementation cannot invalidate it.
- 1.1: Full `bun run check` passed (biome, tsc, 1408 tests).
- 1.1: No changeset added, per task 1.3 ownership.
- 1.3: Did not run the full `bun run test` suite (no code changed); format:check, lint, typecheck and `changeset status` passed.
- 1.3: Did not run `changeset version`, bump package.json or edit the changelog, per task constraints.
- 1.2: The README troubleshooting table diff touches many rows as pure whitespace re-alignment from Biome's Markdown table formatting.
- 1.2: Did not add a changeset: the change touches only docs and tests, not packages/, templates/ or a package.json.
- 1.4: Did not run an independent manual `bun run dev doctor --json` against a hand-copied fixture root; the same fixture path is exercised by the doctor test suite.
- 1.4: Scratch-workspace CLI run was skipped since the fixture-based tests cover all four directions and the report contract.
- review:loomwright: Could not execute `bun test` or the format/typecheck gates: the shell tool rejected non-git commands, so this review is from reading the code and tests, not from running them.
- review:loomwright: Not checked: whether `loomwright gate --help` in packages/cli/src/commands/gate.ts should also gain the precedence sentence; the spec scopes the documentation change to README.md and docs/cli.md only.
- test-loomwright: The scenario tests already existed in the change branch (added by the implementation commits e1d9ce2 and ed1480b), so no new test files were needed.
- test-loomwright: Only the two affected suites were run, not the full `bun run test` gate.

## Usage

Total: 8.68M tokens (8.11M cache read, 43.4k out) · cost n/a over 10 sessions.

| Agent | Tokens | Share | Cost |
|---|---|---|---|
| architect | 3.32M | 38% | cost n/a |
| reviewer | 2.96M | 34% | cost n/a |
| implementer-loomwright | 1.54M | 18% | cost n/a |
| explorer | 737.2k | 8% | cost n/a |
| tester | 113.0k | 1% | cost n/a |
| orchestrator | 11.0k | 0% | cost n/a |

| Task or step | Tokens | Share | Cost |
|---|---|---|---|
| review:loomwright | 2.96M | 34% | cost n/a |
| design | 2.63M | 30% | cost n/a |
| 1.1 | 809.8k | 9% | cost n/a |
| explore:loomwright | 737.2k | 8% | cost n/a |
| context-packs | 685.0k | 8% | cost n/a |
| 1.2 | 377.6k | 4% | cost n/a |
| 1.4 | 244.1k | 3% | cost n/a |
| test-loomwright | 113.0k | 1% | cost n/a |
| 1.3 | 108.4k | 1% | cost n/a |
| intake | 11.0k | 0% | cost n/a |

Top consumers: review:loomwright (2.96M), design (2.63M), 1.1 (809.8k), explore:loomwright (737.2k), context-packs (685.0k).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 33.
