# sandbox-enforcement Specification

## ADDED Requirements

### Requirement: A wrapped command is never wrapped a second time

The gate runner and the plugin's shell hook SHALL mark every command they wrap with the sandbox
marker `AI_FACTORY_SANDBOX=wrapped`, in the child environment and, for the plugin, in the
wrapped shell line itself. `sandboxEnabled` MUST return false when the current process
environment carries that marker, so a nested `sandbox-exec` is never attempted. The existing
`AI_FACTORY_SANDBOX` variable MUST carry the sandbox state — `off`, `seatbelt` or `wrapped` —
and the change MUST NOT add a second marker variable.

#### Scenario: the marker turns wrapping off

- **WHEN** `sandboxEnabled("auto", "darwin", () => true, {})` is called
- **THEN** it returns true
- **AND** the same call with `{ AI_FACTORY_SANDBOX: "wrapped" }` returns false
- **AND** the same call with `{ AI_FACTORY_SANDBOX: "off" }` returns false
- **AND** the same call with `{ AI_FACTORY_SANDBOX: "seatbelt" }` returns true

#### Scenario: a gate that is already inside a profile is not wrapped again

- **WHEN** the gate runner builds a gate command while the process environment carries
  `AI_FACTORY_SANDBOX=wrapped`
- **THEN** the command runs without a `sandbox-exec` prefix
- **AND** a gate command built with `AI_FACTORY_SANDBOX=seatbelt` carries the prefix and the
  wrapped child sees `AI_FACTORY_SANDBOX=wrapped`

#### Scenario: the plugin marks the shell it wraps

- **WHEN** the plugin's shell hook wraps a command while `AI_FACTORY_SANDBOX=seatbelt`
- **THEN** the generated command contains `sandbox-exec` and sets
  `AI_FACTORY_SANDBOX=wrapped` for the child shell
- **AND** the hook leaves the command unchanged when `AI_FACTORY_SANDBOX=wrapped`

#### Scenario: the Seatbelt suite passes while itself under a profile

- **WHEN** the suite runs on macOS with `AI_FACTORY_SANDBOX=wrapped`
- **THEN** `sandboxEnabled("auto")` is false, the suite does not spawn `sandbox-exec` itself and
  the run passes
- **AND** without the marker the suite still exercises the profile and its probes

#### Scenario: doctor reports the configured setting, not the nesting state

- **WHEN** `loomwright doctor` runs with `AI_FACTORY_SANDBOX=wrapped` and `security.sandbox` is
  `"auto"`
- **THEN** it reports the sandbox as enabled for the workspace
- **AND** it does not report the process as permanently unsandboxed

### Requirement: ADR-0041 records that the nesting guard supersedes it

`docs/decisions/0041-unsandboxed-workspace.md` SHALL state that the nesting guard landed in this
change and that flipping `factory.config.jsonc` to `security.sandbox: "auto"` is a manual,
post-landing step on a protected file. This change MUST leave `factory.config.jsonc` at
`"off"`.

#### Scenario: the ADR says superseded and the setting stays off

- **WHEN** ADR-0041 and `factory.config.jsonc` are read after the change
- **THEN** the ADR says the guard superseded the exception and names the manual flip
- **AND** `security.sandbox` is still `"off"`
- **AND** the ADR contains no capitalised product name

### Requirement: The residual sandbox risk is recorded for hosts without Seatbelt

ADR-0026 SHALL state that secret reads through globs and scripts in other languages stay
heuristic everywhere except macOS with Seatbelt, and that the shell parser and the edit-scope
checks are the only backstop on hosts without a sandbox.

#### Scenario: ADR-0026 names the off-macOS residual

- **WHEN** `docs/decisions/0026-hardening-and-sandbox.md` is read
- **THEN** it states that glob-expanded and other-language secret reads are heuristic off macOS
- **AND** it says the parser and the edit-scope check are the remaining backstop there
- **AND** it contains no capitalised product name
