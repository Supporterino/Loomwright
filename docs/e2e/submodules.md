# E2E: AI repo with submodules

Recorded 2026-11-16 with `bun scripts/e2e-transcript.ts submodules` (Loomwright 1.0.0).

**Real:**
- the opencode server: opencode v2.2.7 with the factory's agents, permissions and guard plugin;
- git; OpenSpec 1.14.3; graphify 0.9.93;
- the gate toolchains named in the config below.

**Scripted:** the model. `test/fixtures/stub-team.ts` answers opencode's Messages API calls per role. It writes files with opencode's `write` tool, tries a forbidden `git push` to show the guard, and ends each session with a handoff. Token counts in `status` come from the stub's fixed usage numbers.

Temp paths are shown as `<tmp>`.

The workspace is an AI repo with three submodules: `backend` (Go, provides `api/openapi.yaml`), `frontend` (React, consumes it) and `deploy` (Helm). The change adds `GET /version` and `GET /ready` to the backend and shows the version in the frontend: two backend tasks and one frontend task start in parallel, a third backend task waits for both.

## Install

```console
$ loomwright init
loomwright 1.0.0 in /private<tmp>/ai
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
created: .opencode/agents/implementer-backend.md
created: .opencode/agents/implementer-deploy.md
created: .opencode/agents/implementer-frontend.md
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
hook ai: installed
hook backend: installed
hook deploy: installed
hook frontend: installed
graph: built (841 nodes, 1.5s)
committed 184c8136b6d6 chore(factory): init v1.0.0
# exit 0 · 2.0s
```

Config edits for the run: every role uses the stub model, and the detected OpenAPI contract is confirmed with `frontend` as its consumer. The backend gates are the Go profile's (`gofmt`, `go vet`, `go test -race`); `golangci-lint` is not installed here, so lint runs `go vet`. The frontend fixture has no `node_modules`, so its gates are `skip`. `deploy` keeps `helm lint` and checks rendering with `helm template`.

```console
$ git diff HEAD~1 -- factory.config.jsonc
diff --git a/factory.config.jsonc b/factory.config.jsonc
index 325ac11..ede33f8 100644
--- a/factory.config.jsonc
+++ b/factory.config.jsonc
@@ -16,12 +16,12 @@
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
@@ -39,15 +39,38 @@
     // Gate type -> script/target name looked up in package.json, Makefile, justfile, Taskfile.
     "scripts": { "format": "format:check", "lint": "lint", "types": "typecheck", "test": "test", "testAffected": "test:affected" },
     // Repo name -> gate type -> literal command; wins over scripts and profile defaults.
-    "overrides": {},
+    "overrides": {
+      "backend": {
+        "lint": "go vet ./..."
+      },
+      "frontend": {
+        "format": "skip",
+        "lint": "skip",
+        "types": "skip",
+        "test": "skip",
+        "testAffected": "skip"
+      },
+      "deploy": {
+        "format": "skip",
+        "types": "helm template charts/app > /dev/null",
+        "test": "skip",
+        "testAffected": "skip"
+      }
+    },
     // Detected stack gates: iOS compile and generated-artifact drift. Edit or remove freely.
     "extra": []
   },
 
   // Proposed by detection: confirm providers and consumers.
   "contracts": [
-    {"kind":"helm-values","provider":"deploy","path":"charts/app/values.schema.json","consumers":["backend"]},
-    {"kind":"openapi","provider":"backend","path":"api/openapi.yaml","consumers":["frontend"]}
+    {
+      "kind": "openapi",
+      "provider": "backend",
+      "path": "api/openapi.yaml",
+      "consumers": [
+        "frontend"
+      ]
+    }
   ],
 
   "parallel": { "maxAgents": 4, "maxGateProcesses": 2, "withinRepo": "worktrees" },
```

Changed models re-render the agents, so `update` brings the managed files in line with the config:

