---
"@loomwright/cli": patch
---

Every binding-less `catch` in shipped code now states why its failure is ignored, and `doctor`
warns when a repo's `package.json` cannot be parsed instead of silently treating a configured gate
script as absent.
