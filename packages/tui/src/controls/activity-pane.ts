/**
 * The activity log pane: one pure state machine and one panel builder. It reads only the
 * `RunDetail` the view-model already built, so replay and live share every path and nothing here
 * launches or writes.
 */
import { linesInScope, type ScopeTask } from "../model/activity-scope.ts";
import type { KeyInput } from "../model/keys.ts";
import type { ActivityLine, PanelView, RunDetail } from "../model/view-model.ts";
import {
  clampOffset,
  firstOffset,
  followOffset,
  lastOffset,
  pageSize,
  sliceWindow,
  type Window,
  window as windowOf,
} from "../model/viewport.ts";
import { keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";

export type PaneScope = "run" | "task" | "repo";

export interface ActivityPaneState {
  readonly scope: PaneScope;
  /** The task the task/repo scopes name; null for the run scope. */
  readonly taskId: string | null;
  readonly offset: number;
  readonly follow: boolean;
}

/** Rows the panel chrome spends: footer, two borders, title and the keys row. */
const PANE_CHROME_ROWS = 5;

/** The body rows a pane of `rows` terminal rows may use; never zero so a short pane still scrolls. */
export function activityPaneBodyRows(rows: number): number {
  return Math.max(1, rows - PANE_CHROME_ROWS);
}

function paneState(scope: PaneScope, taskId: string | null): ActivityPaneState {
  return { scope, taskId, offset: 0, follow: true };
}

function taskFor(run: RunDetail, taskId: string | null) {
  return taskId === null ? undefined : run.tasks.find((task) => task.id === taskId);
}

function scopeTasks(run: RunDetail): ScopeTask[] {
  return run.tasks.map(({ id, repo }) => ({ id, repo }));
}

/** The scope the pane opens in: the selected task's, else the run's. */
export function openActivityPane(run: RunDetail): ActivityPaneState {
  const task = taskFor(run, run.selectedTaskId);
  return task === undefined ? paneState("run", null) : paneState("task", task.id);
}

/** run → task → repo → run, skipping a scope the run cannot name. */
export function cycleScope(run: RunDetail, state: ActivityPaneState): ActivityPaneState {
  switch (state.scope) {
    case "run": {
      // A run with tasks but no selection (the 80-column case) still reaches the task scope.
      const task = taskFor(run, run.selectedTaskId ?? run.tasks[0]?.id ?? null);
      return task === undefined ? state : { ...state, scope: "task", taskId: task.id };
    }
    case "task": {
      const task = taskFor(run, state.taskId);
      if (task === undefined || task.repo === "") {
        return { ...state, scope: "run", taskId: null };
      }
      return { ...state, scope: "repo", taskId: task.id };
    }
    case "repo":
      return { ...state, scope: "run", taskId: null };
    default: {
      const unhandled: never = state.scope;
      throw new Error(`unknown pane scope: ${String(unhandled)}`);
    }
  }
}

/** The lines of the current scope, via `linesInScope` (never a local filter). */
export function scopeLines(run: RunDetail, state: ActivityPaneState): readonly ActivityLine[] {
  const tasks = scopeTasks(run);
  switch (state.scope) {
    case "run":
      return linesInScope(tasks, run.activity, { kind: "run" });
    case "task":
      return state.taskId === null
        ? []
        : linesInScope(tasks, run.activity, { kind: "task", taskId: state.taskId });
    case "repo": {
      const task = taskFor(run, state.taskId);
      if (task === undefined || task.repo === "") return [];
      return linesInScope(tasks, run.activity, { kind: "repo", repo: task.repo });
    }
    default: {
      const unhandled: never = state.scope;
      throw new Error(`unknown pane scope: ${String(unhandled)}`);
    }
  }
}

function scopeName(run: RunDetail, state: ActivityPaneState): string {
  switch (state.scope) {
    case "run":
      return "run";
    case "task":
      return state.taskId ?? "run";
    case "repo": {
      const task = taskFor(run, state.taskId);
      return task === undefined || task.repo === "" ? "repo" : task.repo;
    }
    default: {
      const unhandled: never = state.scope;
      throw new Error(`unknown pane scope: ${String(unhandled)}`);
    }
  }
}

/** Follow pins to the newest line; otherwise the stored offset is only clamped. */
export function paneWindow(state: ActivityPaneState, length: number, size: number): Window {
  return windowOf(followOffset(state.offset, length, size, state.follow), length, size);
}

export interface ActivityPaneOutcome {
  readonly state: ActivityPaneState;
  readonly close?: boolean;
}

/** j/k, arrows, PgUp/PgDn, g/G, f, Tab and Esc. `size` is the body height in rows. */
export function activityPaneKeys(
  run: RunDetail,
  state: ActivityPaneState,
  input: string,
  key: KeyInput,
  size: number,
): ActivityPaneOutcome {
  if (key.escape) return { state, close: true };
  if (key.tab) return { state: cycleScope(run, state) };

  const length = scopeLines(run, state).length;
  const height = Math.max(1, size);
  const current = followOffset(state.offset, length, height, state.follow);

  if (!key.ctrl && input === "f") {
    const follow = !state.follow;
    return {
      state: {
        ...state,
        follow,
        // Turning follow off keeps the visible window; turning it on lands on the newest line.
        offset: follow ? lastOffset(length, height) : current,
      },
    };
  }
  if (key.downArrow || (!key.ctrl && input === "j")) {
    return {
      state: { ...state, follow: false, offset: clampOffset(current + 1, length, height) },
    };
  }
  if (key.upArrow || (!key.ctrl && input === "k")) {
    return {
      state: { ...state, follow: false, offset: clampOffset(current - 1, length, height) },
    };
  }
  if (key.pageDown) {
    return {
      state: {
        ...state,
        follow: false,
        offset: clampOffset(current + pageSize(height), length, height),
      },
    };
  }
  if (key.pageUp) {
    return {
      state: {
        ...state,
        follow: false,
        offset: clampOffset(current - pageSize(height), length, height),
      },
    };
  }
  if (!key.ctrl && input === "g") {
    return { state: { ...state, follow: false, offset: firstOffset(length) } };
  }
  if (!key.ctrl && input === "G") {
    return { state: { ...state, follow: false, offset: lastOffset(length, height) } };
  }
  return { state };
}

/** The one line shape the tail and the pane share: `step • kind • [→ ref ]text`. */
export function activityLineText(line: ActivityLine, glyphs: GlyphSet): string {
  const ref = line.logRef === undefined ? "" : `${glyphs.arrow} ${line.logRef} `;
  return `${line.step} ${glyphs.bullet} ${line.kind} ${glyphs.bullet} ${ref}${line.text}`;
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake and questions titles.
  return glyphs.bullet === "-" ? "-" : "—";
}

export interface ActivityPanePanelInput {
  readonly run: RunDetail;
  readonly state: ActivityPaneState;
  readonly glyphs: GlyphSet;
  /** Terminal rows; the panel subtracts its own chrome and the frame's footer. */
  readonly rows: number;
}

/** The visible slice of the current scope, already narrowed to the body's row budget. */
export function activityPanePanel(input: ActivityPanePanelInput): PanelView {
  const { run, state, glyphs, rows } = input;
  const lines = scopeLines(run, state);
  const bodyRows = activityPaneBodyRows(rows);
  const shown = sliceWindow(lines, paneWindow(state, lines.length, bodyRows)).map((line) =>
    activityLineText(line, glyphs),
  );
  // The generic PanelBox renders exactly its lines; padding lets the pane own the full body height.
  // A single space keeps an empty row from collapsing before the border is drawn.
  const body = [...shown, ...Array<string>(bodyRows - shown.length).fill(" ")];
  return {
    kind: "activity",
    title: `Activity ${dash(glyphs)} ${scopeName(run, state)}`,
    lines: body,
    keys: [
      keyHint("j/k", "scroll"),
      keyHint("PgUp/PgDn", "page"),
      keyHint("g/G", "ends"),
      keyHint("f", state.follow ? "follow on" : "follow off"),
      keyHint("Tab", "scope"),
      keyHint("Esc", "back"),
    ],
    notice: null,
  };
}
