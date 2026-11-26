# change-diff-review Specification

## Purpose
TBD - created by archiving change add-diff-review-and-openspec2. Update Purpose after archive.

## Requirements

### Requirement: The change diff is read from each repo's land base

`changeDiff(root, config, id)` SHALL be read-only: it MUST NOT merge, fetch, switch branches, write run state or append an event. It SHALL resolve the touched repos and base branches exactly as `landChange` does — every repo named by a task or by `run.branches`, plus the AI repo, using a submodule's tracked branch and otherwise `defaultBranch` or `main`. For each repo it SHALL diff `change/<id>` against the merge base with that base branch (a three-dot diff) and report the base name, the change branch, a status of `diff`, `empty` or `missing`, the per-file added and deleted counts, and the unified patch. A change with no run SHALL raise a precondition error; a repo with no `change/<id>` branch SHALL report `missing` with no patch.

#### Scenario: a single repo reports its committed change

- **WHEN** a done change has one commit on `change/add-health` that adds `src/health.ts` and `main` has not moved
- **THEN** the result has one repo with status `diff`
- **AND** its patch contains `+++ b/src/health.ts`
- **AND** its file row counts the added lines
- **AND** the checkout's current branch and refs are unchanged

#### Scenario: a change branch with no commits is empty

- **WHEN** `change/add-health` points at the same commit as its base
- **THEN** the repo status is `empty`
- **AND** the patch is the empty string

#### Scenario: a missing change branch is reported, not thrown

- **WHEN** no local `change/add-health` branch exists in a touched repo
- **THEN** the repo status is `missing`
- **AND** the patch is the empty string
- **AND** the other repos are still read

#### Scenario: an unknown change is a precondition error

- **WHEN** `changeDiff` is called for an id with no run state
- **THEN** it rejects with a precondition error naming the id

#### Scenario: a submodule layout diffs every touched repo

- **WHEN** a change touched `repos/backend` and `repos/frontend` and the AI repo
- **THEN** each submodule has its own repo result and patch
- **AND** the AI repo's patch includes the submodule gitlink path
- **AND** nothing is merged or fetched

#### Scenario: the diff uses the merge base, not the base tip

- **WHEN** the base branch gained an unrelated commit after the change branched
- **THEN** that commit does not appear in the patch
- **AND** the patch contains only the change branch's own changes

### Requirement: The diff command shows a patch or a stat

`loomwright diff <change-id>` SHALL print a per-repo header and the unified patch for each touched repo. `--stat` SHALL print the per-file added and deleted counts instead of the patch, `--json` SHALL print the `ChangeDiff` result, and `--repo <name>` SHALL restrict the output to one configured repo. An unknown repo name SHALL be a usage error, an unknown change id SHALL be a precondition error, and a missing change branch SHALL print a `no change branch` line and still exit 0. The command MUST NOT write, merge, fetch or push.

#### Scenario: the default prints a patch

- **WHEN** `loomwright diff add-health` runs for a change that adds `src/health.ts`
- **THEN** the output names the repo, its base and `change/add-health`
- **AND** it contains the unified patch for `src/health.ts`
- **AND** the exit code is 0

#### Scenario: --stat prints counts

- **WHEN** `loomwright diff add-health --stat` runs for that change
- **THEN** the output lists `src/health.ts` with its added and deleted counts
- **AND** it does not print the unified patch body

#### Scenario: --repo restricts the output

- **WHEN** `loomwright diff add-health --repo backend` runs in a submodule workspace
- **THEN** only the `backend` repo's header and diff are printed
- **AND** `frontend` is absent

#### Scenario: --json prints the result

- **WHEN** `loomwright diff add-health --json` runs
- **THEN** the output parses as JSON with the change id and the repo rows
- **AND** each row carries `repo`, `target`, `branch`, `status`, `files` and `patch`

#### Scenario: an unknown repo is a usage error

- **WHEN** `loomwright diff add-health --repo nope` runs
- **THEN** the command exits with the usage code
- **AND** it names the configured repo choices

#### Scenario: an unknown change is a precondition error

- **WHEN** `loomwright diff no-such-change` runs
- **THEN** the command exits with the precondition code
- **AND** it says no change exists

#### Scenario: a missing branch does not fail the command

- **WHEN** one repo has no `change/add-health` branch
- **THEN** the output says that repo has no change branch
- **AND** the command still exits 0

### Requirement: A done change advertises the diff before land

After a run reaches `done`, the CLI's next-step output SHALL name `loomwright diff <id>` before `loomwright land <id>`, and `land` SHALL remain the stated next action. The hint MUST NOT appear while the run is in any other phase.

#### Scenario: the done hint names the diff first

- **WHEN** `approve` or `resume` finishes a change at `done`
- **THEN** the output contains a `loomwright diff <id>` line
- **AND** it contains `next: \`loomwright land <id>\``
- **AND** the diff line appears first

#### Scenario: a running change has no diff hint

- **WHEN** a run stops at `implementing`, `paused` or `awaiting-approval`
- **THEN** the output does not name `loomwright diff`
