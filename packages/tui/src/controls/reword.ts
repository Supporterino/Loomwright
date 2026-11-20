/**
 * The reword panel: one pure state machine and one panel builder. Nothing here opens the
 * factory or spawns a child; `entry.tsx` turns the emitted launch into a detached launcher call.
 * Availability is never re-derived here: `run.reword` is the single predicate.
 */
import { stripControls } from "../model/format.ts";
import type { KeyInput } from "../model/keys.ts";
import type { PanelView, RunDetail, SpecFindingRow } from "../model/view-model.ts";
import { clampOffset, pageSize, sliceWindow, window as windowOf } from "../model/viewport.ts";
import { keyHint } from "../strings.ts";
import { type GlyphSet, UNICODE_GLYPHS } from "../theme/glyphs.ts";

/** The prompt is required only when the run has no findings to reword by number. */
export const REWORD_PROMPT_REQUIRED = "the prompt is required";

export interface RewordFailure {
  readonly code: number;
  readonly lines: readonly string[];
  readonly logPath: string | null;
}

export interface RewordState {
  /** The prompt, newlines included. */
  readonly text: string;
  /** Body scroll (findings, prompt and confirm line). */
  readonly offset: number;
  /** "the prompt is required", or the in-flight child's spawn log. */
  readonly notice: string | null;
  readonly failure: RewordFailure | null;
}

export const initialReword: RewordState = {
  text: "",
  offset: 0,
  notice: null,
  failure: null,
};

/** Null when the key is inert or absent; the caller shows the reason instead. */
export function openReword(run: RunDetail): RewordState | null {
  return run.reword.state === "available" ? { ...initialReword } : null;
}

export interface RewordOutcome {
  readonly state: RewordState;
  /** Set only when the caller should launch; the launcher builds the argv. */
  readonly launch?: { readonly prompt?: string };
  readonly close?: boolean;
}

function findingLocation(finding: SpecFindingRow): string {
  // A line without a file cannot be named; `:42` alone would point nowhere.
  if (finding.file === null) return "";
  return finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
}

/** Hard chunks of at most `width` code points, so no emitted segment is truncated by Ink. */
function chunks(text: string, width: number): string[] {
  const points = Array.from(text);
  if (points.length === 0) return [""];
  const out: string[] = [];
  for (let at = 0; at < points.length; at += width) {
    out.push(points.slice(at, at + width).join(""));
  }
  return out;
}

/**
 * A labelled value wrapped to whole lines: `   problem: first chunk`, then continuations under
 * the label. The emitted line stays within `max(20, columns - 6)`, inside the panel's padding.
 */
