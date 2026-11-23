# agent-shell-guard Specification

## ADDED Requirements

### Requirement: Package-runner aliases are inspected as the command they wrap

`npx` and `pnpx` SHALL be treated as package runners. The guard MUST skip the alias's own flags,
including the flags that take a value (`-p`/`--package`, `-c`/`--call`, `--shell`, `--prefix`,
`--userconfig`, `--registry`, `--cache`, `--node-options`), and MUST inspect the wrapped command
with the same wrapped-command, publish and global-install checks as `bunx`. A wrapped command
that is blocked when run directly MUST be blocked through the alias. When the alias uses
`-c`/`--call`, the call text MUST be inspected as a shell command line.

#### Scenario: a shell through the alias is blocked

- **WHEN** the guard checks `npx sh -c 'git push'`
- **THEN** the verdict is blocked and the reason names `git push`
- **AND** `pnpx sh -c 'git push'` is blocked the same way

#### Scenario: publishing through the alias is blocked

- **WHEN** the guard checks `npx npm publish`, `pnpx npm publish` and
  `npx -p npm@latest npm publish`
- **THEN** every verdict is blocked because publishing is not allowed

#### Scenario: a global install through the alias is blocked

- **WHEN** the guard checks `npx npm install -g left-pad` and
  `pnpx npm install --global left-pad`
- **THEN** every verdict is blocked because global installs change the machine

#### Scenario: the call flag is inspected

- **WHEN** the guard checks `npx -p typescript -c 'npm publish'`
- **THEN** the verdict is blocked because the call text publishes

#### Scenario: ordinary runner use stays allowed

- **WHEN** the guard checks `npx vitest run`, `npx --no-install tsc --noEmit` and
  `npx -p typescript tsc --version`
- **THEN** every verdict is allowed

### Requirement: The alias decision is recorded and shipped

ADR-0049 SHALL record that the aliases are routed through the wrapped-command checks rather than
blocked outright, with the rejected alternative. The committed plugin bundle SHALL be
regenerated and MUST contain the alias handling.

#### Scenario: the ADR exists and is indexed

- **WHEN** `docs/decisions/0049-*.md` and the decisions index are read
- **THEN** the ADR starts `# 0049 — `, has `## Context`, `## Decision` and `## Consequences`,
  and is listed in the index
- **AND** it says the aliases are routed, not blocked

#### Scenario: the committed bundle carries the alias checks

- **WHEN** `templates/plugin/factory-plugin.txt` is compared with a fresh `bundlePlugin()`
- **THEN** they are equal
- **AND** the bundle contains the alias handling
