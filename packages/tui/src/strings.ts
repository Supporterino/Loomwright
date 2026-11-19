/** Eagerly bundled labels and help: kept free of Ink so the CLI stays light. */
import type { Phase } from "@loomwright/protocol";
import type { KeyHint } from "./model/view-model.ts";

export const TUI_SUMMARY = "Watch and drive runs in the terminal";

/** Phase names as the UI spells them; `awaiting-approval` reads as two words. */
export const LABELS: Readonly<Record<Phase, string>> = {
  intake: "intake",
  design: "design",
  "awaiting-approval": "awaiting approval",
  queued: "queued",
  implementing: "implementing",
  reviewing: "reviewing",
  contracts: "contracts",
  "full-suite": "full suite",
  closing: "closing",
  done: "done",
  paused: "paused",
  aborted: "aborted",
};

export const answerRecorded = "recorded — applies at the next step";

export const emptyWorkspace = "No changes exist yet. Press n to start one.";

export const replayNotice = "Replay — read-only; the workspace is not touched.";

export function keyHint(key: string, label: string): KeyHint {
  return { key, label, enabled: true };
}

export function tuiHelp(): string {
  return `Usage: loomwright tui [--replay <file>] [--once] [--ascii]

Watch and drive runs in the terminal. On a terminal the run list opens, newest first.
Without a terminal use \`status --watch\` or \`events --follow\` instead.

  --replay <file>    Render a recorded event stream instead of a workspace
  --once             Render one frame and exit (requires --replay)
  --ascii            Force the ASCII glyph set

Exit codes: 0 ok, 2 invalid flags or an unreadable --replay file.`;
}
