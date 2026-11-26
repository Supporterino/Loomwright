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

/** The land confirmation's central promise: merges happen locally, nothing leaves the machine. */
export const landConfirmNote = "the change branches are merged into their base branches locally";

export function landedNotice(id: string): string {
  return `landed ${id} — the run is gone`;
}

/** The run-list marker beside the id and summary; only shown when there are any findings. */
export function findingsCount(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

/** The run view's words for a run that stopped on spec findings; the view passes the dash. */
export function pausedFindings(dash: string, count: number): string {
  if (count === 1) return `paused ${dash} 1 spec finding needs reword`;
  return `paused ${dash} ${count} spec findings need reword`;
}

/** The diff pane's title; `dash` is the glyph set's dash (`—` or ASCII `-`). */
export function diffTitle(dash: string, id: string): string {
  return `Diff ${dash} ${id}`;
}

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
