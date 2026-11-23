# agent-shell-guard Specification

## Purpose
The shell guard the factory's opencode plugin installs in front of every agent shell call. It
refuses commands that would push, publish, escape the session or read secrets, and it inspects
the scripts a command would run.

## Requirements

### Requirement: Bun builtin subcommands are not package scripts

When the guard inspects a `bun` command it SHALL take the first positional as a Bun subcommand
and MUST resolve it against Bun's builtin set before it looks in `package.json`. The set
includes `test`, `build`, `install`/`i`, `add`/`a`, `remove`/`rm`, `update`, `link`, `unlink`,
`pm`, `x`, `create`/`c`, `init`, `run`, `repl`, `upgrade`, `publish`, `outdated`, `audit`,
`why`, `whoami`, `patch`, `patch-commit` and `help`. A builtin MUST NOT expand a script of the
same name. `bun run <name>` MUST keep expanding `pre<name>`, `<name>` and `post<name>`, and a
`bun <name>` whose name is not a builtin and is a `scripts` key MUST keep expanding. The
`npm`, `pnpm` and `yarn` rules MUST NOT change.

#### Scenario: `bun test` is allowed with this repository's real scripts

- **WHEN** the guard checks `bun test` with the repository's root `package.json` as its script
  source, where `test` is `bun test --timeout 60000 --parallel`
- **THEN** the verdict is allowed
- **AND** it carries no `nests too deeply` reason

#### Scenario: `bun run test` reaches the test runner, not a recursive script

- **WHEN** the guard checks `bun run test` with that same `package.json`
- **THEN** the verdict is allowed
- **AND** the reason is not `command nests too deeply to inspect`

#### Scenario: `bun run check` through the nested `bun run test`

- **WHEN** the guard checks `bun run check`, where `check` is
  `biome check . && tsc --noEmit && bun run test`
- **THEN** the guard inspects the `check` body, expands `test` and stops at the `bun test`
  builtin
- **AND** the verdict is allowed

#### Scenario: `bun run build` through the nested `bun build`

- **WHEN** the guard checks `bun run build`, where `build` is
  `bun scripts/build-plugin.ts && bun build packages/cli/src/bin.ts --target=node --outfile packages/cli/dist/cli.js && bun scripts/write-dist-package.ts && bun scripts/prepare-package.ts`
- **THEN** `bun build` is treated as the bundler and the two `bun scripts/*.ts` words are
  inspected as script files
- **AND** the verdict is allowed

#### Scenario: install-side builtins do not expand a same-named script

- **WHEN** the guard checks `bun install`, `bun add left-pad`, `bun pm ls` and `bun x tsc` with
  a `package.json` whose `scripts` contain an `install` and a `build` entry
- **THEN** every one of them is allowed without expanding a script body

#### Scenario: a real script body is still inspected and blocked

- **WHEN** the guard checks `bun run deploy`, where `deploy` is `git push`
- **THEN** the verdict is blocked and the reason names `git push`

#### Scenario: the implicit `bun <script>` form still expands a non-builtin name

- **WHEN** the guard checks `bun deploy` with the same `package.json`
- **THEN** the verdict is blocked, as before

#### Scenario: npm, pnpm and yarn keep their rules

- **WHEN** the guard checks `pnpm sneaky` with `sneaky` = `git push`
- **THEN** the verdict is blocked
- **AND** `npm run lint` with `lint` = `biome check .` is allowed

### Requirement: Script expansion terminates with one clear reason

Script expansion MUST remember the script keys it is already expanding for the current
`package.json` directory, including `pre`/`post` keys. Re-entering a key MUST stop the command
with a single block reason that names the script and says it expands into itself. The guard
MUST NOT fall through to the nesting limit for this case and MUST NOT continue as if the body
had been inspected.

#### Scenario: a self-referential script is refused once

- **WHEN** the guard checks `bun run test` where `test` is `bun run test`
- **THEN** the verdict is blocked
- **AND** the reason contains the script name and `expands into itself`
- **AND** the reason does not contain `nests too deeply`

#### Scenario: a pre/post hop is a cycle too

- **WHEN** the guard checks `bun run deploy` where `deploy` is `bun run postdeploy` and
  `postdeploy` is `bun run deploy`
- **THEN** the verdict is blocked with one reason naming `deploy` or `postdeploy`

#### Scenario: a longer ring is cut at the re-entered script

- **WHEN** the guard checks `bun run a` where `a` is `bun run b` and `b` is `bun run a`
- **THEN** the verdict is blocked
- **AND** the reason is the same single cycle reason, not the nesting limit

#### Scenario: an acyclic chain still runs to the end

- **WHEN** the guard checks `bun run check` where `check` runs `bun run test` and `test` is
  `bun test`
- **THEN** no cycle reason is produced
- **AND** the verdict is allowed

#### Scenario: running the same script twice on one line is not a cycle

- **WHEN** the guard checks `bun run test && bun run test` where `test` is `bun test --timeout
  60000 --parallel`
- **THEN** both expansions end at the `bun test` builtin
- **AND** the verdict is allowed

### Requirement: Script files are inspected as executable code

