# Design: the factory TUI

## Context

The event stream (`docs/decisions/0046-typed-event-stream.md`) gives one typed source for
progress, and `Factory` gives read methods (`status`, `listRuns`, `events`) plus write methods.
Today the only consumer is text: `status --watch` reprints a frame after each event, and
`events --follow` prints JSONL. The request is a terminal UI that watches and controls runs without
changing pipeline behaviour. The one gap in the data is the spec hash while a change waits for
approval: `approval.requested` is emitted inside `approve`, after the decision, and the spec file
is not committed before it, so the stream has neither the hash nor a commit at
`awaiting-approval`.

The published bundle is a self-contained Node file (`packages/cli/dist/cli.js`) with no runtime
dependencies, and `--version` is the startup path every user pays for. The CLI's Node floor is
20.3 (`packages/cli/package.json`), which is the binding constraint on the UI framework.

## Decisions

### 1. Framework: Ink 6.4.0 with React 19.3.1, pinned

Ink gives flexbox layout, focus-free rendering and a testable component tree on Node without native
addons. Ink 7 and 8 declare `engines.node >= 22`, which would break the Node 20.3 acceptance, so
the change pins Ink `6.4.0` (declared `>= 20`) and React `19.3.1` (Ink 6's peer range). Rejected:
`blessed`/`neo-blessed` (unmaintained, CommonJS globals), a hand-rolled renderer (a second layout
engine to maintain and no reflow on resize), and Ink 8 (Node 22 floor).

The stack is bundled into one file, so its indirect dependencies land in the tarball too
(`yoga-layout` with an inlined wasm build, and `ws`, which Ink only uses for React DevTools). The
first bundling task MUST prove `node dist/cli.js tui --replay <fixture> --once` on Node 20.3 before
any screen work; if Ink cannot run there, the task pauses and reports instead of switching
frameworks, as requested.

### 2. A private workspace and a second, lazily loaded bundle

`packages/tui` is `@loomwright/tui`, private, with subpath exports to `src` like `core`, and only
`core`, `protocol`, `ink` and `react` as dependencies. The build adds one step:
`bun build packages/tui/src/entry.tsx --target=node --outfile packages/cli/dist/tui.js`. The `tui`
command imports it through a runtime `import()` of `./tui.js` resolved from `import.meta.url`, with
a fallback to `@loomwright/tui/entry` when the sibling file does not exist (running from source), so
Bun cannot statically pull Ink into `cli.js`. Labels and help text that both sides need live in
`packages/tui/src/strings.ts`, which is small enough to bundle eagerly.

Rejected: one bundle (every command pays the framework's startup cost and the tarball carries Ink
unconditionally), and shipping `node_modules` (breaks the self-contained tarball and offline use).

### 3. Data flow: `reduce` over the stream, facts from the read API

The view-model is a pure function of `(RunSnapshot, StatusDocument slice, RunState summary)`. It is
rebuilt from `readEvents` on open and then from `tailEvents` from `lastSeq + 1`. Run existence,
phase, summary, draft, lock, queue position and usage come from `status()`/`listRuns()`; gates,
agent roles, retries and activity come from events. No run-state or event file under `.factory/` is
read — the exceptions are the launcher's own `.factory/logs/tui-spawn-<ts>.log`, tailed only to
show a failed child's last lines, and the intake dialog's `.factory/requests/*.md` files, read only
to rank, validate and preview a request — and no pipeline, scheduler, gate or state module is
value-imported (type-only imports from `core` are fine), so the UI cannot drift from the engine's
own rules.

`approval.pending` is projected into `RunSnapshot.pendingApproval` rather than scanned in the UI, so
the overlay reads one object and older streams simply have `null`. Parity is unaffected: the parity
check compares a fixed field list and `pendingApproval` is not in it.

### 4. No in-process pipeline: detached children behind a `Launcher`

`Factory.run`, `Factory.approve` with continue and `Factory.resume` block for a whole phase, take
the driver lock and install SIGINT/SIGTERM when no signal is passed. Calling them from the UI would
tie a run to the UI's lifetime, so every long action is a detached child of the same CLI entry:
`process.execPath` + `process.argv[1]`, argv `["-C", workspace, command, …]`, `cwd` the workspace,
`detached: true`, `stdio: ["ignore", fd, fd]`, `unref()`, output in
`.factory/logs/tui-spawn-<ts>.log`. The launcher is injected, so tests assert argv and options
without a process.

`abort` and `retry` stay in-process: they write run state and drop a command, take no lock and
return immediately. `answer` writes the command inbox. `resume` is a child, because it drives a
phase. `pause` exists in the command API but is not exposed as a control in this change.

### 5. The approval overlay is phase-driven, and the hash arrives first

The overlay keys off `phase === "awaiting-approval"` from `status()`, because `approval.requested`
only exists after `approve` ran. The missing hash is supplied by one additive event,
`approval.pending`, emitted by design where it sets the phase. It carries `specHash` (the same
`specHash(dir, id)` that `approve` records) and the workspace-relative `changeDir`; it carries no
commit, because inventing one would invite the UI to show a commit that does not exist.
`approval.requested`/`approval.granted` remain the only authority for the spec commit and approver.

Rejected: reading `.factory/approvals/<id>.json` (it does not exist yet), re-implementing the hash in
the UI (it normalises task checkboxes and would drift), and parsing the spec (the request forbids it).

### 6. Action gating uses the evidence the read API already has

`w` needs `specFindings` (run state). `R` needs a spec commit to name in its confirmation, so it is
offered only when the stream carries `approval.granted` for that run. A run state marker for "the
spec was edited after approval" does not exist, and adding one is out of scope for this change, so
the UI never claims an edit it cannot see; this is recorded as a risk, not guessed at.
Actions that record an approval (`a`, `A`, `R`) are disabled when `git config user.email` is empty,
with the same message the CLI prints.

### 7. One renderer, testable seams

Ink renders a `ViewModel`; there is no second text renderer to drift. `--once` renders the same tree
into an in-memory stdout (`columns`/`rows` set, `isTTY: false`), collects the text, writes it through
`io.out` and exits `0`; interactive mode renders to `process.stdout`. Frame snapshots come from that
same path at 80×24 and 120×40. Keys are handled by a pure `applyKey(viewModel, key) → intent` so
keybinding tests need no terminal. A `TerminalSession` seam owns alternate screen, cursor and raw
mode, so "quit restores the terminal" is asserted against a fake stream.

### 8. Brand tokens without a new hue

One module exports each token in truecolor, 256 and 16-colour variants: lilac `#8E9BEA` for focus and
running, coral `#E0714F` for the approval gate only, and the default foreground for everything else.
No background is painted. failed, blocked and passed differ by glyph, label and weight. The palette
is sufficient; no token addition is proposed.

### 9. Budgets are part of the contract

10 frames per second maximum with event batching, a 2,000-line ring buffer, and `status()` at most
once a second plus immediately after a spawn. The soak test feeds 100,000 events and asserts the
buffer cap, bounded retained state and a frame within the timeout.

### 10. CI replays a checked-in fixture

`--once` is the only TUI path that can run in CI. The `package` job uploads a second artifact with
`test/fixtures/tui/approval-gate.jsonl` (a prefix of the regenerated `single` golden, ending at the
approval gate) and `node-smoke` downloads it next to `dist/`, so no source tree and no tarball entry
are needed. Rejected: shipping the fixture in the tarball (it would grow the published package for a
test).

### 11. `monorepo-layout` keeps its requirement title

The "three packages" requirement is rewritten as four packages but keeps its header text, because
OpenSpec matches a `MODIFIED` requirement by its header. Renaming it would need a `REMOVED` + `ADDED`
pair; that cleanup is left to a later change and recorded as a follow-up.

## Contract changes

None configured (no API schema, event bus or Helm value). The internal event protocol gains one
additive type and one nullable snapshot field; `PROTOCOL_VERSION` stays `1`, and a reader that does
not know the type skips it. `docs/events.md` documents the type, its payload and its place in the
approval family. The published tarball gains `package/dist/tui.js`.

## Risks

- **Ink on Node 20.3 is unproven.** Ink 6 declares `>= 20`, but `chalk@5` declares a narrower floor
  and `yoga-layout` ships a wasm build that must survive bundling. The bundling task proves the
  rendered `--once` frame on 20.3 and pauses if it fails; it does not switch frameworks.
- **Tarball growth.** Ink, React, the reconciler and `yoga-layout` land in `dist/tui.js`, likely a
  few hundred kilobytes. The delta is measured in the first build task and reported; anything over
  1 MB must be justified, and `ws` (Ink's DevTools dependency) is the part to explain.
- **`tsconfig.json` gains `"jsx": "react-jsx"`, a `@loomwright/tui/*` path mapping and a
  `@types/react` dependency.** That is a repo-wide compiler option and a gate input, though not a
  protected file; the task keeps the change to those entries and the gate stays green.
- **`scripts.build` is edited** (appended step before `write-dist-package`). `build` is not one of
  the four gate scripts, and `test/publish.test.ts` pins the `startsWith`/`contains`/`endsWith`
  shape the new step preserves.
- **Goldens are re-recorded.** Adding an event invalidates `packages/cli/test/fixtures/events/*`;
  the task re-runs the capture and commits normalised fixtures, with baseline stdout unchanged
  because the terminal sink prints nothing for the new type.
- **`R` is offered only when a spec commit is known**, which is narrower than "the spec was edited".
  Detecting an edit needs a run-state marker this change does not add; recorded as a follow-up.
- **Question prompt semantics.** "An `unanswered` one opens an answer prompt" is implemented as: the
  questions pane opens the prompt directly for an unanswered record, rather than stealing focus while
  the stream is live. Recorded here as the narrow reading.
- **`--once` depends on Ink accepting a non-TTY stdout.** If a frame still carries cursor control,
  the replay task strips it at the boundary and asserts no `\x1b[` sequence remains; the screenshot
  tests then cover the plain text.
- **The ADR must stay name-free** (the historical scan covers `docs/decisions/`), which constrains
  its wording.
- **Touches overlap on the entry.** Tasks 1.4-1.8 all touch `packages/tui/src/entry.tsx`; the
  chain is sequential by `deps`, so they never run concurrently.
