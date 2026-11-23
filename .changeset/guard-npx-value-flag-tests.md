---
"@loomwright/cli": patch
---

The shell-policy tests now name every security-critical `npx` value-taking flag (`--shell`, `--prefix`, `--userconfig`, `--registry`, `--cache`, `--node-options`, `--package`), so dropping or misspelling one in the table fails a test instead of reopening the publish/global-install bypass.