```console
$ loomwright update
update 1.0.0 → 1.0.0
config migrations: none
  update: .opencode/agents/architect.md
  update: .opencode/agents/contract-reviewer.md
  update: .opencode/agents/explorer.md
  update: .opencode/agents/implementer-backend.md
  update: .opencode/agents/implementer-deploy.md
  update: .opencode/agents/implementer-frontend.md
  update: .opencode/agents/orchestrator.md
  update: .opencode/agents/reviewer.md
  update: .opencode/agents/tester.md
  update: openspec/config.yaml
detection differs from the config (not applied; see `loomwright detect`):
  + contract helm-values deploy:charts/app/values.schema.json → consumers [backend]
committed c8cb36e65a3e chore(factory): update to v1.0.0
backup: /private<tmp>/ai/.factory/backups/2026-11-16T12-23-09-738Z
# exit 0 · 0.3s
```

```console
$ loomwright graph
graph updated: 841 nodes, 1074 links in 1.0s
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
  ✓ config: schemaVersion 4, layout submodules
security
  ✓ sandbox: agent shells and gates run under macOS sandbox-exec
environment
  ✓ graphify env: no auto-refresh, no LLM backend
install
  ✓ managed files: 31 up to date
repos
  ✓ AI repo working tree: clean
  ✓ AI repo pre-push hook: installed
  ✓ backend working tree: clean
  ✓ backend pre-push hook: installed
  ✓ deploy working tree: clean
  ✓ deploy pre-push hook: installed
  ✓ frontend working tree: clean
  ✓ frontend pre-push hook: installed
gates
  ✓ backend: 4 gate command(s) resolved, toolchain present
  ✓ deploy: 2 gate command(s) resolved, toolchain present
  ✓ frontend: 0 gate command(s) resolved, toolchain present
context
  ✓ instructions: 0 path(s) injected into sessions
release
  ✓ release: no release tooling detected
artifacts
  ✓ records: local (reports, approvals and usage stay in .factory/)
caches
  ✓ dependency caches: 0 B
  ✓ backups: 177 KiB
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
  ✓ graph: 0 min old, no code changes since it was built (841 nodes)
changes
  ✓ active: none
gate table (full mode; per task, scoped commands and affected tests are used)
  backend format   out="$(gofmt -l .)"; [ -z "$out" ] || { echo "needs gofmt:"; echo "$out"; exit 1; }  (profile)
  backend lint     go vet ./...  (override)
  backend types    go vet ./...  (profile)
  backend test     go test -race ./...  (profile)
  deploy lint      helm lint charts/app  (profile)
  deploy types     helm template charts/app > /dev/null  (override)
  deploy format    skip: gates.overrides.deploy.format
  deploy test      skip: gates.overrides.deploy.test
  frontend format  skip: gates.overrides.frontend.format
  frontend lint    skip: gates.overrides.frontend.lint
  frontend types   skip: gates.overrides.frontend.types
  frontend test    skip: gates.overrides.frontend.test
0 problem(s), 1 warning(s)
# exit 0 · 16.0s
```

## Run up to the spec

```console
$ loomwright run Add GET /version (with the OpenAPI contract) and GET /ready to the backend, and show the backend version in the frontend
▶ intake
  ▶ [intake] orchestrator (stub/claude-stub)
  ✓ [intake] session done in 15.5s · 2.5k tok
  change add-version-endpoint
▶ explore: backend, frontend
  ▶ [explore:backend] explorer (stub/claude-stub)
  ▶ [explore:frontend] explorer (stub/claude-stub)
  ✓ [explore:frontend] session done in 371ms · 2.5k tok
  ✓ [explore:backend] session done in 371ms · 2.5k tok
▶ design: openspec/changes/add-version-endpoint
  ▶ [design] architect (stub/claude-stub)
  ✓ [design] session done in 854ms · 12.4k tok
add-version-endpoint: awaiting approval — review openspec/changes/add-version-endpoint/ then run `loomwright approve add-version-endpoint`
# exit 0 · 17.1s
```

