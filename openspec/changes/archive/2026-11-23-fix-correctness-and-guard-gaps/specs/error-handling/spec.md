# error-handling Specification

## ADDED Requirements

### Requirement: A silent catch states why the failure is ignored

A `catch` block without a binding MAY discard the error only when the block opens with a
comment that names the fallback, or when it calls a documented helper with a reason. A failure
the user needs MUST be returned as a documented fallback or surfaced through `status`
(`corrupt`) or `doctor`; it MUST NOT be indistinguishable from success. This rule applies to
`packages/*/src/**` and `scripts/**`; tests are out of scope.

#### Scenario: every silent catch carries a reason

- **WHEN** every `catch {` in `packages/*/src/**/*.ts`, `packages/*/src/**/*.tsx` and
  `scripts/**/*.ts` is inspected
- **THEN** each block opens with a comment naming its fallback, or calls a documented helper
  with a reason
- **AND** the scan reports no violation

#### Scenario: an unreasoned catch fails the scan

- **WHEN** the scan is given `try { work(); } catch { return undefined; }`
- **THEN** it reports that block as a violation with its file and line

#### Scenario: corrupt state is still visible

- **WHEN** a run, lock or queue file is corrupt
- **THEN** `status --json` reports it under `corrupt`
- **AND** the read does not turn the failure into an empty success

#### Scenario: doctor reports an unreadable package.json

- **WHEN** a repo's `package.json` cannot be parsed while a gate script is configured
- **THEN** `loomwright doctor` warns and names `package.json`
- **AND** it does not silently treat the gate script as absent

#### Scenario: a deliberate fallback stays quiet

- **WHEN** a usage ledger is corrupt
- **THEN** usage reads as empty and the run continues, as before
- **AND** the catch states that fallback
