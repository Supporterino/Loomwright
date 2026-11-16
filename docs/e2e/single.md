# E2E: single repo

Recorded 2026-11-16 with `bun scripts/e2e-transcript.ts single` (Loomwright 1.0.0).

**Real:**
- the opencode server: opencode v2.2.7 with the factory's agents, permissions and guard plugin;
- git; OpenSpec 1.14.3; graphify 0.9.93;
- the gate toolchains named in the config below.

**Scripted:** the model. `test/fixtures/stub-team.ts` answers opencode's Messages API calls per role. It writes files with opencode's `write` tool, tries a forbidden `git push` to show the guard, and ends each session with a handoff. Token counts in `status` come from the stub's fixed usage numbers.

Temp paths are shown as `<tmp>`.

The workspace is a single TypeScript repo (`app`: `src/sum.ts` and a `bun test`). The change adds two helpers in parallel tasks, then a third task that depends on both.

## Install

```console
$ loomwright init
loomwright 1.0.0 in /private<tmp>/app
tools: git 2.56.0, opencode 2.2.7, openspec 1.14.3, graphify 0.9.93
wrote factory.config.jsonc (review "models" and "contracts")
created: .gitignore
created: .graphifyignore
created: .opencode/addons/ponytail/.opencode/command/ponytail-review.md
created: .opencode/addons/ponytail/AGENTS.md
created: .opencode/addons/ponytail/LICENSE
created: .opencode/addons/ponytail/PRECEDENCE.md
created: .opencode/addons/ponytail/skills/ponytail-review/SKILL.md
created: .opencode/addons/ponytail/skills/ponytail/SKILL.md
created: .opencode/agents/architect.md
created: .opencode/agents/contract-reviewer.md
created: .opencode/agents/explorer.md
created: .opencode/agents/implementer-app.md
created: .opencode/agents/orchestrator.md
created: .opencode/agents/reviewer.md
created: .opencode/agents/tester.md
created: .opencode/commands/opsx-apply.md
created: .opencode/commands/opsx-archive.md
created: .opencode/commands/opsx-explore.md
created: .opencode/commands/opsx-propose.md
created: .opencode/commands/opsx-sync.md
created: .opencode/commands/opsx-update.md
created: .opencode/opencode.jsonc
created: .opencode/plugins/factory.js
created: .opencode/schemas/factory.config.schema.json
created: .opencode/schemas/handoff.schema.json
created: .opencode/skills/openspec-apply-change/SKILL.md
created: .opencode/skills/openspec-archive-change/SKILL.md
created: .opencode/skills/openspec-explore/SKILL.md
created: .opencode/skills/openspec-propose/SKILL.md
created: .opencode/skills/openspec-sync-specs/SKILL.md
created: .opencode/skills/openspec-update-change/SKILL.md
created: .opencode/standards/go.md
created: .opencode/standards/helm.md
created: .opencode/standards/python.md
created: .opencode/standards/react.md
created: .opencode/standards/rust.md
created: .opencode/standards/swift.md
created: .opencode/standards/tauri.md
created: .opencode/standards/typescript.md
created: AGENTS.md
created: openspec/config.yaml
hook app: installed
graph: built (749 nodes, 1.4s)
committed 0b551b4974b3 chore(factory): init v1.0.0
# exit 0 · 1.9s
```

Config edits for the run: every role uses the stub model. The fixture has no installed formatter, linter or `tsc`, so those gates are `skip`; tests run for real with `bun test` (the repo's `test` script for the full suite, the test files related to each task's changes per task).

```console
$ git diff HEAD~1 -- factory.config.jsonc
diff --git a/factory.config.jsonc b/factory.config.jsonc
index 15e7057..1a4c874 100644
--- a/factory.config.jsonc
+++ b/factory.config.jsonc
@@ -13,12 +13,12 @@
   // opencode model ids ("provider/model") per role. contractReviewer defaults to reviewer.
   // "roles", "repos" and "agents" can override these; the flat entries stay the fallback.
   "models": {
-    "orchestrator": "anthropic/claude-sonnet-5-5",
-    "architect": "anthropic/claude-opus-5-5",
-    "reviewer": "anthropic/claude-opus-5-5",
-    "implementer": "anthropic/claude-sonnet-5-5",
-    "tester": "anthropic/claude-sonnet-5-5",
-    "explorer": "anthropic/claude-haiku-5-5"
+    "orchestrator": "stub/claude-stub",
+    "architect": "stub/claude-stub",
+    "reviewer": "stub/claude-stub",
+    "implementer": "stub/claude-stub",
+    "tester": "stub/claude-stub",
+    "explorer": "stub/claude-stub"
   },
 
   // Project bars injected into every session. Add docs/security.md, docs/go.md, etc.
@@ -36,7 +36,14 @@
     // Gate type -> script/target name looked up in package.json, Makefile, justfile, Taskfile.
     "scripts": { "format": "format:check", "lint": "lint", "types": "typecheck", "test": "test", "testAffected": "test:affected" },
     // Repo name -> gate type -> literal command; wins over scripts and profile defaults.
-    "overrides": {},
+    "overrides": {
+      "app": {
+        "format": "skip",
+        "lint": "skip",
+        "types": "skip",
+        "testAffected": "bun test {testFiles}"
+      }
+    },
     // Detected stack gates: iOS compile and generated-artifact drift. Edit or remove freely.
     "extra": []
   },
```

