## Why

The opencode pin is `>= 2.1.2 < 2.3.0`, so a 2.3.0 install is refused as "newer than supported" even though opencode's breaking changes are majors. The ceiling was the last minor verified end to end, not a compatibility boundary. The only documented 2.2-only capability the factory uses is direct MCP/plugin tool exposure when `execute` is denied, which is what makes `config.mcp.roles` effective; raising the global floor to 2.2.0 would force every user to upgrade for a feature they do not use. Compatibility should be per feature: a feature that needs a newer opencode declares that floor itself, and everyone else keeps running on 2.1.2.

## What Changes

- The base opencode range becomes `>= 2.1.2 < 3.0.0` (`tested` stays 2.2.0), so every 2.x minor is accepted and 3.0.0 is the next breaking gate.
- A new `OPENCODE_FEATURES` registry declares the floor each opencode-dependent feature needs; `mcp.roles` declares 2.2.0.
- `opencodeRequirement(config)` returns the highest enabled feature floor (or nothing), and the effective floor is the maximum of that and the base floor. Only the top-level `mcp.roles` map enables `mcp.roles`; per-agent `mcp` lists are out of scope here (see Design D2).
- `checkTool`/`checkTools` accept an optional per-tool floor and reason, so messages name the feature.
- `init` blocks below the effective floor, `update` warns, and `doctor` fails on an unmet feature floor and warns when the lock's floor is stale.
- `factory.lock.json` records the effective opencode floor for the workspace.
- README and `docs/cli.md` describe the 2.x range and the `mcp.roles` floor; ADR-0045 and a patch changeset record the decision.

## Capabilities

### New Capabilities

- `opencode-compatibility`: the base opencode range, the per-feature floors, the effective floor written to the lock, and how init, update and doctor enforce it.

### Modified Capabilities

None.

## Impact

- Repo: `loomwright` only.
- Code: `packages/core/src/versions.ts`, a new `packages/core/src/opencode-features.ts`, `packages/core/src/tools.ts`, `packages/core/src/lock/lock.ts`, `packages/core/src/workspace/sync.ts`, `packages/core/src/doctor/doctor.ts`, `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/update.ts`.
- Tests: new `packages/core/test/opencode-features.test.ts`, `packages/core/test/tools.test.ts`, `packages/core/test/lock.test.ts`; `packages/cli/test/init.test.ts`, `update.test.ts`, `doctor.test.ts`.
- Docs: `README.md`, `docs/cli.md`, `docs/decisions/0045-*.md` and its index row, `.changeset/`.
- Contracts: none configured; no API schema, event or Helm value changes.
- Data: no config schema or migration change; `mcp.roles` already exists. `factory.lock.json` keeps its format and records a different opencode `min` when the feature is enabled.
- Protected: `.opencode/` and `factory.lock.json` are rendered by the installed CLI; this change does not edit them, and `loomwright update` regenerates the lock after landing.
- Not changed: the manual E2E matrix stays at the versions verified end to end (2.1.2 and 2.2.0); 2.3.0 is accepted by the range, not added to the matrix without a verification run. A per-agent `mcp` pattern list (`config.agents[].mcp`) does not raise the floor; extending the requirement to cover it is a follow-up outside this change.
