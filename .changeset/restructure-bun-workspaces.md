---
"@loomwright/cli": patch
---

Move the engine and the command layer into Bun workspace packages. The published tarball,
the CLI entry, both binaries and the workspace file formats are unchanged. A command that
hits its deadline now settles `exec` itself, instead of waiting for a child exit notification
that a wedged `bun test` worker can lose.
