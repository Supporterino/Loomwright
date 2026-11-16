# 0044 — Guard: Bun builtins, script cycles and JS/TS sinks

## Context

The shell guard installed in front of every agent shell call resolved the first positional
of a `bun`, `npm`, `pnpm` or `yarn` command against `package.json` before it considered the
tool's own subcommands. In this repository `test` is `bun test --timeout 60000 --parallel`
and `build` runs `bun build …`, so `bun test`, `bun run test`, `bun run check` and
`bun run build` expanded a same-named script, and the body expanded itself again, until the
nesting limit fired with "command nests too deeply to inspect". Agents could not run the
repository's own gate commands.

The same guard scanned every non-shell script as flat text. `scripts/e2e-transcript.ts`
names a forbidden `git push` inside a string passed to `note([…])`, so the text scan read
prose as code and blocked the recorder.

## Decision

Three changes to `packages/core/src/policy/shell.ts` and the new
`packages/core/src/policy/script-text.ts`:
- **Builtins before scripts.** A `BUN_BUILTINS` set (`test`, `build`, `install`/`i`,
  `add`/`a`, `remove`/`rm`, `update`, `link`, `unlink`, `pm`, `x`, `create`/`c`, `init`,
  `run`, `repl`, `upgrade`, `publish`, `outdated`, `audit`, `why`, `whoami`, `patch`,
  `patch-commit`, `help`) is checked first when the tool is `bun`. A builtin never expands a
  script of the same name. `bun run <name>` still expands `pre<name>`, `<name>` and
  `post<name>`, and an implicit `bun <name>` whose name is not a builtin still expands when
  it is a `scripts` key. `npm`, `pnpm` and `yarn` keep their existing order and rules.
- **Tracked expansion.** Expansion records the script keys active for the current
  `package.json` directory, `pre`/`post` included, and pops them afterwards.
  Re-entering an active key blocks with one reason that names the script and says it expands
  into itself; the depth limit stays as a last resort for genuinely deep command nesting.
  Running the same script twice in sequence is not a cycle.
- **Lexed JS/TS scripts.** `.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts` files are lexed before
  scanning: comments are dropped, string and template literals are blanked from the code
  pass, `${…}` bodies are lexed as code, and the literal contents of a call whose callee is
  an execution primitive (`exec`, `execFile`, `execSync`, `execFileSync`, `spawn`,
  `spawnSync`, `system`, `eval`, `Function`, `sh`, a `$`-tagged template) are joined and
  scanned with the existing text checks. Shell scripts keep the shell parser; Python, Ruby,
  PHP and inline code keep the whole-text scan.

Alternatives rejected:
- **Special-casing only `test` and `build`.** The same false positive returns for `install`,
  `pm` and `x`, and the next script named after a builtin reopens it.
- **Dropping script expansion for `bun` entirely.** That loses the real `bun run deploy` →
  `git push` block and the implicit `bun deploy` form.
- **A smaller depth limit.** It still blocks legitimate nesting, and it reports a vague
  reason instead of the script that cycled.
- **Stripping comments only.** It does not fix the reported case, because the `git push`
  lives in a string, not a comment.
- **`Bun.Transpiler`.** It pulls a runtime API into policy code that also ships in the
  node-target CLI bundle, and a full AST does not answer which literals reach a sink.

## Consequences

- The guard now matches what Bun actually runs: `bun test`, `bun run test`, `bun run check`
  and `bun run build` are allowed in a repository whose scripts share those names. This is a
  deliberate behaviour change for users, not a relaxation; the `npm`, `pnpm` and `yarn`
  behaviour is unchanged.
- A cyclic script fails fast with a reason that names it, instead of exhausting the nesting
  limit.
- A literal that reaches an execution primitive through a variable stays undetected, as
  before. A regex containing `//` or `/*` may be read as a comment: this is a lexer, not a
  parser.
- `templates/plugin/factory-plugin.txt` must be regenerated with `bun run build:plugin`
  whenever `packages/core/src/policy/` changes; the committed bundle is what agents run.
