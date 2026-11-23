# cli-arguments Specification

## ADDED Requirements

### Requirement: Help is honoured only as the first token before `--`

`runCli` SHALL treat `-h` or `--help` as a help request only when it appears before the command
name (a global token) or as the first token after the command name. Every later occurrence MUST
be left to the command's own parser, so a flag value, a file name or positional text that
happens to be `-h` or `--help` reaches the command. A token after `--` is never a help request.
The command runner SHALL accept an injectable command list for tests, defaulting to the real
command table, without changing any command's runtime behaviour.

#### Scenario: a first token still prints help

- **WHEN** `loomwright -h`, `loomwright --help` or `loomwright run --help` runs
- **THEN** the matching usage text is printed and the exit code is `0`

#### Scenario: a flag value is not help

- **WHEN** `loomwright reword add-health --prompt -h` runs
- **THEN** the reword command receives `["add-health", "--prompt", "-h"]`
- **AND** no help text is printed and the prompt is `-h`

#### Scenario: a file named `-h` is not help

- **WHEN** `loomwright run --request -h` runs and a readable file named `-h` exists
- **THEN** the `run` command receives `["--request", "-h"]`
- **AND** the request is read from that file, not from a help path

#### Scenario: `--help` after `--` is positional text

- **WHEN** `loomwright run -- --help` runs
- **THEN** the `run` command receives `["--", "--help"]`
- **AND** the help text is not printed

#### Scenario: `-h` after `--` is positional text

- **WHEN** `loomwright run -- -h` runs
- **THEN** the `run` command receives `["--", "-h"]`
- **AND** the help text is not printed

#### Scenario: a later help token is the command's business

- **WHEN** `loomwright run add-health --help` runs
- **THEN** the `run` command receives `["add-health", "--help"]`
- **AND** the command's parser decides what to do with it
