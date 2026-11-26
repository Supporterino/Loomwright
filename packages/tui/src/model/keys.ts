/**
 * Pure key handling for the list and run screens. Panels handle their own keys and receive the
 * same `(input, key)` pair; `entry.tsx` dispatches to them first and falls back to `applyKey`.
 * An intent is advisory: the view-model already says which actions apply and the caller re-checks.
 */
import type { ViewModel } from "./view-model.ts";

/** The subset of Ink's `useInput` key object the pure modules accept (no Ink import needed). */
export interface KeyInput {
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly return: boolean;
  readonly escape: boolean;
  readonly tab: boolean;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly pageUp: boolean;
  readonly pageDown: boolean;
  readonly delete: boolean;
  readonly backspace: boolean;
}

/**
 * Ink names the physical Backspace key (DEL, `\x7f`) `delete`, not `backspace`; accept both, since
 * `\b` and a terminal that sends the classic name still report `backspace`.
 */
export function deletesLast(key: Pick<KeyInput, "backspace" | "delete">): boolean {
  return key.backspace || key.delete;
}

export type Intent =
  | { kind: "none" }
  | { kind: "quit" }
  | { kind: "help" }
  | { kind: "open-run"; runId: string }
  | { kind: "back" }
  | { kind: "clear-task" }
  | { kind: "next-run" }
  | { kind: "prev-run" }
  | { kind: "next-task" }
  | { kind: "prev-task" }
  | { kind: "page-up" }
  | { kind: "page-down" }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "resume" }
  | { kind: "abort" }
  | { kind: "retry" }
  | { kind: "land" }
  | { kind: "open-diff" }
  | { kind: "open-questions" }
  | { kind: "open-activity" };

function listIntent(viewModel: ViewModel, key: string): Intent {
  switch (key) {
    case "Enter":
    case "\r":
      return viewModel.selectedRunId === null
        ? { kind: "none" }
        : { kind: "open-run", runId: viewModel.selectedRunId };
    case "Down":
    case "j":
      return { kind: "next-run" };
    case "Up":
    case "k":
      return { kind: "prev-run" };
    case "PgUp":
      return { kind: "page-up" };
    case "PgDn":
      return { kind: "page-down" };
    case "g":
      return { kind: "first" };
    case "G":
      return { kind: "last" };
    default:
      return { kind: "none" };
  }
}

function runIntent(viewModel: ViewModel, key: string): Intent {
  switch (key) {
    case "Esc":
    case "\u001b":
      // One pane drills into the task detail; Esc steps back to the graph first.
      return viewModel.run?.selectedTaskId == null ? { kind: "back" } : { kind: "clear-task" };
    case "Down":
    case "j":
      return { kind: "next-task" };
    case "Up":
    case "k":
      return { kind: "prev-task" };
    case "PgUp":
      return { kind: "page-up" };
    case "PgDn":
      return { kind: "page-down" };
    case "g":
      return { kind: "first" };
    case "G":
      return { kind: "last" };
    case "r":
      return { kind: "resume" };
    case "x":
      return { kind: "abort" };
    case "t":
      return { kind: "retry" };
    case "d":
      return { kind: "open-diff" };
    case "l":
      return { kind: "land" };
    case "Q":
      return { kind: "open-questions" };
    case "L":
      return { kind: "open-activity" };
    default:
      return { kind: "none" };
  }
}

/** Covers only the list and run keys; panels are dispatched before this. */
export function applyKey(viewModel: ViewModel, key: string): Intent {
  if (viewModel.panel !== null) return { kind: "none" };
  if (key === "q") return { kind: "quit" };
  if (key === "?") return { kind: "help" };
  return viewModel.screen === "list" ? listIntent(viewModel, key) : runIntent(viewModel, key);
}
