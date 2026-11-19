# gate-diagnostics Specification

## Purpose

How `doctor` reports gate scripts that write files, and how that report stays consistent with the
gate-resolution order the factory actually runs (`gates.overrides` → the repo's own script →
profile defaults).

## ADDED Requirements

### Requirement: Write-mode script warnings follow gate resolution

For every code-role repository, `doctor` SHALL evaluate the write-mode script check in
gate-resolution order. For each `GATE_TYPES` entry it MUST consult
`gates.overrides[repo][type]` before `gates.scripts[type]`. When an override entry exists — a
literal command or the literal `"skip"` — the check MUST NOT inspect or warn about the named
script in that repository's `package.json`, because
`resolveGates` never resolves that script for that repository. When no override exists, a named
script whose body matches a write flag (`--write`, `--fix`, `--apply` or `-w`) SHALL keep
producing a `warn` check named `"<repo> <type> script"` whose detail contains the script name and
the script body. The fix hint of that warning SHALL name
`gates.overrides.<repo>.<type>` and state that an override replaces the script lookup. An
override for one gate type MUST NOT suppress the check for another gate type of the same
repository.

#### Scenario: an overridden writing script is not reported

- **WHEN** a code repo's `package.json` has `"lint": "biome check --fix ."` and
  `gates.overrides.app.lint` is `biome check .`
- **THEN** `doctor --json` has no check named `app lint script`
- **AND** the gate row for `app`/`lint` has `source: "override"` and command `biome check .`

#### Scenario: a writing script without an override still warns

- **WHEN** the same `package.json` has `"lint": "biome check --fix ."` and
  `gates.overrides.app.lint` is not set
- **THEN** the check `app lint script` has status `warn`
- **AND** its detail names `lint` and `biome check --fix .`
- **AND** its fix names `gates.overrides.app.lint` and says the override replaces the script
  lookup

#### Scenario: a `"skip"` override is not reported

- **WHEN** a code repo's `package.json` has `"lint": "biome check --fix ."` and
  `gates.overrides.app.lint` is `"skip"`
- **THEN** `doctor --json` has no check named `app lint script`
- **AND** the gate row for `app`/`lint` has a problem containing
  `skip: gates.overrides.app.lint`

#### Scenario: an override is scoped to its gate type

- **WHEN** `package.json` has `"format:check": "biome format --write ."` and
  `"lint": "biome check --fix ."`, `gates.overrides.app.format` is `"skip"`, and
  `gates.overrides.app.lint` is not set
- **THEN** `doctor --json` has no check named `app format script`
- **AND** the check `app lint script` has status `warn`

### Requirement: Gate documentation states the same precedence

The `gates.scripts` row and the doctor troubleshooting row in `README.md`, and the doctor and gate
sections of `docs/cli.md`, SHALL state that a `gates.overrides.<repo>.<type>` entry replaces the
script lookup, so the write-mode script warning is not evaluated for that pair. The warning's fix
hint and those docs SHALL use the same wording for that behaviour.

#### Scenario: the README rows describe the override precedence

- **WHEN** `README.md` is read
- **THEN** the `gates.scripts` row says an override replaces the script lookup
- **AND** the doctor troubleshooting row says the same

#### Scenario: the CLI reference describes the override precedence

- **WHEN** `docs/cli.md` is read
- **THEN** the Gates bullet in the doctor section says the write-mode script warning is skipped
  when the repository/gate pair has an override
- **AND** the gate resolution description says an override replaces the script lookup
