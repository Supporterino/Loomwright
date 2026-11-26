/**
 * The diff pane: one pure state machine and one panel builder. It renders a `ChangeDiff` it was
 * handed, so replay and live share every path and nothing here reads git or the workspace.
 */
import type { ChangeDiff, DiffRepoResult } from "@loomwright/core/pipeline/diff";
import { stripControls } from "../model/format.ts";
import type { KeyInput } from "../model/keys.ts";
import type { PanelView } from "../model/view-model.ts";
import {
  clampOffset,
  firstOffset,
  lastOffset,
  pageSize,
  sliceWindow,
  window as windowOf,
} from "../model/viewport.ts";
import { diffTitle, keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";

export interface DiffPaneState {
  readonly id: string;
  readonly lines: readonly string[];
  readonly offset: number;
}

/** Rows the panel chrome spends: footer, two borders, title and the keys row. */
const PANE_CHROME_ROWS = 5;

/** The body rows a pane of `rows` terminal rows may use; never zero so a short pane still scrolls. */
export function diffPaneBodyRows(rows: number): number {
  return Math.max(1, rows - PANE_CHROME_ROWS);
}

function header(repo: DiffRepoResult): string {
  return `${repo.repo}: ${repo.target} <- ${repo.branch} (${repo.status})`;
}

/**
 * git ends a patch with a newline; the trailing empty row belongs to no line. The patch text is
 * untrusted, so each line drops the terminal controls that would clear the screen or set the
 * clipboard in a live frame.
 */
function patchLines(patch: string): string[] {
  if (patch === "") return [];
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map(stripControls);
}

/** Flatten one header line per repo plus its patch, or `no change branch` for a missing one. */
export function diffLines(diff: ChangeDiff): string[] {
  const lines: string[] = [];
  for (const repo of diff.repos) {
    if (repo.status === "missing") {
      lines.push(`${repo.repo}: no change branch`);
      continue;
    }
    lines.push(header(repo));
    lines.push(...patchLines(repo.patch));
  }
  return lines;
}

export function openDiffPane(diff: ChangeDiff): DiffPaneState {
  return { id: diff.id, lines: diffLines(diff), offset: 0 };
}

export interface DiffPanePanelInput {
  readonly state: DiffPaneState;
  readonly glyphs: GlyphSet;
  /** Terminal rows; the panel subtracts its own chrome and the frame's footer. */
  readonly rows: number;
}

/** The pane's title dash, kept printable ASCII when the ASCII glyph set is active. */
function dash(glyphs: GlyphSet): string {
  return glyphs.bullet === "-" ? "-" : "—";
}

/** The visible slice of the flattened diff, already narrowed to the body's row budget. */
export function diffPanePanel(input: DiffPanePanelInput): PanelView {
  const { state, glyphs, rows } = input;
  const bodyRows = diffPaneBodyRows(rows);
  const offset = clampOffset(state.offset, state.lines.length, bodyRows);
  const shown = sliceWindow(state.lines, windowOf(offset, state.lines.length, bodyRows));
  // The generic PanelBox renders exactly its lines; padding lets the pane own the full body height.
  const body = [...shown, ...Array<string>(bodyRows - shown.length).fill(" ")];
  return {
    kind: "diff",
    title: diffTitle(dash(glyphs), state.id),
    lines: body,
    keys: [
      keyHint("j/k", "scroll"),
      keyHint("PgUp/PgDn", "page"),
      keyHint("g/G", "ends"),
      keyHint("Esc", "back"),
    ],
    notice: null,
  };
}

export interface DiffPaneOutcome {
  readonly state: DiffPaneState;
  readonly close?: boolean;
}

/** j/k, arrows, PgUp/PgDn, g/G and Esc. `size` is the body height in rows. */
export function diffPaneKeys(
  state: DiffPaneState,
  input: string,
  key: KeyInput,
  size: number,
): DiffPaneOutcome {
  if (key.escape) return { state, close: true };

  const length = state.lines.length;
  const height = Math.max(1, size);
  const current = clampOffset(state.offset, length, height);

  if (key.downArrow || (!key.ctrl && input === "j")) {
    return { state: { ...state, offset: clampOffset(current + 1, length, height) } };
  }
  if (key.upArrow || (!key.ctrl && input === "k")) {
    return { state: { ...state, offset: clampOffset(current - 1, length, height) } };
  }
  if (key.pageDown) {
    return { state: { ...state, offset: clampOffset(current + pageSize(height), length, height) } };
  }
  if (key.pageUp) {
    return { state: { ...state, offset: clampOffset(current - pageSize(height), length, height) } };
  }
  if (!key.ctrl && input === "g") {
    return { state: { ...state, offset: firstOffset(length) } };
  }
  if (!key.ctrl && input === "G") {
    return { state: { ...state, offset: lastOffset(length, height) } };
  }
  return { state };
}
