# Design: guard and e2e follow-ups

## Context

`packages/core/src/policy/shell.ts` is the guard the bundled plugin installs in front of every
agent shell call. `checkPackageScript` (~line 356) decides whether a `bun`/`npm`/`pnpm`/`yarn`
word names a `package.json` script, and `checkScript` → `checkScriptAst` (~1574) refuses a
command after 25 nested scripts. `checkScriptFile` (~886) parses shell scripts with the local
parser (`shell-parse.ts`) but text-scans every other script with `scanText` (~170).

This repository's root `package.json` has `"test": "bun test --timeout 60000 --parallel"` and
`"build": "bun scripts/build-plugin.ts && bun build … && bun scripts/write-dist-package.ts &&
bun scripts/prepare-package.ts"`, so the current rule expands `test` from `bun test`, and
`build` from the `bun build` inside the `build` body, until the depth limit fires.
`scripts/e2e-transcript.ts` names a forbidden `git push` in a `note([…])` string, which the
text scan reads as code.

The policy is bundled into `templates/plugin/factory-plugin.txt`; the running guard in this
workspace is the previous build until `loomwright update` runs after landing, so the fix is
proven by unit tests and by the gates, not by dogfooding.

## Decisions

### D1 — Resolve Bun builtins before `scripts`

Add a `BUN_BUILTINS` set (`test`, `build`, `install`/`i`, `add`/`a`, `remove`/`rm`, `update`,
`link`, `unlink`, `pm`, `x`, `create`/`c`, `init`, `run`, `repl`, `upgrade`, `publish`,
`outdated`, `audit`, `why`, `whoami`, `patch`, `patch-commit`, `help`) and check it first when
`tool === "bun"`. `run` keeps expanding `pre`/`post`/body; a non-builtin `bun <name>` that is a
`scripts` key keeps expanding. `npm`/`pnpm`/`yarn` keep the existing order.

Rejected: special-casing only `test` and `build` (the same false positive returns for
`install`, `pm`, `x`); dropping script expansion for `bun` entirely (loses the real
`bun run deploy` → `git push` block and the implicit `bun deploy` form).

This is a deliberate behaviour change, not a relaxation: Bun resolves those words itself and
never runs the same-named script, so expanding them was the false positive.

### D2 — Track expanded scripts instead of lowering the depth limit

`State` gains a set of expansion keys (`<cwd>\0<key>`, including `pre`/`post`) that is pushed
around each expansion and popped afterwards, so a cycle is a re-entry on the active stack and
`bun run test && bun run test` stays fine. Re-entering a key blocks with one reason: `` script
`<name>` expands into itself ``. The depth limit stays as a last resort for genuinely deep
command nesting.

Rejected: a smaller depth limit (still blocks legitimate nesting and gives a vague reason);
letting a cycle pass (silently skips a body that was not inspected).

### D3 — Scan JS/TS script files as code, with exec-sink literals kept

New `packages/core/src/policy/script-text.ts` lexes JS/TS:

- comments (line and block) are dropped;
- string and template literals are blanked from the code pass;
- `${…}` interpolation bodies are lexed as code;
- the contents of adjacent literals (including array elements) inside a call whose callee is
  an execution primitive (`exec`, `execFile`, `execSync`, `execFileSync`, `spawn`, `spawnSync`,
  `system`, `eval`, `Function`, `sh`, a `$`-tagged template) are joined and scanned with the
  existing `scanText`.

`checkScriptFile` uses it for `.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts`. Shell scripts keep the
parser; `python3`, `ruby`, `php` and inline code (`-e`, `-c`, stdin, here-docs) keep the
whole-text `scanText`.

Rejected: dropping string literals everywhere (would lose `subprocess.run(['git','push'])` and
`execSync("git push")`, which are real denies); stripping comments only (does not fix the
reported case, because the `git push` lives in a `note([…])` string, not a comment); using
`Bun.Transpiler` (pulls a runtime API into policy code that also ships in the node-target CLI
bundle, and a full AST does not solve the sink question anyway).

Trade-off: narrowing to exec-sink arguments gives up one deny the whole-text scan made — a
literal assigned in the file and passed through a variable (`const c = "git push";
execSync(c)`) is no longer caught, because the lexer only joins literals written inside the
call. A literal that reaches a sink from outside the file (argv, stdin, another module) was and
stays undetected, and a literal passed to a non-execution function is no longer blocked. The
last two are false positives by definition, and the Python/shell paths are unchanged.

