# 0053 — Installing dependencies before the full suite

## Context

The full-suite phase gates `p.repoDir(repo)`: the workspace root in the single layout, the merged
submodule checkout otherwise. Only task worktrees installed, so a lockfile change merged by the
tasks left the gated checkout's `node_modules` stale. The failing suite then created a
`suite-<repo>-<n>` task; its worktree installed fresh, the agent saw green and refused to write
outside its worktree, and the change paused after `MAX_SUITE_ROUNDS = 2` with nothing fixable.
A full-suite pause also wrote no report, because only the implementing phase called
`writePauseReport`.

## Decision

1. Each repo's full-suite pass installs in `p.repoDir(repo)` before `runGates`, once per repo on
   every pass, through the same installer the task worktrees use: shared `.factory/cache/` stores,
   a credential-scrubbed environment and frozen-lockfile commands. A repo with no matching
   lockfile is skipped for that directory and still gated.
2. A new `packages/core/src/pipeline/install.ts` exports `installFor(p, step, repo, dir)` and emits
   the `install.*` events; `PipelineDeps.install` is the test seam shared with the task path.
3. An install failure is infrastructure, not a suite failure: that repo's gates do not run, no
   suite-fix task is added, no suite round is spent, no `run.fullSuite` result is recorded, and the
   change pauses with a reason naming the repo and the installer detail. This mirrors the rule that
   install time and failures never count against a retry budget.
4. A full-suite pause writes `.factory/reports/<id>-paused.md`, and the stop detail names that
   file. `writePauseReport`'s scheduler summary became optional and is derived from run state when
   absent; the report reads `run.fullSuite` and adds a `## Full suite: <repo>` section per failure.
5. `loomwright gate --full` is unchanged: it gates a checkout the user controls and stays read-only
   with respect to dependency state. Only the pipeline installs, in its own checkouts.

Rejected: installing inside `runGates` (it also serves `loomwright gate --full`, contract gates and
land, and a diagnostic command must not rewrite `node_modules`); installing once per change (a
suite-fix round can merge another lockfile change); tracking a changed lockfile to skip installs
(new state a crash can leave wrong, while installs are idempotent and cached).

## Consequences

- The user's checkout gets one install per full-suite pass. It can create ignored files (`charts/`,
  `.venv`) and the first install is a real cost, though the shared caches keep repeats cheap.
- A registry outage pauses at the full-suite phase with a resume hint and no automatic retry.
- The report renders the last recorded result, so a crash between the gate run and `run.update`
  leaves the section stale or missing; the reason line still names the phase's failure.
- ADR-0024 and an older `ARCHITECTURE.md` sentence described worktree-only installs. Historical ADR
  text stays untouched per the monorepo-layout spec; 0053 supersedes that part and
  `ARCHITECTURE.md` is updated.
