## Context

The request bundles three independent improvements because they share the same review and land
surface. The explorer found the relevant seams already in place:

- OpenSpec's range lives in `packages/core/src/versions.ts::OPENSPEC`; rendering lives in
  `packages/core/src/openspec/cli.ts::renderOpenspecTools`; install paths in
  `packages/core/src/workspace/sync.ts::INSTALL_PATHS`.
- The TUI already has one pure scope module, `packages/tui/src/model/activity-scope.ts`, and the
  narrower behaviour is a change to that module's policy, not a new filter in a view.
- `landChange` already resolves repos and bases (`packages/core/src/pipeline/land.ts`); the diff
  step should reuse that resolution rather than invent a second one.

Upstream facts used below (untrusted, recorded here for the reviewer):
<https://openspec.dev/changelog/>, <https://github.com/Fission-AI/OpenSpec/releases/tag/v2.0.0>,
<https://github.com/Fission-AI/OpenSpec/releases/tag/v2.1.0>,
<https://github.com/Fission-AI/OpenSpec/releases/tag/v2.2.0>.

## Decisions

### D1: one bundled change, three implementation tracks

The three features do not share code or contracts. They are bundled because the requester asked
for one intake and because the pre-land diff is easiest to review together with the TUI activity
work. Tasks are split so each track can run independently; only the final ADR/changeset task
depends on all three.

Rejected: three change ids. That would triple the approval and land overhead for one request.

### D2: support 1.x and 2.x, do not require 2.x

`OPENSPEC` becomes `{ min: "1.10.0", maxExclusive: "3.0.0", tested: "2.2.0" }`. Keeping 1.10 as
the floor is the narrowest reading of "support 2.x and upwards": existing installs keep working,
and 2.x is no longer rejected. Dropping 1.x would be a breaking change the requester did not ask
for, and the repo's hermetic test binary is still 1.14.3.

`renderOpenspecTools` reads the installed version and branches only on the layout details that
actually differ:

- 1.x: current invocation and `.opencode/**` output.
- 2.0: same invocation without `--scope`; output is `.agents/skills/**`.
- 2.1+: add `--scope project` so `init` cannot install globally.

It walks both `<scratch>/.opencode` and `<scratch>/.agents` whenever they exist, so 2.2's router
skill and `references/` are picked up without enumerating them. `--profile core` and
`--no-animation` stay: profiles still exist in 2.2, and the animation flag is harmless.

`tested: 2.2.0` is the recommended install and the lock's upper verification point. Existing
suites keep using the real 1.14.3 binary; a new stub-driven suite proves the 2.x argument list,
`.agents` walk and `.agents` lock paths. Running a real 2.2 `init` in CI is deliberately avoided:
2.1+ uses Vercel's skills installer, which needs Git and GitHub access, and tests must stay
hermetic.

Rejected: requiring 2.x minimum. It would remove support from every existing 1.x workspace and
force a devDependency bump that breaks the hermetic init tests.

### D3: `.agents` is owned by the factory on 2.x

Add `.agents` to `INSTALL_PATHS` so init/update commits and status see it. Protect
`.agents/skills` in `isProtectedPath`, in `PROTECTED_PATHS` for rendered rules, and in
`protectedInWorktree`. The plugin bundle embeds the same path list, so
`templates/plugin/factory-plugin.txt` is regenerated with `bun run build:plugin` rather than edited.
The existing lock carry logic already filters by template, so `.agents/skills/**` entries with
`template: "openspec-tools"` need no special case.

Legacy archiving stays `.opencode`-only. A pre-factory 2.x install already has its OpenSpec
skills in `.agents/skills`; `renderOpenspecTools` returns those paths and `ownEdits` adopts them,
so no move is needed. Custom skills outside the generated set are not archived.

Rejected: protecting all of `.agents`. Custom agent skills may live there; only OpenSpec's
generated `skills/` tree is factory-owned. Rejected: adding `.agents/skills` to
`archiveLegacySetups`, because that function moves everything it does not recognise and would
archive another tool's skills.

### D4: task focus means the task's own lines only

`taskScopeFor` stops adding the task's repo. `scopesOfLine` keeps its mapping otherwise: a task id
belongs to that task, `review:<repo>`/`explore:<repo>` and a repo step belong to the repo, and every
other step belongs to the run. The existing consumers (`taskDetail`, `openActivityPane`,
`scopeLines`) need no structural change; the repo scope remains reachable with `Tab`, and the run
scope remains the whole ring. Switching focus re-derives from the retained lines, so the existing
scrollback is filtered immediately rather than only affecting new events.

Rejected: keeping the union and hiding repo lines in the view. The current spec made the union a
stated contract, and the request is about the scope itself, not one rendering.

