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

export type Intent =
  | { kind: "none" }
  | { kind: "quit" }
  | { kind: "help" }
  | { kind: "open-run"; runId: string }
  | { kind: "back" }
  | { kind: "next-run" }
  | { kind: "prev-run" }
  | { kind: "next-task" }
  | { kind: "prev-task" }
  | { kind: "open-intake" }
  | { kind: "approve" }
  | { kind: "approve-only" }
  | { kind: "reword" }
  | { kind: "reapprove" }
  | { kind: "resume" }
  | { kind: "abort" }
  | { kind: "retry" }
  | { kind: "open-questions" };

function listIntent(viewModel: ViewModel, key: string): Intent {
  switch (key) {
    case "n":
      return { kind: "open-intake" };
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
    default:
      return { kind: "none" };
  }
}

function runIntent(key: string): Intent {
  switch (key) {
    case "Esc":
    case "\u001b":
      return { kind: "back" };
    case "Down":
    case "j":
      return { kind: "next-task" };
    case "Up":
    case "k":
      return { kind: "prev-task" };
    case "a":
      return { kind: "approve" };
    case "A":
      return { kind: "approve-only" };
    case "w":
      return { kind: "reword" };
    case "R":
      return { kind: "reapprove" };
    case "r":
      return { kind: "resume" };
    case "x":
      return { kind: "abort" };
    case "t":
      return { kind: "retry" };
    case "Q":
      return { kind: "open-questions" };
    default:
      return { kind: "none" };
  }
}

/** Covers only the list and run keys; panels are dispatched before this. */
export function applyKey(viewModel: ViewModel, key: string): Intent {
  if (viewModel.panel !== null) return { kind: "none" };
  if (key === "q") return { kind: "quit" };
  if (key === "?") return { kind: "help" };
  return viewModel.screen === "list" ? listIntent(viewModel, key) : runIntent(key);
}
