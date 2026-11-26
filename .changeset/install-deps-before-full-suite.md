---
"@loomwright/core": patch
"@loomwright/cli": patch
---

The full-suite phase now installs the repo's dependencies in the checkout it is about to gate,
once per repo on every pass, through the same installer and shared caches the task worktrees
use. A task that merged a `package.json` or lockfile change no longer leaves the checkout with
stale `node_modules`, so the suite no longer fails on code that is fine and no longer burns its
two fix rounds on it. An install failure is treated as infrastructure: that repo's gates do not
run, no suite-fix task and no suite round are spent, and the change pauses with the repo and the
installer detail in the reason.

A pause in the full-suite phase now writes `.factory/reports/<id>-paused.md` and names it in the
stop detail. The report adds a `## Full suite: <repo>` section with the captured failing output
of every repo whose last result failed, and it no longer offers `loomwright retry <id> --task`
when no task failed.

`loomwright gate` is unchanged: it never installs dependencies.
