---
"@loomwright/cli": minor
---

Gates and sandboxed shells mark the commands they wrap with `AI_FACTORY_SANDBOX=wrapped`, so a
gate that already runs inside a Seatbelt profile is not wrapped again.
