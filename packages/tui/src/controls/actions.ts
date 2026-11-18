/**
 * The remaining run controls: abort, retry and resume. Only abort has a confirmation; the
 * functions here are pure, and `entry.tsx` performs the effect the confirmation emits.
 */
import type { KeyInput } from "../model/keys.ts";
import type { PanelView, ViewModel } from "../model/view-model.ts";
import { keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";

export type ControlAction =
  | { readonly kind: "abort"; readonly id: string }
  | { readonly kind: "retry"; readonly id: string; readonly taskId: string }
  | { readonly kind: "resume"; readonly id: string };

/** The abort confirmation for the selected run; null when the run cannot be aborted. */
export function confirmFor(viewModel: ViewModel): ControlAction | null {
  const run = viewModel.run;
  if (run === null) return null;
  if (run.phase === "done" || run.phase === "aborted") return null;
  return { kind: "abort", id: run.id };
}

/** `t` is offered only for a failed task; the selected task is the one the detail shows. */
export function retryFor(viewModel: ViewModel): ControlAction | null {
  const run = viewModel.run;
  if (run === null) return null;
  const task = run.detail?.task ?? run.tasks.find((row) => row.selected);
  if (task === undefined || task.status !== "failed") return null;
  return { kind: "retry", id: run.id, taskId: task.id };
}

/** Paused, aborted and queued runs resume; approve only leaves its run queued. */
export function resumeFor(viewModel: ViewModel): ControlAction | null {
  const run = viewModel.run;
  if (run === null) return null;
  return run.phase === "paused" || run.phase === "aborted" || run.phase === "queued"
    ? { kind: "resume", id: run.id }
    : null;
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake and approval titles.
  return glyphs.bullet === "-" ? "-" : "—";
}

/** The confirmation panel; only abort reaches it in the UI, the other kinds stay available. */
export function confirmPanel(action: ControlAction, glyphs: GlyphSet): PanelView {
  switch (action.kind) {
    case "abort":
      return {
        kind: "confirm",
        title: `Abort ${action.id}?`,
        lines: [
          `change: ${action.id}`,
          "branches and worktrees are kept",
          "the driver stops at its next safe point",
        ],
        keys: [keyHint("Enter", "confirm"), keyHint("Esc", "cancel")],
        notice: null,
      };
    case "retry":
      return {
        kind: "confirm",
        title: `Retry ${action.taskId}?`,
        lines: [
          `change: ${action.id}`,
          `task: ${action.taskId}`,
          "the failed task is requeued with a fresh retry budget",
        ],
        keys: [keyHint("Enter", "confirm"), keyHint("Esc", "cancel")],
        notice: null,
      };
    case "resume":
      return {
        kind: "confirm",
        title: `Resume ${action.id}?`,
        lines: [
          `change: ${action.id}`,
          `the detached child runs resume ${dash(glyphs)} the UI keeps its view`,
        ],
        keys: [keyHint("Enter", "confirm"), keyHint("Esc", "cancel")],
        notice: null,
      };
    default: {
      const unhandled: never = action;
      throw new Error(`unknown control action: ${String(unhandled)}`);
    }
  }
}

/** Enter and y confirm; Esc and n cancel; every other key does nothing. */
export function confirmKeys(input: string, key: KeyInput): "confirm" | "cancel" | "none" {
  if (key.return || (!key.ctrl && input === "y")) return "confirm";
  if (key.escape || (!key.ctrl && input === "n")) return "cancel";
  return "none";
}