Comments in an inspected script file MUST NOT contribute to a block. For JavaScript and
TypeScript files (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`) a string or
template literal MUST only be scanned when it is an argument of an execution primitive
(`exec`, `execFile`, `execSync`, `execFileSync`, `spawn`, `spawnSync`, `system`, `eval`,
`Function`, `sh`, `$`), and adjacent literal concatenation inside such a call MUST stay joined.
Shell scripts MUST keep being parsed as shell. Every other interpreter MUST keep the existing
whole-text scan.

#### Scenario: the e2e recorder is accepted

- **WHEN** the guard checks `bun scripts/e2e-transcript.ts single` with the repository's real
  file content, whose prose names a forbidden `git push`
- **THEN** the verdict is allowed

#### Scenario: a real spawn of `git push` in the same file is still blocked

- **WHEN** the guard checks the same command against that file content plus an
  `execSync("git push")` statement
- **THEN** the verdict is blocked and the reason says the embedded code runs `git push`

#### Scenario: literals of one spawn call are joined before the scan

- **WHEN** the guard checks `bun scripts/publish.ts`, whose body calls
  `spawnSync(["git", "push"])`
- **THEN** the verdict is blocked

#### Scenario: prose passed to a non-execution call does not block

- **WHEN** the guard checks a `.ts` file whose only mention of `git push` is a `note("…")` or
  `console.log("…")` argument
- **THEN** the verdict is allowed

#### Scenario: a comment does not block in any script type

- **WHEN** the guard checks `bash scripts/release.sh` whose only mention of `git push` is on a
  `#` comment line, and `bun scripts/git.ts` whose only mention is in a `//` or `/* */` comment
- **THEN** both verdicts are allowed

#### Scenario: executing shell and Python scripts keep their blocks

- **WHEN** the guard checks `bash scripts/release.sh` whose body runs `git push --tags`, and
  `python3 tools/deploy.py` whose body calls `subprocess.run(['git','push'])`
- **THEN** both verdicts are blocked

#### Scenario: inline code keeps the whole-text scan

- **WHEN** the guard checks `node -e "require('child_process').execSync('git pu' + 'sh')"`
- **THEN** the verdict is blocked, as before

### Requirement: The fix ships in the bundled plugin and keeps every deny rule

The policy is bundled into `templates/plugin/factory-plugin.txt`, which `init` renders to
`.opencode/plugins/factory.js`. The committed bundle MUST be regenerated from the changed
sources and MUST carry the cycle reason. The change MUST NOT relax an existing deny rule, with
one documented exception: a literal moved into a variable before it reaches an execution call
(`const c = "git push"; execSync(c)`) was caught by the whole-text scan and is no longer caught,
because the code pass joins only literals written inside the call. Every other hardening probe
that is blocked today MUST stay blocked. `.opencode/plugins/factory.js` and
`factory.lock.json` MUST be regenerated by `loomwright update` after landing, never by this
change.

#### Scenario: the accepted narrowing is explicit

- **WHEN** the guard checks a `.ts` file whose body assigns `"git push"` to a variable and
  passes that variable to `execSync`
- **THEN** the verdict is allowed
- **AND** the suite pins that case so the narrowing stays deliberate

#### Scenario: the committed bundle is current and carries the new reason

- **WHEN** `templates/plugin/factory-plugin.txt` is read and compared with a fresh
  `bundlePlugin()`
- **THEN** both are equal
- **AND** the file contains `expands into itself`

#### Scenario: the hardening probes stay blocked

- **WHEN** the existing hardening suite runs its S11, S12 and S14 probes
- **THEN** every command that is blocked today is still blocked

#### Scenario: the plugin files are regenerated after landing

- **WHEN** the change's diff is inspected
- **THEN** it contains no edit under `.opencode/` or `factory.lock.json`
- **AND** the final report says that `loomwright update` regenerates both

### Requirement: Package-runner aliases are inspected as the command they wrap

`npx` and `pnpx` SHALL be treated as package runners. The guard MUST skip the alias's own flags,
including the flags that take a value (`-p`/`--package`, `-c`/`--call`, `--shell`, `--prefix`,
`--userconfig`, `--registry`, `--cache`, `--node-options`), and MUST inspect the wrapped command
with the same wrapped-command, publish and global-install checks as `bunx`. A wrapped command
that is blocked when run directly MUST be blocked through the alias. When the alias uses
`-c`/`--call`, the call text MUST be inspected as a shell command line.

#### Scenario: a shell through the alias is blocked

- **WHEN** the guard checks `npx sh -c 'git push'`
- **THEN** the verdict is blocked and the reason names `git push`
- **AND** `pnpx sh -c 'git push'` is blocked the same way

#### Scenario: publishing through the alias is blocked

- **WHEN** the guard checks `npx npm publish`, `pnpx npm publish` and
  `npx -p npm@latest npm publish`
- **THEN** every verdict is blocked because publishing is not allowed

#### Scenario: a global install through the alias is blocked

- **WHEN** the guard checks `npx npm install -g left-pad` and
  `pnpx npm install --global left-pad`
- **THEN** every verdict is blocked because global installs change the machine

#### Scenario: the call flag is inspected

- **WHEN** the guard checks `npx -p typescript -c 'npm publish'`
- **THEN** the verdict is blocked because the call text publishes

#### Scenario: ordinary runner use stays allowed

- **WHEN** the guard checks `npx vitest run`, `npx --no-install tsc --noEmit` and
  `npx -p typescript tsc --version`
- **THEN** every verdict is allowed

### Requirement: The alias decision is recorded and shipped

ADR-0049 SHALL record that the aliases are routed through the wrapped-command checks rather than
blocked outright, with the rejected alternative. The committed plugin bundle SHALL be
regenerated and MUST contain the alias handling.

#### Scenario: the ADR exists and is indexed

- **WHEN** `docs/decisions/0049-*.md` and the decisions index are read
- **THEN** the ADR starts `# 0049 — `, has `## Context`, `## Decision` and `## Consequences`,
  and is listed in the index
- **AND** it says the aliases are routed, not blocked

#### Scenario: the committed bundle carries the alias checks

- **WHEN** `templates/plugin/factory-plugin.txt` is compared with a fresh `bundlePlugin()`
- **THEN** they are equal
- **AND** the bundle contains the alias handling
