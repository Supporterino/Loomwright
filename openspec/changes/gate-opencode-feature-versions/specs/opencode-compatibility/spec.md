# opencode-compatibility Specification

## Purpose

Which opencode versions the factory accepts, and how a feature that needs a newer opencode declares its own floor so only workspaces using that feature have to upgrade.

## ADDED Requirements

### Requirement: The base opencode range accepts every 2.x minor and stops at 3.0.0

`packages/core/src/versions.ts` SHALL define the base opencode range with `min` `2.1.2`, `maxExclusive` `3.0.0` and `tested` `2.2.0`. `checkTool("opencode", …)` SHALL accept every version at or above `2.1.2` and below `3.0.0`, and SHALL reject a version below `2.1.2` or at or above `3.0.0`. `buildLock({})` SHALL return the same base range for the opencode pin.

#### Scenario: the floor is still 2.1.2

- **WHEN** `checkTool("opencode", …)` reads `opencode v2.1.2`
- **THEN** the status is ok and its version is `2.1.2`

#### Scenario: every 2.x minor is accepted

- **WHEN** `checkTool("opencode", …)` reads `opencode v2.2.0`, `opencode v2.2.7`, `opencode v2.3.0` and `opencode v2.99.0`
- **THEN** every status is ok

#### Scenario: a version below the floor is rejected

- **WHEN** `checkTool("opencode", …)` reads `opencode v2.1.1`
- **THEN** the status is not ok and the problem is `2.1.1 < 2.1.2`

#### Scenario: 3.0.0 is the next breaking gate

- **WHEN** `checkTool("opencode", …)` reads `opencode v3.0.0`
- **THEN** the status is not ok and the problem says it is newer than supported (`< 3.0.0`)

#### Scenario: the lock records the base range

- **WHEN** `buildLock({})` is called
- **THEN** `tools.opencode` is `{ min: "2.1.2", maxExclusive: "3.0.0", tested: "2.2.0" }`

### Requirement: A feature declares the opencode floor it needs

The factory SHALL keep a registry `OPENCODE_FEATURES` that maps each opencode-dependent feature id to a `min` and a `why`. The registry SHALL contain `mcp.roles` with `min` `2.2.0` and a `why` naming direct MCP/plugin tool exposure. Every feature's `min` MUST be at least `OPENCODE.min` and at most `OPENCODE.tested`; a feature that needs a newer minor MUST raise `tested` in the same change.

#### Scenario: mcp.roles declares 2.2.0

- **WHEN** `OPENCODE_FEATURES["mcp.roles"]` is read
- **THEN** its `min` is `2.2.0`
- **AND** its `why` mentions direct MCP/plugin tool exposure

#### Scenario: no feature asks for an unverified minor

- **WHEN** every entry in `OPENCODE_FEATURES` is checked
- **THEN** its `min` is at least `2.1.2` and at most `2.2.0`

### Requirement: Only a config that enables a feature raises the required version

`opencodeRequirement(config)` SHALL return `undefined` when no enabled feature needs a floor above `OPENCODE.min`, and SHALL return the highest enabled feature floor with a reason naming the feature otherwise. `config.mcp.roles` SHALL enable `mcp.roles` only when at least one role maps to a non-empty pattern list. The effective floor SHALL be the maximum of `OPENCODE.min` and every enabled feature's `min`. `syncWorkspace` SHALL pass the effective floor to `buildLock`, which SHALL write it as the opencode pin's `min`.

#### Scenario: an empty mcp.roles keeps the base floor

- **WHEN** `opencodeRequirement` is called with `mcp.roles` empty
- **THEN** it returns `undefined`
- **AND** the effective floor is `2.1.2`

#### Scenario: one role with a pattern needs 2.2.0

- **WHEN** `opencodeRequirement` is called with `mcp.roles` mapping `implementer` to `["mantine_*"]`
- **THEN** it returns `min` `2.2.0`
- **AND** the reason names `mcp.roles`

#### Scenario: an empty pattern list does not enable the feature

- **WHEN** `opencodeRequirement` is called with `mcp.roles` mapping `implementer` to `[]`
- **THEN** it returns `undefined`

#### Scenario: the lock records the effective floor

- **WHEN** `init` or `update` writes a lock for a config with a non-empty `mcp.roles`
- **THEN** `factory.lock.json` has `tools.opencode.min` `2.2.0`
- **AND** a config without `mcp.roles` writes `2.1.2`

### Requirement: init blocks, update warns and doctor reports an unmet feature floor

`init` SHALL fail with exit code 4 before writing when the installed opencode is below the effective floor, and the error detail SHALL name the feature and the install command. `update` SHALL print a warning naming the feature and continue. `doctor` SHALL report a `fail` for opencode when an enabled feature needs a newer version, SHALL warn when the lock's opencode floor is below the config's effective floor, and SHALL keep the base floor and ceiling checks unchanged.

#### Scenario: init refuses an opencode below a feature floor

- **WHEN** `init` runs on a workspace whose config enables `mcp.roles` and the installed opencode is `2.1.2`
- **THEN** it exits 4
- **AND** the error names `mcp.roles` and `@opencode/cli@2.2.0`
- **AND** no file is written

#### Scenario: init accepts the tested version

- **WHEN** `init` runs on the same workspace with opencode `2.2.0`
- **THEN** it succeeds

#### Scenario: update warns and continues

- **WHEN** `update` runs on a workspace whose config enables `mcp.roles` and the installed opencode is `2.1.2`
- **THEN** it prints a warning naming `mcp.roles`
- **AND** it still writes the lock with `tools.opencode.min` `2.2.0`

#### Scenario: doctor fails an unmet feature floor

- **WHEN** `doctor` runs with `mcp.roles` enabled and opencode `2.1.2`
- **THEN** the opencode check is `fail`
- **AND** its detail names `mcp.roles`

#### Scenario: doctor warns about a stale lock

- **WHEN** `doctor` runs with `mcp.roles` enabled, opencode `2.2.0`, and a lock whose `tools.opencode.min` is `2.1.2`
- **THEN** it reports a warning that the lock's floor is behind the config
- **AND** the fix says to run `loomwright update`

#### Scenario: doctor keeps the base floor for a config without the feature

- **WHEN** `doctor` runs with an empty `mcp.roles` and opencode `2.1.2`
- **THEN** the opencode check is ok

#### Scenario: 3.0.0 fails with or without the feature

- **WHEN** `doctor` or `init` checks opencode `3.0.0`
- **THEN** the check fails as newer than supported
