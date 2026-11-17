---
"@loomwright/cli": patch
---

opencode: accept every 2.x minor below 3.0.0 and let features declare their own floor
(`mcp.roles` needs 2.2.0); the lock records the effective floor and init, update and doctor
report it.
