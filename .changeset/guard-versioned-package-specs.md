---
"@loomwright/cli": patch
---

The shell guard strips a version tag from a package-manager name before its publish and global-install checks, so `npx npm@latest publish` and `npx npm@10 install -g left-pad` are no longer allowed unchecked.
