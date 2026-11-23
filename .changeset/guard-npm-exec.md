---
"@loomwright/cli": patch
---

The shell guard routes `npm exec` and its `x` alias through the same wrapped-command and `-c`/`--call` checks as `npx`, so `npm exec -- git push` and `npm x -c 'git push'` are no longer allowed unchecked.