### D4 — Version-gate `docs/e2e/`, keep the rest strict

`test/docs.test.ts` gains `isHistoricalTranscript(text)` (recorded version ≤ `0.12.0`, or no
parseable header) next to the existing `isHistoricalSnapshot`. The strict no-name scan keeps
`docs/decisions/`, `docs/research/`, `docs/audit/` and the historical install snapshots; for
`docs/e2e/` it applies only to historical transcripts.

The header line moves to `scripts/e2e-header.ts` (`headerLine(layout, version, date)`), used by
the recorder and imported by the test, so the recorder cannot drift from the classifier.

Rejected: moving the pre-rename transcripts to `docs/e2e/archive/` (moves historical files,
splits one rule into two, and the recorder still needs the format half of the change); keeping
the exact `(ai-factory 0.2.0)` pin on `docs/e2e/single.md` (breaks the moment a transcript is
re-recorded, which is the point of the change, and it is now re-recorded here).

Re-recording happens in this change, after the bundle regeneration: the recorder drives `init`,
which renders `.opencode/plugins/factory.js` from the text-imported
`templates/plugin/factory-plugin.txt`, so recording before task 1.4 would capture the old guard.
Both layouts are recorded with `bun scripts/e2e-transcript.ts single` and `… submodules`, which
overwrite `docs/e2e/single.md` and `docs/e2e/submodules.md` in place; the pre-rename text stays
in git history. Rejected: keeping the old transcripts and recording new ones beside them (two
files per layout for no reader), and copying the old text to `docs/e2e/archive/` (the request
chose re-recording, and the text is one `git log` away).

The recordings depend on a real opencode, OpenSpec and Graphify on the machine. If one is
missing the task reports it and leaves the two files untouched; the test change still lands, and
a later recording needs no further edit.

### D5 — Part 3 read as three independent invariants

`test/publish.test.ts` already builds the plugin in memory and compares (line 218-221, with the
comment explaining exactly this race), so the finding is already fixed in the tree; the change
turns it into an asserted invariant (`bundlePlugin()` must not touch the tracked file and must
leave no temp file) instead of adding a second mechanism. `scripts/write-dist-package.ts`
exports `writeDistPackage(out)` and creates the directory with `mkdirSync(…, { recursive: true
})`, mirroring `scripts/prepare-package.ts`. `.gitignore` loses the redundant
`packages/cli/dist/` line and `test/publish.test.ts` asserts the `dist/` pattern plus
`git check-ignore` instead of the literal path.

### D6 — ADR-0044 and one changeset

The guard rules are a decision worth recording: Bun builtins vs scripts, cycle handling, and
the exec-sink scan. ADR-0044 goes in `docs/decisions/` (no capitalised product name, per the
history rule) with its index row, and `packages/core` changes get a `patch` changeset.

## Contract changes

None. No API schema, event, Helm value or workspace format changes; `factory.config.jsonc`,
`factory.lock.json`, `.opencode/` and `openspec/specs/` are untouched.

## Risks

- The guard that blocks agent shells during this change is still the old bundle, so implementers
  may hit the same false positives; the factory's gates run outside the guard, so `bun run
  check` still works there, and `bun --cwd . test <file>` slips past the old expansion because
  its first positional is not a script name. `.opencode/plugins/factory.js` only changes after
  landing plus `loomwright update`.
- The JS/TS lexer does not disambiguate regex literals from division; a `//` or `/*` inside a
  regex can be read as a comment. Harmless for the repo's scripts and covered by tests for
  normal code, but it is a lexer, not a parser.
- `bun --cwd <dir> <subcommand>` and `bun --filter <name> <subcommand>` put a non-subcommand
  first, so they are accepted without inspection — unchanged from today and out of scope.
- A `git push` literal assigned to a variable and then passed to an execution primitive
  (`const c = "git push"; execSync(c)`) is no longer detected, where the whole-text scan caught
  it; a literal that reaches a spawn from outside the file stays undetected, as today.
- A re-recorded transcript embeds the machine's tool versions, the recording date, wall time and
  stub request counts, so the two files are environment-specific and will differ again on the
  next recording. If opencode, OpenSpec or Graphify is unavailable the recording task leaves the
  files untouched and reports it; the suite does not depend on the recording having happened.
- Observed while exploring (out of scope): `grep`/`rg` from the repository root is blocked
  because the walk covers `.factory/`, which holds a secret-looking file. Agents cannot search
  the tree root; this is a separate guard false positive for a follow-up change.