Changed models re-render the agents, so `update` brings the managed files in line with the config:

```console
$ loomwright update
update 1.0.0 → 1.0.0
config migrations: none
  update: .opencode/agents/architect.md
  update: .opencode/agents/contract-reviewer.md
  update: .opencode/agents/explorer.md
  update: .opencode/agents/implementer-app.md
  update: .opencode/agents/orchestrator.md
  update: .opencode/agents/reviewer.md
  update: .opencode/agents/tester.md
committed 7bf8159743c4 chore(factory): update to v1.0.0
backup: /private<tmp>/app/.factory/backups/2026-11-16T12-21-58-853Z
# exit 0 · 0.3s
```

```console
$ loomwright graph
graph updated: 749 nodes, 983 links in 0.9s
# exit 0 · 1.0s
```

```console
$ loomwright doctor
tools
  ✓ git: 2.56.0 (lock >= 2.31.0, tested 2.54.0)
  ✓ opencode: 2.2.7 (lock >= 2.1.2 < 2.3.0, tested 2.2.0)
  ✓ openspec: 1.14.3 (lock >= 1.10.0 < 2.0.0, tested 1.14.3)
  ✓ graphify: 0.9.93 (lock >= 0.9.93 < 0.10.0, tested 0.9.93)
  ✓ factory: 1.0.0
install
  ✓ config: schemaVersion 4, layout single
security
  ✓ sandbox: agent shells and gates run under macOS sandbox-exec
environment
  ✓ graphify env: no auto-refresh, no LLM backend
install
  ✓ managed files: 29 up to date
repos
  ✓ AI repo working tree: clean
  ✓ AI repo pre-push hook: installed
gates
  ✓ app: 1 gate command(s) resolved, toolchain present
context
  ✓ instructions: 0 path(s) injected into sessions
release
  ✓ release: no release tooling detected
artifacts
  ✓ records: local (reports, approvals and usage stay in .factory/)
caches
  ✓ dependency caches: 0 B
  ✓ backups: 115 KiB
credentials
  ! stored: could not read opencode's stored credentials; environment variables still work
      → check `opencode auth export`, or export the provider key
models
  ✓ orchestrator: stub/claude-stub
  ✓ architect: stub/claude-stub
  ✓ reviewer: stub/claude-stub
  ✓ implementer: stub/claude-stub
  ✓ tester: stub/claude-stub
  ✓ explorer: stub/claude-stub
graph
  ✓ graph: 0 min old, no code changes since it was built (749 nodes)
changes
  ✓ active: none
gate table (full mode; per task, scoped commands and affected tests are used)
  app test    npm run --silent test  (script)
  app format  skip: gates.overrides.app.format
  app lint    skip: gates.overrides.app.lint
  app types   skip: gates.overrides.app.types
0 problem(s), 1 warning(s)
# exit 0 · 15.9s
```

## Run up to the spec

```console
$ loomwright run Add a greet(name) helper and a clamp(n, min, max) helper, exported from src/index.ts
▶ intake
  ▶ [intake] orchestrator (stub/claude-stub)
  ✓ [intake] session done in 15.4s · 2.5k tok
  change add-text-helpers
▶ explore: app
  ▶ [explore:app] explorer (stub/claude-stub)
  ✓ [explore:app] session done in 80ms · 2.5k tok
▶ design: openspec/changes/add-text-helpers
  ▶ [design] architect (stub/claude-stub)
  ✓ [design] session done in 618ms · 12.4k tok
add-text-helpers: awaiting approval — review openspec/changes/add-text-helpers/ then run `loomwright approve add-text-helpers`
# exit 0 · 16.5s
```

```console
$ loomwright status add-text-helpers
change add-text-helpers — awaiting-approval (not active; factory 1.0.0)
  branches: . change/add-text-helpers @7bf8159743c4
  usage: 17.3k tokens (1.4k cache read, 294 out) · cost n/a in 3 sessions
    by agent: architect 12.4k, orchestrator 2.5k, explorer 2.5k
    retry overhead: 0 · wasted re-reads: 0
# exit 0 · 0.0s
```