```console
$ loomwright status add-version-endpoint
change add-version-endpoint — awaiting-approval (not active; factory 1.0.0)
  branches: . change/add-version-endpoint @c8cb36e65a3e
  usage: 19.8k tokens (1.6k cache read, 336 out) · cost n/a in 4 sessions
    by agent: architect 12.4k, explorer 5.0k, orchestrator 2.5k
    retry overhead: 0 · wasted re-reads: 0
# exit 0 · 0.0s
```

`openspec/changes/add-version-endpoint/tasks.md`:

```markdown
## 1. backend

- [ ] 1.1 Add GET /version to the backend and its OpenAPI contract
  - repo: backend
  - deps: none
  - touches: version.go, main.go, api/openapi.yaml
- [ ] 1.2 Add the readiness handler
  - repo: backend
  - deps: none
  - touches: ready.go
- [ ] 1.3 Register GET /ready
  - repo: backend
  - deps: 1.1, 1.2
  - touches: main.go

## 2. frontend

- [ ] 2.1 Show the backend version in the frontend
  - repo: frontend
  - deps: 1.1
  - touches: src/Version.tsx
```

## Approve: the rest runs on its own

```console
$ loomwright approve add-version-endpoint
✓ approved add-version-endpoint by fixture@example.com (spec f3c54b556ced, 4 tasks)
▶ context packs (4)
  ▶ [context-packs] architect (stub/claude-stub)
  ✓ [context-packs] session done in 15.8s · 12.4k tok
▶ implement: 4 tasks (max 4 agents)
  ⚙ [1.1] installing dependencies in backend
  ⚙ [1.2] installing dependencies in backend
  ▶ [1.1] Add GET /version to the backend and its OpenAPI contract · implementer-backend (stub/claude-stub) · attempt 1/4
  ▶ [1.2] Add the readiness handler · implementer-backend (stub/claude-stub) · attempt 1/4
  ✗ [1.1] shell failed: Loomwright blocked this call: git push is not allowed: the factory never pushes
  ✓ [1.2] session done in 534ms · 5.0k tok
  ⚙ [1.2] gates: format, lint, types, testAffected
  ✓ [1.1] session done in 701ms · 12.4k tok
  ⚙ [1.1] gates: format, lint, types, testAffected
  … waiting: 1.3 (waiting on 1.1, 1.2), 2.1 (waiting on 1.1)
  ✓ [1.2] gates passed in 16.3s
  ✓ [1.1] gates passed in 16.2s
  ⇢ [1.2] merging into change/add-version-endpoint
  ⇢ [1.1] merging into change/add-version-endpoint
  ⚙ [1.2] gates after rebase: format, lint, types, testAffected
  ✓ [1.2] gates after rebase passed in 520ms
  ✓ 1.2 merged (backend)
  … waiting: 1.3 (waiting on 1.1), 2.1 (waiting on 1.1)
  ⚙ [1.1] gates after rebase: format, lint, types, testAffected
  ✓ [1.1] gates after rebase passed in 585ms
  ✓ 1.1 merged (backend)
  ⚙ [2.1] installing dependencies in frontend
  ⚙ [1.3] installing dependencies in backend
  ▶ [2.1] Show the backend version in the frontend · implementer-frontend (stub/claude-stub) · attempt 1/4
  ▶ [1.3] Register GET /ready · implementer-backend (stub/claude-stub) · attempt 1/4
  ✓ [2.1] session done in 480ms · 5.0k tok
  ✓ [1.3] session done in 481ms · 5.0k tok
  ⚙ [1.3] gates: format, lint, types, testAffected
  ✓ [2.1] gates passed in 20ms
  ⇢ [2.1] merging into change/add-version-endpoint
  ✓ [2.1] gates after rebase passed in 22ms
  ✓ 2.1 merged (frontend)
  ✓ [1.3] gates passed in 586ms
  ⇢ [1.3] merging into change/add-version-endpoint
  ⚙ [1.3] gates after rebase: format, lint, types, testAffected
  ✓ [1.3] gates after rebase passed in 521ms
  ✓ 1.3 merged (backend)
implement: 4/4 merged in 23.7s
▶ review + tests: backend, frontend
  ▶ [review:frontend] reviewer (stub/claude-stub)
  ▶ [review:backend] reviewer (stub/claude-stub)
  ✓ [review:frontend] session done in 348ms · 2.5k tok
  ✓ [review:backend] session done in 352ms · 2.5k tok
▶ implement: 2 tasks (max 4 agents)
  ⚙ [test-frontend] installing dependencies in frontend
  ⚙ [test-backend] installing dependencies in backend
  ▶ [test-frontend] Ensure every scenario of frontend has a test · tester (stub/claude-stub) · attempt 1/4
  ▶ [test-backend] Ensure every scenario of backend has a test · tester (stub/claude-stub) · attempt 1/4
  ✓ [test-frontend] session done in 460ms · 5.0k tok
  ✓ [test-backend] session done in 495ms · 5.0k tok
  ✓ [test-frontend] gates passed in 19ms
  ⚙ [test-backend] gates: format, lint, types, testAffected
  ⇢ [test-frontend] merging into change/add-version-endpoint
  ✓ [test-frontend] gates after rebase passed in 17ms
  ✓ test-frontend merged (frontend)
  ✓ [test-backend] gates passed in 3.8s
  ⇢ [test-backend] merging into change/add-version-endpoint
  ⚙ [test-backend] gates after rebase: format, lint, types, testAffected
  ✓ [test-backend] gates after rebase passed in 506ms
  ✓ test-backend merged (backend)
implement: 6/6 merged in 6.5s
▶ contract gate: 1 contract
  ✓ openapi:backend:api/openapi.yaml
▶ contract review
  ▶ [contract-review] contract-reviewer (stub/claude-stub)
  ✓ [contract-review] session done in 113ms · 2.5k tok
▶ full suite: backend, frontend
  ⚙ [backend] gates: format, lint, types, test
  ✓ [frontend] gates passed in 0ms
  ✓ [backend] gates passed in 2.1s
▶ close
  ⚙ bumping submodule pointers
  ⚙ archiving the spec
✓ add-version-endpoint done — report: /private<tmp>/ai/.factory/reports/add-version-endpoint.md
add-version-endpoint: done
next: `loomwright land add-version-endpoint` merges the finished change into its base branches
# exit 0 · 49.7s
```

