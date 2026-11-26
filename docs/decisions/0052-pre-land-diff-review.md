# 0052 — Reviewing a change's diff before landing

## Context

A finished change could only be landed: nothing showed the patch `land` would merge, so a reviewer
had to open the change branch by hand. In the terminal UI a focused task showed its repo's whole
activity instead of the lines that task itself produced, which made the surrounding reviewer,
explorer and full-suite work look like task work.

## Decision

- `changeDiff(root, config, id)` is read-only. It resolves the touched repos and their land bases
  through the same `git/change-repos.ts` module `land` uses (`reposFor`, `baseBranch`,
  `targetRef`) instead of a second resolution.
- Per repo, including submodules, it diffs `<base>...change/<id>` — three dots, so it compares
  against the merge base and unrelated commits that landed on the base after branching do not
  appear. It reports a per-repo status (`diff`, `empty` or `missing`), per-file added/deleted
  counts and the unified patch.
- `loomwright diff <change-id>` renders that result, with `--stat` for counts instead of the
  patch, `--repo <name>` for one repo and `--json` for the machine-readable `ChangeDiff`.
- A `done` run advertises `review the diff first: loomwright diff <id>` before the unchanged
  `next: loomwright land <id>` line.
- The terminal UI offers `d` on a done run: a full-height read-only pane fed by an injected
  `readDiff` seam, so the view is testable without git.
- Task focus means the task's own lines only. The repo scope (`Tab`) still carries reviewer,
  explorer, install and full-suite work, and the run scope carries everything.

## Consequences

- The diff always matches what `land` would merge, because both read the same repos and bases.
- It is read-only and works in any phase; only `land` needs the `done` phase.
- A missing change branch degrades to one line instead of failing the command.
- A very large change builds the whole patch string in memory; there is no size cap.
- The activity-scope change moves a long-standing contract: a consumer that relied on a focused
  task also carrying its repo's lines must use the repo scope instead.
