# 0051 — OpenSpec 2.x support

## Context

The OpenSpec pin ended at `< 2.0.0`, so every 2.x install was rejected even though 2.0, 2.1 and
2.2 keep the change/validate/archive workflow the factory drives and only move the generated
agent files to `.agents/skills/`. The upstream notes are the changelog at
<https://openspec.dev/changelog/> and the v2.0.0, v2.1.0 and v2.2.0 release pages at
<https://github.com/Fission-AI/OpenSpec/releases>.

## Decision

- `OPENSPEC` is `>= 1.10.0, < 3.0.0`, with `2.2.0` as the tested and recommended version. Keeping
  1.10 as the floor leaves existing 1.x workspaces working; requiring 2.x would be a breaking
  change nobody asked for.
- `renderOpenspecTools` reads the installed version before it runs `init`, then adds
  `--scope project` on 2.1.0 and newer so `init` cannot install globally. `--profile core` and
  `--no-animation` stay.
- The scratch walk visits both `.opencode` and `.agents` when they exist, so a 1.x layout, a
  newer layout, the 2.2 router skill and `references/` are picked up without enumerating them.
- `.agents` joins `INSTALL_PATHS`, so install and update commits and status see the tree, and the
  existing lock carry logic treats its OpenSpec-generated files like any other template entry.
- `.agents/skills` is protected in the path class, in the rendered rules and in the worktree
  sandbox. Only that generated tree is factory-owned; custom skills elsewhere under `.agents`
  stay the user's.
- Legacy archiving stays `.opencode`-only. A pre-factory 2.x install already has its OpenSpec
  skills in `.agents/skills`; `renderOpenspecTools` returns those paths and `ownEdits` adopts
  them, so nothing moves and another tool's skills are never archived.
- 2.x is proven with stubs. A real 2.2 `init` in CI is avoided because 2.1+ uses Vercel's skills
  installer and needs Git and GitHub access, and the tests stay hermetic.

## Consequences

- A 1.x workspace behaves exactly as before; widening the range changes nothing it does.
- A 2.x workspace gets its generated skills in a third managed tree, `.agents`, next to
  `.opencode` and `openspec/`.
- A user installing 2.x while offline sees the skills installer's network failure during `init`;
  the factory surfaces it instead of hiding it.
- The plugin bundle embeds the protected path list, so `templates/plugin/factory-plugin.txt` must
  be rebuilt whenever that list moves.
