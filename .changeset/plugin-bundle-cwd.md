---
"@loomwright/cli": patch
---

The plugin bundle build pins its root to the repository root and normalises module labels, so
`bun run build:plugin` produces the committed bundle from any working directory.
