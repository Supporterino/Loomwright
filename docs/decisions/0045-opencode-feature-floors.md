# 0045 — opencode feature version floors

## Context

The opencode pin was `>= 2.1.2 < 2.3.0`: the ceiling was the last minor verified end to end, not
a compatibility boundary, so 2.3.0 was refused as "newer than supported" although opencode's
breaking changes are majors. One capability the factory documents needs 2.2.0: direct
MCP/plugin tool exposure when `execute` is denied, which is what makes `config.mcp.roles`
effective. Raising the global floor for it would force every workspace to upgrade.

## Decision

- The base range becomes `>= 2.1.2 < 3.0.0`; `tested` stays 2.2.0 until a new minor is verified
  end to end.
- A registry (`OPENCODE_FEATURES`) declares the opencode floor each feature needs, with the
  reason used in messages. `mcp.roles` declares 2.2.0. A role with an empty pattern list does not
  enable the feature.
- `opencodeRequirement(config)` returns the highest enabled floor (or nothing), and the effective
  floor is the maximum of that and the base floor.
- `init` blocks below the effective floor, `update` warns and continues, `doctor` fails an unmet
  floor and warns when the lock's floor is stale.
- The lock records the effective floor; its shape does not change.

Alternatives rejected: pinning the base range to the last verified minor (the same rejection
returns at the next minor); raising the global floor to 2.2.0 (everyone upgrades for a feature
they do not use); a new per-feature config key (schema surface for one consumer); a per-feature
map in the lock (schema churn for one feature).

## Consequences

- Every 2.x minor is accepted; a real 2.3.0 run is a follow-up verification, not a code change,
  and the manual E2E matrix stays at the verified versions.
- The registry invariant (every floor between the base floor and `tested`) is enforced by a unit
  test, not the type system: a feature that needs a newer minor must bump `tested` in the same
  change.
- `update` can write a lock floor the installed opencode does not meet; that is deliberate, and
  `doctor` reports the gap until the tool is upgraded.