### D5: the diff is a read of `change/<id>` against the land base

A new `packages/core/src/git/change-repos.ts` owns `reposFor`, `baseBranch` and the target-ref
resolution; `landChange` and `changeDiff` both import it, so the diff shows exactly the base `land`
would merge into. The diff is three-dot (`<base>...change/<id>`), i.e. against the merge base, so
unrelated base commits do not pollute it. It is read-only and has no phase precondition: a change in
`implementing` can be reviewed too, while the hint only advertises it at `done`. A missing change
branch is a normal `missing` row; a missing base is a precondition error, matching `land`.

`--stat` uses `git diff --numstat`; the default uses `git diff --no-ext-diff --no-color
--unified=3`. Submodule content is diffed in each submodule; the AI repo's patch carries the
gitlink. No `openspec/` exclusion: the change's specs are part of what a reviewer wants to see
(unlike the Ponytail benchmark's numstat).

Rejected: diffing against `main` literally. A repo may have a tracked or configured base; using
`main` would show changes the merge would not make.

### D6: CLI shape and hint

`loomwright diff <change-id> [--stat] [--repo <name>] [--json]`. The command is registered in
`COMMANDS`, so completion and `--help` follow automatically. The post-run hint keeps its existing
`next: \`loomwright land <id>\`` line byte-for-byte and adds a preceding
`review the diff first: \`loomwright diff <id>\`` line, so existing pipeline assertions keep their
meaning while the optional step is advertised.

Rejected: folding the diff into `land --dry-run`. Dry-run reports merges, not file content, and the
requester asked for a separate optional step.

### D7: TUI diff is an injected read and a scoped pane

The TUI entry gets an optional `readDiff(id)` seam, defaulting to `changeDiff(workspace,
loadConfig(workspace).config, id)`. This keeps `Factory` (run-state reads) unchanged and lets tests
inject a result without a git fixture. That default is the one deliberate exception to the TUI's
read boundary: `entry.tsx` value-imports the read-only `changeDiff`, which performs only git reads
but resolves the touched repos from the selected run's `.factory/runs/<id>.json`. The modified
read-only requirement carves out exactly that call, the no-engine scan allows exactly that import,
and no other pipeline, gate, lock or state module or `.factory/` read is allowed. `d` maps to an
`open-diff` intent; the entry checks `canLand(phase)` before reading, shows a notice while the read
is in flight, and opens
`UiData.diff` only if the run is still selected. `controls/diff-pane.ts` is a pure state machine and
panel builder using the existing viewport helpers. The footer puts `d diff` before `l land`, and
`help.ts` documents it. Replay does not read a diff; `d` joins the replay read-only keys so the
press is explained consistently.

Rejected: a detached child or a pager. The diff is a short-lived read, and a child would lose the
TUI's panel, scroll and error handling. Rejected: resolving the patch in the TUI from the run it
already holds. That would re-implement `reposFor`/base resolution and read the workspace config in
the TUI; the read seam keeps one implementation and one git path shared with `land`.

## Contract changes

None configured. No API schema, event type, or Helm value changes. The only serialized surface that
changes is `factory.lock.json`'s `tools.openspec` (wider range), driven from the version constant.

## Risks

- 2.x is proven with stubs, not a real 2.2 binary in CI. Upstream flag drift (`--scope`,
  `--profile`, `--no-animation`) would be caught only by a manual run.
- 2.1+ `init` installs skills through Vercel's installer and may need Git/GitHub access; the
  factory does not add a network path, but an offline user can now see that failure during init.
- A very large change produces a large patch string. The CLI streams it only after building it, and
  the TUI keeps it in memory for the pane; both are bounded by the change's size, not by a cap.
- The TUI diff read is async. A selection change or an Esc before it resolves must not open a stale
  pane; the implementation guards on the run id and a per-read token.
- `.agents` joins `INSTALL_PATHS` as a parent path, so an install commit stages anything else under
  `.agents` the same way `.opencode` already behaves. A 2.x workspace should let the factory own
  generated skills; unrelated skills there would be swept into the install commit.
- The activity-scope change touches a long-standing contract and its golden tests. Any consumer that
  relied on the union must now use the repo scope.
- The no-engine scan now permits exactly one pipeline import (`changeDiff` in `entry.tsx`) and the
  run-state read it performs. `packages/tui/test/view-model.test.ts` enforces that boundary, but task
  1.7's approved `touches` list does not name that file; the existing edit is in place, and any
  re-run must keep the exception to that one import and that one read.
- The intake questions about splitting the change, the 1.x floor, the diff trigger/base and the
  focus semantics are still unanswered; D1, D2, D5 and D4 record the narrowest readings used here.
