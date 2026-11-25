---
"@loomwright/cli": patch
---

Ignore a child's stdin write failure in `exec` so `loomwright doctor` prints its report (with a
credential `import` warning) instead of aborting with an `EPIPE` stack trace.
