---
"@loomwright/cli": minor
---

The shell guard resolves package-runner option arity per runner and inspects an option with unknown arity both as a bare flag and as value-taking. `npm exec -p` is the boolean `--parseable`, while npm's value-taking configs and aliases (`--expires`, `--min-release-age`, `--password`, `--name`, `--allow-git`, `--scopes`, `--orgs`, `--packages`, `--token-description`, `--enjoy-by`, `--reg`) can no longer hide `npm publish` or a global install behind their value.
