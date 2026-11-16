# Design: opencode feature version floors

## Context

`packages/core/src/versions.ts` pins opencode to `>= 2.1.2 < 2.3.0` (`tested` 2.2.0). The
ceiling is the last minor verified end to end, so `checkTool` rejects 2.3.0 and every later
2.x minor as "newer than supported". The only documented 2.2-only capability the factory uses
is direct MCP/plugin tool exposure when `execute` is denied (`docs/research/notes/opencode-2.2.0.md`
§3), which is what makes `config.mcp.roles` effective; 2.1.2 is a valid floor for everything
else. `checkTool`/`checkTools` are the single enforcement point, used by `init`, `update` and
`doctor`; `buildLock`/`syncWorkspace` write the pins.

## Decisions

### D1 — Express the base range by major, not by the last verified minor

Set `maxExclusive` to `3.0.0` and keep `min` at `2.1.2` and `tested` at `2.2.0`. Every 2.x
minor is accepted by policy because only majors are breaking; 3.0.0 is the next gate.

Rejected: pinning to `2.3.0` (the same rejection returns at 2.4.0); bumping `tested` to 2.3.0
without an end-to-end run (the pin would claim verification that did not happen).

### D2 — A feature registry, not a config-wide floor

Add `packages/core/src/opencode-features.ts` with `OPENCODE_FEATURES`, `enabledOpencodeFeatures`
and `opencodeRequirement`. `mcp.roles` declares `min` 2.2.0. A role with an empty pattern list
does not enable the feature. `opencodeRequirement` returns the highest enabled floor and a
reason; `undefined` means the base floor is enough. The reason is built from the feature id and
its `why`, so init, update and doctor name what needs the upgrade.

Rejected: raising the global floor to 2.2.0 (forces every workspace to upgrade for a feature it
does not use); a new per-feature config key (new schema surface and migration for one consumer);
inferring the requirement from the rendered agents (the same information, but harder to test and
to name in a message).

The registry invariant — every feature's `min` is between `OPENCODE.min` and `OPENCODE.tested`
— is enforced by a unit test rather than the type system. Adding a feature that needs a newer
minor therefore forces the same change to bump `tested`, which keeps the install command
(`@opencode/cli@<tested>`) correct.

### D3 — The lock records the effective floor

`buildLock` gains an optional opencode floor; `syncWorkspace` passes
`opencodeRequirement(config)?.min ?? OPENCODE.min`. The `ToolPin` shape does not change, so old
locks keep parsing and an old CLI can still read a new lock. The floor is the workspace's
requirement, not the installed version: `update` may write 2.2.0 while 2.1.2 is installed, and
`doctor` then reports the mismatch until the user upgrades.

Rejected: leaving the lock at 2.1.2 (doctor cannot tell a stale lock from a fresh one); a
per-feature map in the lock (schema churn for one feature).

### D4 — init blocks, update warns, doctor fails

`init` reads an existing `factory.config.jsonc` before the tool check and fails with exit 4 when
the effective floor is unmet, because the configured feature will not work. `update` keeps its
warning-only behaviour: it must be able to run to rewrite the lock and managed files. `doctor`
fails on an unmet feature floor (the workspace is misconfigured) and warns when the lock's floor
is behind the config (the config changed without an update). A failed opencode check skips the
lock-range and stale-lock warnings, so one problem does not produce three messages.

Rejected: blocking `update` (an update is how the workspace records the new requirement);
warning at `init` (the feature is known to be broken, so the install should stop).

### D5 — Keep the manual E2E matrix at the verified versions

`.github/workflows/e2e.yml` stays at 2.1.2 and 2.2.0. The range admits 2.3.0, but adding it to
the matrix without running it would claim verification. A new minor is added to the matrix when
it is verified; the base support does not depend on that run.

### D6 — Docs, ADR and changeset

README's support table and `docs/cli.md` describe the 2.x range and the `mcp.roles` floor.
ADR-0045 records the major-only policy and the registry. The ADR stays name-free, like every
file under `docs/decisions/`. `packages/**` changes get a `patch` changeset.

## Contract changes

None. No API schema, event, Helm value or workspace format changes. `mcp.roles` already exists,
so no config migration is needed. `.opencode/` and `factory.lock.json` are rendered by the
installed CLI; this change does not edit them.

## Risks

- 2.3.0 is accepted by the range but not exercised by the E2E matrix. A real 2.3.0 run is a
  follow-up verification, not a code change.
- The registry invariant is a test, not a type: a reviewer must reject a feature entry above
  `OPENCODE.tested` unless the same change bumps `tested`.
- `mcp.roles` is the only feature with a documented minor dependency. `skills.roles`,
  `websearch`, `runtime` and `security.sandbox` have no documented 2.2-only capability, so they
  stay on the base floor; adding a floor for one of them needs its own evidence.
- `docs/e2e/single.md` and `docs/e2e/submodules.md` still print the old `lock >= 2.1.2 < 2.3.0`
  line because they are recordings of an earlier run, not live output. Re-recording them is a
  separate task. `docs/research/tooling.md` still records the old pin for the same reason: it is
  historical research and is not edited by this change.
- `update` can write a lock floor that the installed opencode does not meet. That is deliberate:
  the lock records requirements, and `doctor` reports the gap until the tool is upgraded.