```console
$ loomwright status add-version-endpoint
change add-version-endpoint — done (not active; factory 1.0.0)
  branches: . change/add-version-endpoint @c8cb36e65a3e · backend change/add-version-endpoint @254320684b87 · frontend change/add-version-endpoint @05f64f673a60
  review round: 1
  graph: covers 6 of 6 merges
  tasks: 6/6 merged (merge seq 6)
    ✓ 1.1           backend  Add GET /version to the backend and its OpenAPI contract — merged 9fd987992a4e · 12.4k tok
    ✓ 1.2           backend  Add the readiness handler — merged c6a57e3b39de · 5.0k tok
    ✓ 1.3           backend  Register GET /ready — merged d1437c078299 · 5.0k tok
    ✓ 2.1           frontend Show the backend version in the frontend — merged 3c53c68f4242 · 5.0k tok
    ✓ test-frontend frontend Ensure every scenario of frontend has a test — merged b4a7c552eb3d · 5.0k tok
    ✓ test-backend  backend  Ensure every scenario of backend has a test — merged 9ad4e0b00487 · 5.0k tok
  full suite: frontend ✓, backend ✓
  contracts: openapi:backend:api/openapi.yaml ✓
  pointers: ab2829dd69d3 (provisional; repos/backend: 254320684b87 → 9ad4e0b00487, repos/frontend: 05f64f673a60 → b4a7c552eb3d)
  usage: 76.8k tokens (6.2k cache read, 1.3k out) · cost n/a in 14 sessions
    by agent: architect 24.8k, implementer-backend 22.3k, tester 9.9k, explorer 5.0k, implementer-frontend 5.0k, reviewer 5.0k, orchestrator 2.5k, contract-reviewer 2.5k
    retry overhead: 0 · wasted re-reads: 0
# exit 0 · 0.0s
```