`openspec/changes/add-text-helpers/tasks.md`:

```markdown
## 1. app

- [ ] 1.1 Add the greet helper
  - repo: app
  - deps: none
  - touches: src/greet.ts
- [ ] 1.2 Add the clamp helper
  - repo: app
  - deps: none
  - touches: src/clamp.ts
- [ ] 1.3 Export the helpers from src/index.ts
  - repo: app
  - deps: 1.1, 1.2
  - touches: src/index.ts
```

## Approve: the rest runs on its own

```console
$ loomwright approve add-text-helpers
✓ approved add-text-helpers by fixture@example.com (spec 0c0e8588857d, 3 tasks)
▶ context packs (3)
  ▶ [context-packs] architect (stub/claude-stub)
  ✓ [context-packs] session done in 15.5s · 9.9k tok
▶ implement: 3 tasks (max 4 agents)
  ⚙ [1.1] installing dependencies in app
  ⚙ [1.2] installing dependencies in app
  ▶ [1.1] Add the greet helper · implementer-app (stub/claude-stub) · attempt 1/4
  ▶ [1.2] Add the clamp helper · implementer-app (stub/claude-stub) · attempt 1/4
  ✗ [1.1] shell failed: Loomwright blocked this call: git push is not allowed: the factory never pushes
  ✗ [1.1] shell failed: Loomwright blocked this call: git push is not allowed: the factory never pushes
  ✓ [1.2] session done in 564ms · 5.0k tok
  ✓ [1.1] session done in 660ms · 9.9k tok
  ✓ [1.2] gates passed in 25ms
  ⇢ [1.2] merging into change/add-text-helpers
  ✓ [1.1] gates passed in 19ms
  ✓ [1.2] gates after rebase passed in 24ms
  ⇢ [1.1] merging into change/add-text-helpers
  ✓ 1.2 merged (app)
  … waiting: 1.3 (waiting on 1.1)
  ✓ [1.1] gates after rebase passed in 19ms
  ✓ 1.1 merged (app)
  ⚙ [1.3] installing dependencies in app
  ▶ [1.3] Export the helpers from src/index.ts · implementer-app (stub/claude-stub) · attempt 1/4
  ✓ [1.3] session done in 461ms · 5.0k tok
  ✓ [1.3] gates passed in 21ms
  ⇢ [1.3] merging into change/add-text-helpers
  ✓ [1.3] gates after rebase passed in 19ms
  ✓ 1.3 merged (app)
implement: 3/3 merged in 5.2s
▶ review + tests: app
  ▶ [review:app] reviewer (stub/claude-stub)
  ✓ [review:app] session done in 107ms · 2.5k tok
▶ implement: 1 task (max 4 agents)
  ⚙ [test-app] installing dependencies in app
  ▶ [test-app] Ensure every scenario of app has a test · tester (stub/claude-stub) · attempt 1/4
  ✓ [test-app] session done in 540ms · 7.4k tok
  ⚙ [test-app] gates: testAffected
  ✓ [test-app] gates passed in 72ms
  ⇢ [test-app] merging into change/add-text-helpers
  ⚙ [test-app] gates after rebase: testAffected
  ✓ [test-app] gates after rebase passed in 66ms
  ✓ test-app merged (app)
implement: 4/4 merged in 2.2s
▶ contracts: none touched
▶ full suite: app
  ⚙ [app] gates: test
  ✓ [app] gates passed in 173ms
▶ close
  ⚙ archiving the spec
✓ add-text-helpers done — report: /private<tmp>/app/.factory/reports/add-text-helpers.md
add-text-helpers: done
next: `loomwright land add-text-helpers` merges the finished change into its base branches
# exit 0 · 23.9s
```

```console
$ loomwright status add-text-helpers
change add-text-helpers — done (not active; factory 1.0.0)
  branches: . change/add-text-helpers @7bf8159743c4 · app change/add-text-helpers @7bf8159743c4
  review round: 1
  graph: covers 4 of 4 merges
  tasks: 4/4 merged (merge seq 4)
    ✓ 1.1      app Add the greet helper — merged 5a2ab21b94a3 · 9.9k tok
    ✓ 1.2      app Add the clamp helper — merged 0d7ead2e89c5 · 5.0k tok
    ✓ 1.3      app Export the helpers from src/index.ts — merged 7aaa98c15bcc · 5.0k tok
    ✓ test-app app Ensure every scenario of app has a test — merged 4f6d7c87f9bf · 7.4k tok
  full suite: app ✓
  usage: 56.9k tokens (4.6k cache read, 966 out) · cost n/a in 9 sessions
    by agent: architect 22.3k, implementer-app 19.8k, tester 7.4k, orchestrator 2.5k, explorer 2.5k, reviewer 2.5k
    retry overhead: 0 · wasted re-reads: 0
# exit 0 · 0.0s
```

