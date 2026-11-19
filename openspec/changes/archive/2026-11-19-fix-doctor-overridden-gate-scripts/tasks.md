# Tasks: Doctor honours gate overrides in the write-mode script check

## 1. loomwright

- [x] 1.1 Make the write-mode script check skip overridden repo/gate pairs and cover it with tests
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/doctor/doctor.ts, packages/cli/test/doctor.test.ts

- [x] 1.2 Document the override precedence in the README and CLI reference with doc assertions
  - repo: loomwright
  - deps: 1.1
  - touches: README.md, docs/cli.md, test/docs.test.ts

- [x] 1.3 Add the patch changeset for `@loomwright/cli`
  - repo: loomwright
  - deps: 1.1
  - touches: .changeset/**

- [x] 1.4 Run the full gate and confirm both override directions with `loomwright doctor`
  - repo: loomwright
  - deps: 1.1, 1.2, 1.3
  - touches: none
