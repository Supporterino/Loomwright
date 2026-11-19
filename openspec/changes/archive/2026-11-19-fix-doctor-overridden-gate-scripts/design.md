# Design: Doctor honours gate overrides in the write-mode script check

## Context

`packages/core/src/doctor/doctor.ts::checkWriteModeScripts` iterates
`config.gates.scripts` and reads each named script's body from the repository's `package.json`. It
warns when the body matches `WRITE_FLAG` (`--write`, `--fix`, `--apply`, `-w`). It never reads
`config.gates.overrides`.

`packages/core/src/gates/resolve.ts::resolveGates` is the authority for what a run executes. Per
gate type it treats `gates.overrides[repo][type]` first: the literal `"skip"` opts out, any other
value becomes an `override` gate, and the `gates.scripts` lookup is never reached. The doctor check
therefore describes a script that will not run and recommends an override that is already set.

The doctor report shape is public to `doctor --json` consumers, and the CLI prints the checks in
order. The check name, status and detail are tested. The fix is limited to the predicate that
decides whether to add the warning.

## Decisions

### 1. Skip overridden pairs instead of resolving the override command

An override is an explicit, visible statement of the command the owner wants, and
`checkWriteModeScripts` does not build the worktree/targets inputs that
`fillPlaceholders`/`repoPlaceholders` need. Skipping the pair is the smallest change that makes
the warning agree with `resolveGates`.

Rejected: resolving the override and warning when its command matches `WRITE_FLAG`. It would keep
the check useful for writing overrides, but it duplicates gate resolution and needs inputs this
check does not have. Recorded as a follow-up, not part of this change.

Rejected: replacing the script-body inspection with the resolved command. For a script gate the
resolved command is `bun run lint` or `make lint` (`scriptCommand`), not the script body, so
`WRITE_FLAG` would stop matching and the genuine warning would disappear.

### 2. Iterate `GATE_TYPES` so the override key stays a `GateType`

`GateCommands` is a `z.partialRecord(GateType, string)`, so object entries widen the key to
`string` and the override lookup no longer type-checks against `GateCommands`. Iterating the
exported `GATE_TYPES` list keeps `type` a `GateType` and reads
`config.gates.overrides[repo.name]?.[type]`. A missing `gates.scripts[type]` is an explicit
skip, matching the schema's optional record.

The `"skip"` literal needs no special case: the override entry is defined, so the pair is skipped
before the script is read.

### 3. Keep the body-based check and the existing report fields

The warning keeps the check name `"<repo> <type> script"`, status `warn` and a detail that contains
the script name and body. Only the fix hint gains the clarification that an override
replaces the script lookup. This keeps the CLI table and `doctor --json` consumers working without
a shape change, and gives the control test a stable assertion.

### 4. Documentation and changeset ship with the fix

The `gates.scripts` row and the doctor troubleshooting row in `README.md`, and the doctor/gate
sections of `docs/cli.md`, must not advertise a remedy the check ignores. They use the same
"replaces the script lookup" wording as the fix hint, asserted in `test/docs.test.ts`. The change
needs a patch changeset for `@loomwright/cli` because it touches `packages/`.
`packages/cli/CHANGELOG.md` is generated from changesets at release, so only the changeset file is
written here.

## Contract changes

None configured. The private `checkWriteModeScripts` changes behaviour only; `DoctorReport`,
`GateRow`, gate resolution and the config schema are unchanged. No API schema, event or Helm value
changes.

## Risks

- The check now trusts the override as an explicit statement, so an override command that itself
  writes files is not reported. That is the accepted trade-off of Decision 1 and is visible in the
  config.
- A repository with an override map but a different gate type still warns, which is covered by the
  scoped-override test.
- The docs wording must stay aligned with the hint; the docs assertions make drift fail the gate.
- `packages/core/src/plugin/` and `packages/core/src/policy/` are untouched, so the plugin bundle
  needs no rebuild. The config schema export is unchanged, so no generated schema refresh is
  needed.
- The YARM workspace's interim removal of `gates.scripts.lint` is not reverted here; it is a
  workspace change after this release.
