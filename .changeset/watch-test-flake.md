---
"@loomwright/cli": patch
---

The `status --watch` suite waits for observed frames instead of an 80 ms window, so it is green
under `--parallel`.