## Result

```console
$ git log --format='%h %s' main..change/add-text-helpers
0b022d7 chore(spec): archive add-text-helpers
4f6d7c8 test: ensure every scenario of app has a test
7aaa98c feat: export the helpers from src/index.ts
5a2ab21 feat: add the greet helper
0d7ead2 feat: add the clamp helper
0c0e858 docs(spec): add-text-helpers
```

```console
$ git branch --list '*change*'
* change/add-text-helpers
```

```console
$ git worktree list
/private<tmp>/app 0b022d7 [change/add-text-helpers]
```

### Gate runs

Each task's gates, as logged (per task in its worktree, then again after the rebase in the merge queue; `full:<repo>` is the full suite at the end):

```text
1.2            format skipped · lint skipped · types skipped · testAffected skipped
1.1            format skipped · lint skipped · types skipped · testAffected skipped
1.2            format skipped · lint skipped · types skipped · testAffected skipped
1.1            format skipped · lint skipped · types skipped · testAffected skipped
1.3            format skipped · lint skipped · types skipped · testAffected skipped
1.3            format skipped · lint skipped · types skipped · testAffected skipped
test-app       format skipped · lint skipped · types skipped · testAffected pass (bun test src/clamp.test.ts src/greet.test.ts)
test-app       format skipped · lint skipped · types skipped · testAffected pass (bun test src/clamp.test.ts src/greet.test.ts)
full:app       format skipped · lint skipped · types skipped · test pass (npm run --silent test)
```

### Guard log

Every tool call the agents made is logged (redacted). These are the calls the plugin blocked:

```json
{"at":"2026-11-16T12:22:48.571Z","kind":"blocked","session":"ses_e1bb0a499ffemcxq3WJMbnTgjL","agent":"implementer-app","tool":"shell","input":{"command":"git push origin HEAD"},"reason":"Loomwright blocked this call: git push is not allowed: the factory never pushes"}
{"at":"2026-11-16T12:22:48.616Z","kind":"blocked","session":"ses_e1bb0a499ffemcxq3WJMbnTgjL","agent":"implementer-app","tool":"shell","input":{"command":"sh -c 'git push --force origin main'"},"reason":"Loomwright blocked this call: git push is not allowed: the factory never pushes"}
```

### Final report

```markdown
# add-text-helpers: done

Add greet and clamp helpers, exported from the package entry point

## Branches (local only; nothing was pushed)

- app: `change/add-text-helpers` at 0b022d7dc8a8 (6 commits)
- AI repo: `change/add-text-helpers` (archive commit 0b022d7dc8a8)

## Tasks

- [x] 1.1 (app, task): Add the greet helper
- [x] 1.2 (app, task): Add the clamp helper
- [x] 1.3 (app, task): Export the helpers from src/index.ts
- [x] test-app (app, test): Ensure every scenario of app has a test

## Spec

Archived as `openspec/changes/archive/2026-11-16-add-text-helpers`.

## Review findings

- review:app: [nice] src/clamp.ts:1 With min > max the result is always max, which hides a caller bug.

## Usage

Total: 56.9k tokens (4.6k cache read, 966 out) · cost n/a over 9 sessions.

| Agent           | Tokens | Share | Cost     |
| --------------- | ------ | ----- | -------- |
| architect       | 22.3k  | 39%   | cost n/a |
| implementer-app | 19.8k  | 35%   | cost n/a |
| tester          | 7.4k   | 13%   | cost n/a |
| orchestrator    | 2.5k   | 4%    | cost n/a |
| explorer        | 2.5k   | 4%    | cost n/a |
| reviewer        | 2.5k   | 4%    | cost n/a |

| Task or step  | Tokens | Share | Cost     |
| ------------- | ------ | ----- | -------- |
| design        | 12.4k  | 22%   | cost n/a |
| context-packs | 9.9k   | 17%   | cost n/a |
| 1.1           | 9.9k   | 17%   | cost n/a |
| test-app      | 7.4k   | 13%   | cost n/a |
| 1.2           | 5.0k   | 9%    | cost n/a |
| 1.3           | 5.0k   | 9%    | cost n/a |
| intake        | 2.5k   | 4%    | cost n/a |
| explore:app   | 2.5k   | 4%    | cost n/a |
| review:app    | 2.5k   | 4%    | cost n/a |

Top consumers: design (12.4k), context-packs (9.9k), 1.1 (9.9k), test-app (7.4k), 1.2 (5.0k).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 0.
```

Total wall time: 60s. Model requests served by the stub: 23.
