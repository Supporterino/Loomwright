## Why

Loomwright rejects every OpenSpec 2.x install because the tool pin still ends at `< 2.0.0`, even though OpenSpec 2.0, 2.1 and 2.2 keep the same change/validate/archive workflow and only move generated agent files to `.agents/skills/`. The TUI also shows a focused task's whole repo — reviewer, explorer, install and full-suite lines — instead of just that task's activity, which makes the detail pane noisy. Finally, a finished change can only be landed; there is no way to inspect the patch it would merge until after the merge has happened.

## What Changes

- Widen the supported OpenSpec range to `1.10.0` through `< 3.0.0`, recommend `2.2.0`, and render generated tools from both the 1.x `.opencode/**` layout and the 2.x `.agents/skills/**` layout. Pass `--scope project` on 2.1+ so `init` never installs skills globally.
- Treat `.agents` as an install path, manage `.agents/skills/**` with the existing `openspec-tools` template, and protect those generated skills from agent edits.
- Narrow the TUI's task activity scope to the focused task's own lines. The repo scope (Tab in the activity pane) still carries reviewer, explorer, install and full-suite lines, and the run scope still carries everything.
- Add a read-only change diff computed against the same base branch `land` would merge into, including submodule repos.
- Add `loomwright diff <change-id>` with a unified patch by default and `--stat`, `--repo <name>` and `--json` variants.
- Offer the same diff in the TUI with `d` on a `done` run, in a full-height scrollable pane.
- Name the diff in the post-run next-step hint before `land`.

## Capabilities

### New Capabilities

- `openspec-compatibility`: the supported OpenSpec versions, the 1.x/2.x generated-file layouts, managed and protected `.agents/skills`, and the unchanged command-wrapper contracts.
- `change-diff-review`: reading a change's patch against its land base, the `diff` command, and the pre-land hint.

### Modified Capabilities

- `factory-tui`: a focused task shows only its own activity, and a done run offers a read-only pre-land diff pane.

## Impact

- **Repos:** `loomwright` only.
- **Packages:** `packages/core` (version pin, OpenSpec rendering, workspace sync, policy, a new diff reader, next-step hints), `packages/cli` (new `diff` command, command table, docs), `packages/tui` (activity scope, diff pane, keys, help, footer).
- **APIs:** a new `loomwright diff` command and a new optional `readDiff` seam in the TUI entry. No external API or event contract changes.
- **Data:** `factory.lock.json` records the wider OpenSpec range; 2.x installs commit a new `.agents/` tree. No migration, no push, and no change to existing branch or run-state formats.
- **Docs/process:** two ADRs (`0051`, `0052`), their README rows, a changeset, and `docs/cli.md`.
