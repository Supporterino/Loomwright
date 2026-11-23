---
"@loomwright/cli": patch
---

The shell guard dispatches package-manager handling on the version-stripped name, so `npx npm@latest run deploy` and `npx bun@1 run deploy` inspect the named script body instead of being allowed unchecked.
