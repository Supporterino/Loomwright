## ADDED Requirements

### Requirement: The supported OpenSpec range includes 1.x and 2.x

`versions.ts` SHALL declare OpenSpec support from `1.10.0` up to but excluding `3.0.0`, and SHALL name `2.2.0` as the tested and recommended version. `checkTool`, `checkTools`, `doctor` and `buildLock` SHALL read the range from that one constant; no other module may hard-code an OpenSpec ceiling. Every 2.x version SHALL be accepted, `1.14.3` SHALL remain accepted, and `3.0.0` SHALL be rejected as newer than supported.

#### Scenario: a 2.x install is accepted

- **WHEN** `checkTool("openspec", dir)` runs against a stub that prints `2.2.0`
- **THEN** the status is `{ tool: "openspec", ok: true, version: "2.2.0" }`
- **AND** `2.99.0` is accepted the same way

#### Scenario: 3.0.0 is the next breaking gate

- **WHEN** `checkTool("openspec", dir)` runs against a stub that prints `3.0.0`
- **THEN** the status is not ok
- **AND** the problem says the version is newer than supported (`< 3.0.0`)

#### Scenario: a 1.x install still passes

- **WHEN** `checkTool("openspec", dir)` runs against a stub that prints `1.14.3`
- **THEN** the status is ok and names `1.14.3`

#### Scenario: the lock records the wider range

- **WHEN** `buildLock({})` runs
- **THEN** `tools.openspec` is `{ min: "1.10.0", maxExclusive: "3.0.0", tested: "2.2.0" }`

### Requirement: Generated tools follow the installed OpenSpec layout

`renderOpenspecTools` SHALL read the installed OpenSpec version before it runs `init`. It SHALL invoke `openspec init --tools opencode --profile core --no-animation <scratch>`, append `--scope project` when the installed version is `2.1.0` or newer, and render every generated file under both `<scratch>/.opencode` and `<scratch>/.agents` as a managed file with template `openspec-tools`. On 1.x it MUST NOT pass `--scope` and MUST keep the existing `.opencode/**` paths. On 2.x it MUST manage `.agents/skills/**`, including the router skill and any `references/` files. A failed `init` SHALL raise an `ExecError` and the scratch directory SHALL still be removed.

#### Scenario: 2.2 writes skills under .agents

- **WHEN** `renderOpenspecTools` runs against a 2.2 stub that writes `.agents/skills/openspec-propose/SKILL.md`, `.agents/skills/openspec/SKILL.md` and `.agents/skills/openspec/references/status.md`
- **THEN** the returned files have those `.agents/skills/**` paths
- **AND** every returned file carries template `openspec-tools`
- **AND** the stub received `--scope project` and the scratch directory as its target

#### Scenario: 2.2 also keeps any .opencode output

- **WHEN** a 2.x stub writes both `.opencode/opencode.jsonc` and `.agents/skills/openspec/SKILL.md`
- **THEN** both paths are returned as managed files

#### Scenario: 1.x keeps the current invocation

- **WHEN** `renderOpenspecTools` runs against a 1.14.3 stub that writes `.opencode/commands/opsx-propose.md`
- **THEN** the returned file is `.opencode/commands/opsx-propose.md`
- **AND** the stub received no `--scope` argument

#### Scenario: a failed init is reported and cleaned up

- **WHEN** the stub exits non-zero
- **THEN** `renderOpenspecTools` rejects with an `ExecError`
- **AND** the scratch directory no longer exists

### Requirement: The .agents tree is installed, managed and protected

`INSTALL_PATHS` SHALL include `.agents`, so install and update commits include it and `status` reports it. `.agents/skills` SHALL be a protected path in `isProtectedPath`, the rendered permission rules and `protectedInWorktree`, so no agent role may edit a generated skill. A lock entry for a `.agents/skills/**` file SHALL use template `openspec-tools`; when `update` does not regenerate tools, that entry SHALL be carried unchanged like any other generated OpenSpec file.

#### Scenario: the install path includes .agents

- **WHEN** `INSTALL_PATHS` is read
- **THEN** it contains `.agents`
- **AND** an install commit of a 2.x workspace includes the generated `.agents/skills/**` files

#### Scenario: generated skills are protected

- **WHEN** `isProtectedPath(".agents/skills/openspec-propose/SKILL.md")` is called and an implementer's rules are applied to an edit there
- **THEN** the path is protected
- **AND** the edit effect is `deny`
- **AND** `protectedInWorktree(root)` includes `<root>/.agents/skills`

#### Scenario: a carried tools entry survives a plain update

- **WHEN** a lock entry for `.agents/skills/openspec/SKILL.md` has template `openspec-tools` and `update` runs without `--tools`
- **THEN** the entry is carried
- **AND** an edited skill file is kept rather than overwritten

### Requirement: The OpenSpec command wrappers keep their contracts

`newChange`, `validateChange` and `archiveChange` SHALL keep the same arguments and result contracts for 1.x and 2.x: `new change <id>`, `validate <id> --strict --json --no-interactive` parsing `{ items: [{ id, valid, issues }] }`, and `archive <id> --yes --json` parsing `{ archive: { archivedAs } }`. A 2.x JSON payload MUST validate and archive through those parsers. A non-JSON `validate` result SHALL still be reported as a validation failure.

#### Scenario: a 2.x change validates

- **WHEN** the stub returns `{"items":[{"id":"add-health","valid":true,"issues":[]}]}`
- **THEN** `validateChange` resolves to an empty issue list

#### Scenario: 2.x validation issues keep their path

- **WHEN** the stub returns an invalid item with an issue `{ level: "error", path: "specs/a/spec.md", message: "missing scenario" }`
- **THEN** the returned issue contains `specs/a/spec.md` and `missing scenario`

#### Scenario: a 2.x archive names its archive path

- **WHEN** the stub returns `{"archive":{"archivedAs":"2026-11-26-add-health"}}`
- **THEN** `archiveChange` resolves to `2026-11-26-add-health`

#### Scenario: non-JSON validate output still fails readably

- **WHEN** the stub prints plain text instead of JSON
- **THEN** `validateChange` returns one issue starting with `openspec validate failed:`
- **AND** no exception escapes
