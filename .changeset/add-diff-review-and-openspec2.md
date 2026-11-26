---
"@loomwright/core": minor
"@loomwright/cli": minor
---

OpenSpec 1.x and 2.x are both supported now: the accepted range is `>= 1.10.0, < 3.0.0` with
2.2.0 as the tested and recommended version, 2.1+ `init` runs with `--scope project` so it cannot
install globally, and the generated skills are read from both `.opencode` and `.agents`. The
`.agents` tree is managed by install and update, and `.agents/skills` is protected from agent
edits in the path rules, the rendered rules and the worktree sandbox.

`loomwright diff <change-id>` shows the patch `land` would merge, per touched repo and submodule,
read against the same merge base. It is read-only, works in any phase, and takes `--stat`,
`--repo <name>` and `--json`; a done run now prints the diff hint before the land hint. The
terminal UI opens the same view with `d` on a done run as a full-height read-only pane, and a
focused task's activity scope is now its own lines only — the repo scope still shows reviewer,
explorer, install and full-suite work.