## Result

```console
$ git log --format='%h %s' main..change/add-version-endpoint
608fbf2 chore(spec): archive add-version-endpoint
ab2829d chore(submodules): bump for add-version-endpoint [provisional]
f3c54b5 docs(spec): add-version-endpoint
```

```console
$ git -C repos/backend log --format='%h %s  [%(trailers:key=Task,valueonly,separator=)]' main..change/add-version-endpoint
9ad4e0b test: ensure every scenario of backend has a test  [test-backend]
d1437c0 feat: register GET /ready  [1.3]
9fd9879 feat: add GET /version to the backend and its OpenAPI contract  [1.1]
c6a57e3 feat: add the readiness handler  [1.2]
```

```console
$ git -C repos/frontend log --format='%h %s  [%(trailers:key=Task,valueonly,separator=)]' main..change/add-version-endpoint
b4a7c55 test: ensure every scenario of frontend has a test  [test-frontend]
3c53c68 feat: show the backend version in the frontend  [2.1]
```

```console
$ git show --stat change/add-version-endpoint~1
ab2829d chore(submodules): bump for add-version-endpoint [provisional]

Change-Id: add-version-endpoint


 repos/backend  | 2 +-
 repos/frontend | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
```

```console
$ git branch --list '*change*'
* change/add-version-endpoint
```

```console
$ git -C repos/backend branch --list '*change*'
* change/add-version-endpoint
```

```console
$ git -C repos/frontend branch --list '*change*'
* change/add-version-endpoint
```

```console
$ git worktree list
/private<tmp>/ai 608fbf2 [change/add-version-endpoint]
```

### Gate runs

Each task's gates, as logged (per task in its worktree, then again after the rebase in the merge queue; `full:<repo>` is the full suite at the end):

```text
1.2            format pass (out="$(gofmt -l ready.go)"; [ -z "$out" ] || { echo "need...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
1.1            format pass (out="$(gofmt -l main.go version.go)"; [ -z "$out" ] || { ...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
1.2            format pass (out="$(gofmt -l ready.go)"; [ -z "$out" ] || { echo "need...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
1.1            format pass (out="$(gofmt -l main.go version.go)"; [ -z "$out" ] || { ...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
2.1            format skipped · lint skipped · types skipped · testAffected skipped
2.1            format skipped · lint skipped · types skipped · testAffected skipped
1.3            format pass (out="$(gofmt -l main.go)"; [ -z "$out" ] || { echo "needs...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
1.3            format pass (out="$(gofmt -l main.go)"; [ -z "$out" ] || { echo "needs...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
test-frontend  format skipped · lint skipped · types skipped · testAffected skipped
test-frontend  format skipped · lint skipped · types skipped · testAffected skipped
test-backend   format pass (out="$(gofmt -l handlers_test.go)"; [ -z "$out" ] || { ec...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
test-backend   format pass (out="$(gofmt -l handlers_test.go)"; [ -z "$out" ] || { ec...) · lint pass (go vet ./...) · types pass (go vet .) · testAffected pass (go test -race .)
full:frontend  format skipped · lint skipped · types skipped · test skipped
full:backend   format pass (out="$(gofmt -l .)"; [ -z "$out" ] || { echo "needs gofmt...) · lint pass (go vet ./...) · types pass (go vet ./...) · test pass (go test -race ./...)
```

