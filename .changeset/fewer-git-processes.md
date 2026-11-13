---
"@loomwright/cli": patch
---

Commands spawn fewer git processes. Managed files record their merge base as a git blob written
in-process (one `rev-parse` per sync instead of one `git hash-object` per file), the check-only
gate guard takes one `status --porcelain=v2 --branch` snapshot instead of a `status` plus a
`rev-parse HEAD` on both sides of every gate, and workspace discovery asks `rev-parse` once per
level. `bun run test` now runs test files in parallel (`bun run test:serial` keeps the old single
process; `bun run test:fast` skips the integration-heavy files), and the fixtures build their
workspaces once per process instead of once per test.
