## Why

Agents cannot run this repository's own gate commands. The shell guard resolves `bun`'s first
word against `package.json` before Bun's own subcommands, so `bun test`, `bun run test`,
`bun run check` and `bun run build` expand a same-named script and recurse until the guard
refuses with "command nests too deeply to inspect". A second false positive treats prose in a
script as code, so `bun scripts/e2e-transcript.ts single` is refused for a `git push` that is
only a sentence in a string literal. Every task in the restructure run worked around both,
which cost a large share of its tokens.

Two smaller follow-ups go with it: a transcript written by the current recorder can never pass
`test/docs.test.ts`, which pins the pre-rename header and forbids the product name under
`docs/e2e/`, so the e2e runs cannot be re-recorded — this change fixes that and re-records both
layouts; and three review leftovers (nothing asserts that the bundle check never writes the
tracked file, a build script assumes its output directory, a redundant `.gitignore` line) are
cheap to close while the guard is being touched.

## What Changes

- `bun` builtin subcommands (`test`, `build`, `install`, `add`, `remove`, `update`, `link`,
  `unlink`, `pm`, `x`, `create`, `init`, `run`, `publish`, `outdated`, `audit` and aliases) are
  no longer treated as package scripts; `bun run <script>` still expands and inspects
  `pre<name>`, `<name>` and `post<name>`.
- Script expansion remembers what it is expanding: a self-referential or cyclic script stops
  with one reason naming the script, instead of reaching the nesting limit.
- Script files are inspected as code: comments never count, and for JS/TS a string or template
  literal counts only when it is an argument of an execution primitive, so
  `execSync("git push")` stays blocked while a transcript's prose does not. Shell scripts keep
  their parser and other interpreters keep the whole-text scan.
- `test/docs.test.ts` classifies `docs/e2e/` transcripts by the version in their header:
  recordings at or below `0.12.0` are historical and stay name-free, newer ones are current.
  The recorder's header line moves into a shared helper so test and recorder cannot drift.
- `docs/e2e/single.md` and `docs/e2e/submodules.md` are re-recorded with the current recorder
  once the regenerated plugin bundle is in place, so both transcripts show the current name and
  the fixed guard; the pre-rename text stays in git history.
- Build hygiene: the suites assert the bundle check only ever builds in memory, the dist package
  script creates `packages/cli/dist`, and `.gitignore` no longer repeats `packages/cli/dist/`.
- ADR-0044, a changeset, and a regenerated `templates/plugin/factory-plugin.txt`.

## Capabilities

### New Capabilities

- `agent-shell-guard`: which commands the guard lets through and how it reads the scripts a
  command runs.
- `build-artifact-hygiene`: what tests and build scripts may write, and which generated paths
  the repository ignores.

### Modified Capabilities

- `documentation`: e2e transcripts are classified by recorded version instead of by directory,
  and both existing transcripts are re-recorded.
- `compatibility-surface`: the historical-material rule is version-gated for `docs/e2e/`, the two
  existing transcripts are re-recorded with the current name, and `docs/decisions/`,
  `docs/research/` and `docs/audit/` stay strict.

## Impact

- Repo: `loomwright` only.
- Code: `packages/core/src/policy/shell.ts`, a new `packages/core/src/policy/script-text.ts`,
  `packages/core/test/` (`shell-policy`, `script-text`, `plugin`), `test/docs.test.ts`,
  `test/publish.test.ts`, `scripts/e2e-header.ts`, `scripts/e2e-transcript.ts`,
  `scripts/write-dist-package.ts`, `.gitignore`, `docs/decisions/`, `.changeset/`.
- Recorded: `docs/e2e/single.md` and `docs/e2e/submodules.md` are rewritten by
  `bun scripts/e2e-transcript.ts single|submodules` after the bundle is rebuilt.
- Generated: `templates/plugin/factory-plugin.txt` is regenerated and committed.
- Contracts: none configured; no API schema, event or Helm value changes.
- Data: none; no workspace format, lockfile or migration changes.
- Protected: `.opencode/plugins/factory.js` and `factory.lock.json` are rendered by the
  installed CLI. This change does not edit them; `loomwright update` regenerates both after
  landing, and the final report names it.
- Behaviour change for users of the guard: a `bun` command whose name is a Bun builtin no
  longer expands the script of the same name, because Bun does not run that script.
