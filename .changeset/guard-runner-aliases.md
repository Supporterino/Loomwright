---
"@loomwright/cli": minor
---

The shell guard treats `npx` and `pnpx` as package runners: it skips their own flags and inspects the wrapped command with the same wrapped-command, publish and global-install checks `bunx` gets, including `-c`/`--call` text.
