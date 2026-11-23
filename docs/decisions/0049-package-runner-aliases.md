# 0049 — package-runner aliases

## Context

The shell guard treats `npm`, `pnpm`, `yarn`, `bun` and `bunx` as package managers: it checks
`global` installs and `publish`/`login`/`adduser`/`unpublish`/`deprecate`, and `bunx` (Bun's
alias for `bun x`) is routed to whatever it wraps. `npx` and `pnpx` were in neither
`PACKAGE_MANAGERS` nor `INTERPRETERS`, so the guard stopped at the alias word and
`npx sh -c 'git push'`, `npx npm publish` and `npx npm install -g left-pad` all passed.

## Decision

`npx` and `pnpx` join `PACKAGE_MANAGERS` and are _routed, not blocked_: the guard skips the
alias's own flags (including the value-taking `-p`/`--package`, `--shell`, `--prefix`,
`--userconfig`, `--registry`, `--cache` and `--node-options`) and inspects the remaining words
as the wrapped command, with the same wrapped-command, publish and global-install checks
`bun x` gets. `-c`/`--call`, in both the `-c <text>` and `--call=<text>` forms, is a shell
command line and goes through `checkScript`. Ordinary use such as `npx vitest run` stays
allowed, and an alias never expands a project script of the same name.

Alternatives rejected:
- **Blocking `npx` and `pnpx` outright.** It breaks ordinary use such as `npx vitest run`,
  `npx --no-install tsc --noEmit` and `npx -p typescript tsc --version`.
- **Treating them as `bun x`.** Their flag sets differ, and a flag value such as the package
  name in `npx -p typescript tsc` would be read as the wrapped command.

Upgrade trigger: a runner flag that takes a value but is not in the list above needs adding to
`NPX_VALUE_FLAGS`; otherwise its value is read as the wrapped command.

## Consequences

- A command blocked when run directly is also blocked through `npx`/`pnpx`, including a shell
  whose `-c` text names `git push`, a publish, and a global install.
- The guard still allows the common runner use cases, so agents keep using `npx` where that is
  the project's habit.
- `templates/plugin/factory-plugin.txt` must be regenerated with `bun run build:plugin` whenever
  `packages/core/src/policy/` changes; the committed bundle is what agents run.
