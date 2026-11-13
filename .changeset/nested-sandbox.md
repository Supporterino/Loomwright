---
"@loomwright/cli": patch
---

Gates and agent shells no longer start a second macOS sandbox over a command the factory already wrapped. The wrapped command carries `AI_FACTORY_SANDBOXED`, so nested runs (this repo's own suite, a CLI started from an agent shell) skip the wrapper instead of failing with `EPERM`, and `security.sandbox: "auto"` works for a workspace whose tests exercise the sandbox themselves.
