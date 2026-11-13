# ADR-0042: Fewer git processes per command

**Context.** The factory shells out to git for nearly everything: workspace discovery, branch
state, dirty checks, commits, and the check-only gate guard. That is correct and simple, but a
process per call adds up. `test/pipeline.test.ts` ran 7,215 git processes for 28 tests (258 per
test, median 18ms each), roughly three quarters of that file's runtime, and the whole suite took
7m22s. The largest single source was self-inflicted: `executeSync` recorded the merge base of
every managed file by spawning `git hash-object -w --stdin`, so one `init` or `update` cost one
process per managed file (~29). The gate guard also paid four processes per gate command — a
`status` and a `rev-parse HEAD` before, and the same pair after.

**Decision.**
- **Git blob objects are written in-process.** A loose object is `"blob <size>\0" + content`,
  zlib-compressed, stored at `.git/objects/<aa>/<38>`. `src/managed/sync.ts` computes the SHA-1
  and writes it, via a temp file and a rename, so concurrent writers never see a partial object.
  One `rev-parse --git-path objects --show-object-format` replaces N spawns. Repositories whose
  object format is not SHA-1, or a git too old for `--show-object-format`, fall back to the
  subprocess.
- **One snapshot per gate, not four processes.** The check-only guard reads
  `git status --porcelain=v2 -z --branch`, whose `# branch.oid` header is the HEAD it used to ask
  `rev-parse` for. Two processes per gate command instead of four, unchanged semantics.
- **Workspace discovery asks `rev-parse` once per level** (`--show-toplevel` and
  `--show-superproject-working-tree` in one call) instead of twice.
- **Fixtures are built once per test process.** Each shape (single repo, submodule AI repo) is
  built in a template directory and copied per test; the copy's git configs are re-pointed at
  the copy, because git records submodule URLs as absolute paths.
- **The suite runs files in parallel.** `bun run test` uses `bun test --parallel`
  (`--isolate` per file); `bun run test:serial` is the single-process run for debugging and
  `bun run test:fast` skips the integration-heavy files. Same tests, ~2.8× less wall clock.

**Consequences.**
- The loose-object format is a compatibility promise with git, not with the factory: tests pin
  the written id against `git hash-object` and read it back with `git cat-file`.
- Anything that depended on `git status --porcelain=v1` output in the guard now parses v2. Paths
  are read from the record tails, so names with spaces keep working; `--no-renames` keeps a
  rename from needing its second record.
- Parallel test files must not share global state. They already did not: every test builds its
  own temp workspace, and `test/setup.ts` runs per worker.
- Wall clock depends on cores. A 2-core CI runner gains less than a workstation; per-test times
  rise under contention even though the total falls.
