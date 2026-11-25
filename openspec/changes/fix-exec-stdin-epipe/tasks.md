# Tasks: `exec` ignores a child's stdin write failure instead of crashing the CLI

## 1. loomwright
- [ ] 1.1 Guard `child.stdin` in `exec` and cover the guard with unit tests
  - repo: loomwright
  - deps: none
  - touches: packages/core/src/exec.ts, packages/core/test/exec.test.ts
- [ ] 1.2 Add the doctor end-to-end case for an import that exits before reading stdin
  - repo: loomwright
  - deps: 1.1
  - touches: packages/cli/test/doctor.test.ts
- [ ] 1.3 Add the patch changeset for `@loomwright/cli`
  - repo: loomwright
  - deps: 1.1
  - touches: .changeset/**
- [ ] 1.4 Run the full gate and check `loomwright doctor` by hand
  - repo: loomwright
  - deps: 1.1, 1.2, 1.3
  - touches: none
