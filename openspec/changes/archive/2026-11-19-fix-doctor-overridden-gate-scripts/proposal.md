# Proposal: Doctor honours gate overrides in the write-mode script check

## Why

`loomwright doctor` warns that a repository's gate script writes files even when
`gates.overrides.<repo>.<type>` already pins that gate to a check-only command. Gate resolution
gives the override precedence and never reads the script, so the warning describes a command that
will not run and recommends a fix that is already applied. A correctly configured workspace can
therefore never reach a clean doctor run, and the warning cannot be scoped to one repository task:
in the YARM workspace it blocked two implementer tasks and produced misleading gate failures.
Changing the script is refused by the gate-definition guard and changing the workspace config is
outside a factory change, so none of the warning's suggested remedies is available to a change
author.

## What Changes

- `doctor`'s write-mode script check skips a repository/gate-type pair whose
  `gates.overrides[repo][type]` entry exists, including the literal `"skip"`, because
  `resolveGates` replaces the script lookup before it reads `gates.scripts`.
- The check iterates the typed `GATE_TYPES` list instead of widening the key to `string`, so the
  override lookup type-checks and an absent script name stays an explicit skip.
- The warning keeps firing for genuine script-sourced writing gates, with the existing check name,
  `warn` status and detail; its fix hint now says that setting the override replaces the script
  lookup.
- Regression, control and `"skip"` tests in `packages/cli/test/doctor.test.ts`, plus a case that
  an override for one gate type does not suppress the warning for another.
- The `gates.scripts` and doctor troubleshooting rows in `README.md` and the doctor/gate sections
  of `docs/cli.md` describe the same precedence, with assertions in `test/docs.test.ts`.
- A patch changeset for `@loomwright/cli` recording the fix.

## Capabilities

### New Capabilities

- `gate-diagnostics`: how `doctor` decides whether a repository's gate script is a write-mode
  script, and the documentation that describes the check. Gate resolution is the authority: a
  repo/type pair with an override is not judged by the script it replaces.

### Modified Capabilities

None.

## Impact

- **Repos:** `loomwright` only.
- **APIs:** internal only. `checkWriteModeScripts` stays private and the `DoctorReport` shape,
  check names, statuses and exit codes are unchanged. The fix hint text changes.
- **Contracts:** none configured; no API schema, event or Helm value changes.
- **Data:** none. No config schema, workspace format, lockfile or migration change.
- **Protected files:** none edited. `factory.config.jsonc`, `.opencode/`, `factory.lock.json`,
  `factory-records/` and `openspec/specs/` need no edit. The plugin bundle needs no rebuild
  because `packages/core/src/plugin/` and `packages/core/src/policy/` are untouched.
- **Downstream:** the YARM workspace can restore `gates.scripts.lint` after this release; that
  workaround reversal is a workspace change, not part of this repository change.
