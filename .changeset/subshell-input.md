---
"@loomwright/cli": patch
---

The shell guard passes a subshell's piped input and input redirects to the shell it runs, so `printf 'git push' | (bash)` and `(bash) < script.sh` are no longer allowed unchecked.