function wrapped(prefix: string, text: string, columns: number): string[] {
  const width = Math.max(1, Math.max(20, columns - 6) - prefix.length);
  return chunks(text, width).map(
    (chunk, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${chunk}`,
  );
}

function promptLines(text: string, columns: number): string[] {
  return text
    .split("\n")
    .flatMap((line, index) => wrapped(index === 0 ? "prompt> " : "  ", line, columns));
}

/**
 * The confirm line: always the `reword <id> --prompt <text>` template, with the typed prompt
 * substituted (first line only, then an ellipsis) once it is non-empty. The ASCII frame gets
 * `...`, because Ink is not the one deciding here.
 */
export function rewordArgvLine(
  run: RunDetail,
  text: string,
  glyphs: GlyphSet = UNICODE_GLYPHS,
): string {
  const trimmed = text.trim();
  if (trimmed === "") return `reword ${run.id} --prompt <text>`;
  const [first = "", ...rest] = trimmed.split("\n");
  const mark = glyphs.bullet === "-" ? "..." : "…";
  return `reword ${run.id} --prompt ${rest.length === 0 ? first : `${first}${mark}`}`;
}

function findingLines(finding: SpecFindingRow, index: number, columns: number): string[] {
  const location = findingLocation(finding);
  const header = `${index + 1}. ${finding.severity}${location === "" ? "" : `  ${location}`}`;
  return [
    header,
    ...wrapped("   problem: ", finding.problem, columns),
    ...wrapped("   fix: ", finding.fix, columns),
  ];
}

function bodyLines(
  run: RunDetail,
  state: RewordState,
  columns: number,
  glyphs: GlyphSet = UNICODE_GLYPHS,
): string[] {
  return [
    ...run.specFindings.flatMap((finding, index) => findingLines(finding, index, columns)),
    ...promptLines(state.text, columns),
    rewordArgvLine(run, state.text, glyphs),
  ];
}

function failureLines(failure: RewordFailure | null): string[] {
  if (failure === null) return [];
  return [
    `exited with code ${failure.code}`,
    ...(failure.logPath === null ? [] : [`spawn log: ${failure.logPath}`]),
    ...failure.lines,
  ];
}

/** Rows the panel chrome spends: border, title, keys row and the frame's footer. */
const PANEL_CHROME_ROWS = 5;

/** The body rows left after chrome, the notice and the failure block. Never zero. */
function bodyRows(rows: number, state: RewordState): number {
  const noticeRows = state.notice === null ? 0 : state.notice.split("\n").length;
  return Math.max(1, rows - PANEL_CHROME_ROWS - noticeRows - failureLines(state.failure).length);
}

function move(
  run: RunDetail,
  state: RewordState,
  delta: number,
  rows: number,
  columns: number,
): RewordState {
  const length = bodyLines(run, state, columns).length;
  const offset = clampOffset(state.offset + delta, length, bodyRows(rows, state));
  return offset === state.offset ? state : { ...state, offset };
}

/** Deletes one code point, so an emoji typed into the prompt is removed whole. */
function removeLast(state: RewordState): RewordState {
  return {
    ...state,
    text: Array.from(state.text).slice(0, -1).join(""),
    notice: null,
  };
}

/**
 * One keypress against the panel; effects never happen here. Scrolling is non-printable only
 * (arrows, PgUp/PgDn): bare `j` and `k` must type into the prompt, unlike the log pane.
 */
export function rewordKeys(
  run: RunDetail,
  state: RewordState,
  input: string,
  key: KeyInput,
  rows: number,
  columns = 80,
): RewordOutcome {
  if (key.escape) return { state, close: true };

  if (key.return) {
    const prompt = state.text.trim();
    if (run.specFindings.length === 0 && prompt === "") {
      return { state: { ...state, notice: REWORD_PROMPT_REQUIRED } };
    }
    return { state, launch: prompt === "" ? {} : { prompt } };
  }

  if (key.upArrow) return { state: move(run, state, -1, rows, columns) };
  if (key.downArrow) return { state: move(run, state, 1, rows, columns) };
  if (key.pageUp) {
    return { state: move(run, state, -pageSize(bodyRows(rows, state)), rows, columns) };
  }
  if (key.pageDown) {
    return { state: move(run, state, pageSize(bodyRows(rows, state)), rows, columns) };
  }

  if (key.ctrl && (input === "j" || input === "\n")) {
    return { state: { ...state, text: `${state.text}\n`, notice: null } };
  }
  if (key.backspace) return { state: removeLast(state) };
  // Other chords, tabs and editing keys stay inert; every other printable key types.
  if (key.ctrl || key.meta || key.tab || key.delete) return { state };
  // A paste arrives as one string; its embedded controls must never reach the terminal.
  const typed = stripControls(input);
  if (typed.length === 0) return { state };
  return { state: { ...state, text: state.text + typed, notice: null } };
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake and approval titles.
  return glyphs.bullet === "-" ? "-" : "—";
}

function scrollKey(glyphs: GlyphSet): string {
  return glyphs.bullet === "-" ? "Up/Down PgUp/PgDn" : "↑/↓ PgUp/PgDn";
}

function keysFor(run: RunDetail, state: RewordState, glyphs: GlyphSet): PanelView["keys"] {
  const missingPrompt = run.specFindings.length === 0 && state.text.trim() === "";
  const confirm = missingPrompt
    ? {
        key: "Enter",
        label: "confirm",
        enabled: false,
        reason: REWORD_PROMPT_REQUIRED,
      }
    : keyHint("Enter", "confirm");
  return [
    keyHint("Ctrl-J", "newline"),
    confirm,
    keyHint("Esc", "back"),
    keyHint(scrollKey(glyphs), "scroll"),
  ];
}

export interface RewordPanelInput {
  readonly run: RunDetail;
  readonly state: RewordState;
  readonly glyphs: GlyphSet;
  readonly rows: number;
  readonly columns: number;
}

/** Findings in run-state order, the multi-line prompt, the confirm argv and the failure block. */
export function rewordPanel(input: RewordPanelInput): PanelView {
  const { run, state, glyphs, rows, columns } = input;
  const body = bodyLines(run, state, columns, glyphs);
  const size = bodyRows(rows, state);
  const shown = sliceWindow(
    body,
    windowOf(clampOffset(state.offset, body.length, size), body.length, size),
  );
  return {
    kind: "reword",
    title: `Reword ${dash(glyphs)} ${run.id}`,
    lines: [...shown, ...failureLines(state.failure)],
    keys: keysFor(run, state, glyphs),
    notice: state.notice,
  };
}