### Guard log

Every tool call the agents made is logged (redacted). These are the calls the plugin blocked:

```json
{
  "at": "2026-11-16T12:24:00.762Z",
  "kind": "blocked",
  "session": "ses_e1baf8a6dffeOFfHA5QFMRKY0r",
  "agent": "implementer-backend",
  "tool": "shell",
  "input": { "command": "git push origin HEAD" },
  "reason": "Loomwright blocked this call: git push is not allowed: the factory never pushes"
}
```

### Final report

```markdown
# add-version-endpoint: done

Add GET /version and GET /ready to the backend; show the version in the frontend

## Branches (local only; nothing was pushed)

- backend: `change/add-version-endpoint` at 9ad4e0b00487 (4 commits)
- frontend: `change/add-version-endpoint` at b4a7c552eb3d (2 commits)
- AI repo: `change/add-version-endpoint` (archive commit 608fbf2fe497)

## Tasks

- [x] 1.1 (backend, task): Add GET /version to the backend and its OpenAPI contract
- [x] 1.2 (backend, task): Add the readiness handler
- [x] 1.3 (backend, task): Register GET /ready
- [x] 2.1 (frontend, task): Show the backend version in the frontend
- [x] test-frontend (frontend, test): Ensure every scenario of frontend has a test
- [x] test-backend (backend, test): Ensure every scenario of backend has a test

## Submodule pointers (provisional)

- repos/backend: 254320684b87 → 9ad4e0b00487
- repos/frontend: 05f64f673a60 → b4a7c552eb3d

Push each `change/add-version-endpoint` branch and open your MRs. After they merge, run `loomwright repoint add-version-endpoint` to replace these pointers with the merged commits.

## Spec

Archived as `openspec/changes/archive/2026-11-16-add-version-endpoint`.

## Usage

Total: 76.8k tokens (6.2k cache read, 1.3k out) · cost n/a over 14 sessions.

| Agent                | Tokens | Share | Cost     |
| -------------------- | ------ | ----- | -------- |
| architect            | 24.8k  | 32%   | cost n/a |
| implementer-backend  | 22.3k  | 29%   | cost n/a |
| tester               | 9.9k   | 13%   | cost n/a |
| explorer             | 5.0k   | 6%    | cost n/a |
| implementer-frontend | 5.0k   | 6%    | cost n/a |
| reviewer             | 5.0k   | 6%    | cost n/a |
| orchestrator         | 2.5k   | 3%    | cost n/a |
| contract-reviewer    | 2.5k   | 3%    | cost n/a |

| Task or step     | Tokens | Share | Cost     |
| ---------------- | ------ | ----- | -------- |
| design           | 12.4k  | 16%   | cost n/a |
| context-packs    | 12.4k  | 16%   | cost n/a |
| 1.1              | 12.4k  | 16%   | cost n/a |
| 1.2              | 5.0k   | 6%    | cost n/a |
| 2.1              | 5.0k   | 6%    | cost n/a |
| 1.3              | 5.0k   | 6%    | cost n/a |
| test-frontend    | 5.0k   | 6%    | cost n/a |
| test-backend     | 5.0k   | 6%    | cost n/a |
| intake           | 2.5k   | 3%    | cost n/a |
| explore:frontend | 2.5k   | 3%    | cost n/a |
| explore:backend  | 2.5k   | 3%    | cost n/a |
| review:frontend  | 2.5k   | 3%    | cost n/a |
| review:backend   | 2.5k   | 3%    | cost n/a |
| contract-review  | 2.5k   | 3%    | cost n/a |

Top consumers: design (12.4k), context-packs (12.4k), 1.1 (12.4k), 1.2 (5.0k), 2.1 (5.0k).
Retry overhead: 0 tokens (0%).
Wasted re-reads of unchanged files: 0.
```

Total wall time: 87s. Model requests served by the stub: 31.
