---
"@loomwright/cli": patch
---

The shell guard resolves `bun` builtin subcommands before package scripts, so `bun test`,
`bun run test`, `bun run check` and `bun run build` no longer expand a same-named script into
itself. Cyclic script expansion stops with one reason naming the script, and JS/TS script
files are inspected as code, so prose inside a string no longer blocks a recording while a
literal reaching an execution primitive still does.
