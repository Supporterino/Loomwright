/**
 * The new-run dialog: one pure state machine and one panel builder. It never opens the factory
 * or spawns anything; `entry.tsx` turns a `submit` into a launch and writes the result back.
 */
import type { StatusDocument } from "@loomwright/core/factory";
import type { LaunchAction } from "../launch/launcher.ts";
import { stripControls } from "../model/format.ts";
import { deletesLast, type KeyInput } from "../model/keys.ts";
import type { PanelView } from "../model/view-model.ts";
import { keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import { checkRequestFile, completePath, type PathCandidate, type RequestFile } from "./paths.ts";

export const QUEUED_NOTE =
  "the change is drafted under .factory/drafts/<id> and queued after approval";

export interface IntakeState {
  readonly mode: "text" | "file";
  readonly text: string;
  readonly path: string;
  readonly candidates: readonly PathCandidate[];
  readonly file: RequestFile | null;
  readonly error: string | null;
  readonly submitting: boolean;
  readonly spawned: {
    readonly logPath: string;
    readonly displayPath: string;
    readonly tail: readonly string[];
  } | null;
  readonly queuedNote: string | null;
}

export interface IntakeContext {
  readonly cwd: string;
  readonly workspace: string;
  readonly status: StatusDocument;
}

export const initialIntake: IntakeState = {
  mode: "text",
  text: "",
  path: "",
  candidates: [],
  file: null,
  error: null,
  submitting: false,
  spawned: null,
  queuedNote: null,
};

interface IntakeOutcome {
  readonly state: IntakeState;
  readonly submit?: LaunchAction;
}

function toggleMode(state: IntakeState, ctx: IntakeContext): IntakeState {
  if (state.mode === "text") {
    return {
      ...state,
      mode: "file",
      candidates: state.path === "" ? [] : completePath(state.path, ctx.cwd),
      error: null,
    };
  }
  return { ...state, mode: "text", error: null };
}

function editFile(state: IntakeState, chunk: string, ctx: IntakeContext): IntakeState {
  const path = state.path + chunk;
  const check = checkRequestFile(path, ctx.cwd);
  return {
    ...state,
    path,
    candidates: completePath(path, ctx.cwd),
    file: check.ok ? check.file : null,
    error: null,
  };
}

function removeLast(state: IntakeState, ctx: IntakeContext): IntakeState {
  if (state.mode === "text") {
    return { ...state, text: state.text.slice(0, -1), error: null };
  }
  const path = state.path.slice(0, -1);
  const check = checkRequestFile(path, ctx.cwd);
  return {
    ...state,
    path,
    candidates: path === "" ? [] : completePath(path, ctx.cwd),
    file: check.ok ? check.file : null,
    error: null,
  };
}

function submit(state: IntakeState, ctx: IntakeContext): IntakeOutcome {
  if (state.submitting) return { state };
  // Factory.open is the only check; entry.tsx writes its rejection into the state, so a later
  // Enter retries and succeeds once `loomwright init` has run.
  const queuedNote = ctx.status.active === null ? state.queuedNote : QUEUED_NOTE;
  if (state.mode === "text") {
    if (state.text.trim() === "") {
      return { state: { ...state, error: "the request is empty" } };
    }
    return {
      state: { ...state, submitting: true, error: null, queuedNote },
      submit: { kind: "run-text", text: state.text },
    };
  }
  const check = checkRequestFile(state.path, ctx.cwd);
  if (!check.ok) return { state: { ...state, file: null, error: check.reason } };
  return {
    state: { ...state, submitting: true, error: null, file: check.file, queuedNote },
    submit: { kind: "run-file", path: check.file.absolute },
  };
}

/** One keypress against the dialog; `submit` is set only when the caller should launch. */
export function intakeKeys(
  state: IntakeState,
  input: string,
  key: KeyInput,
  ctx: IntakeContext,
): IntakeOutcome {
  if (state.submitting && key.return) return { state };
  if (key.tab) return { state: toggleMode(state, ctx) };
  if (key.return) return submit(state, ctx);
  if (key.ctrl && input === "j") {
    return state.mode === "text"
      ? { state: { ...state, text: `${state.text}\n`, error: null } }
      : { state };
  }
  if (deletesLast(key)) return { state: removeLast(state, ctx) };
  if (key.escape) return { state };
  // A paste arrives as one string; its embedded controls must never reach the terminal.
  const typed = stripControls(input);
  if (typed.length === 0) return { state };
  return state.mode === "text"
    ? { state: { ...state, text: state.text + typed, error: null } }
    : { state: editFile(state, typed, ctx) };
}

function title(state: IntakeState, glyphs: GlyphSet): string {
  // The ASCII glyph set is the frame test's mode; keep its title ASCII too.
  const dash = glyphs.bullet === "-" ? "-" : "—";
  return `New change ${dash} ${state.mode}`;
}

/** Rows the box chrome and the footer below it take: two borders, the title, the key line, footer. */
const PANEL_CHROME_ROWS = 5;
/** The chosen file's fixed header: the path, the byte size and the preview's label. */
const PREVIEW_HEADER_ROWS = 3;

/**
 * The typed request split into panel rows. `PanelBox` renders an embedded newline as its own row,
 * so a multi-line paste is windowed like the file preview and names the shown count when it trims.
 */
function requestLines(state: IntakeState, rows: number, trailing: number): string[] {
  if (state.text === "") return ["request: (empty)"];
  // One line keeps the compact form the frame fixtures pin.
  if (!state.text.includes("\n")) return [`request: ${state.text}`];
  const all = state.text.split("\n");
  const room = Math.max(0, rows - PANEL_CHROME_ROWS - trailing);
  if (room === 0) return [];
  const shown = all.slice(0, room - 1);
  const label =
    shown.length < all.length
      ? `request (${shown.length} of ${all.length} lines):`
      : `request (${all.length} lines):`;
  return [label, ...shown.map((line) => `  | ${line}`)];
}

/**
 * The file keeps its first twenty lines; the dialog shows as many as the terminal has room for and
 * names the shown count when it has to trim.
 */
function fileLines(state: IntakeState, glyphs: GlyphSet, rows: number, trailing: number): string[] {
  if (state.file === null) {
    const lines = [`path: ${state.path === "" ? "(type a path)" : state.path}`];
    for (const candidate of state.candidates.slice(0, 8)) {
      const marker = candidate.kind === "dir" ? glyphs.focus : glyphs.bullet;
      lines.push(`  ${marker} ${candidate.path}`);
    }
    return lines;
  }
  const limit = Math.max(0, rows - PANEL_CHROME_ROWS - PREVIEW_HEADER_ROWS - trailing);
  const shown = state.file.preview.slice(0, limit);
  const label =
    shown.length < state.file.preview.length
      ? `preview (${shown.length} of ${state.file.preview.length} lines):`
      : `preview (${state.file.preview.length} lines):`;
  return [
    `file: ${state.file.absolute}`,
    `size: ${state.file.bytes} bytes`,
    label,
    ...shown.map((line) => `  | ${line}`),
  ];
}

/** The panel the frame renders; the error rides in `notice` so it stays inline and visible. */
export function intakePanel(state: IntakeState, glyphs: GlyphSet, rows = 40): PanelView {
  const spawnedRows = state.spawned === null ? 0 : 1 + state.spawned.tail.length;
  const noticeRows = state.error === null ? 0 : state.error.split("\n").length;
  const trailing =
    (state.submitting && state.spawned === null ? 1 : 0) +
    spawnedRows +
    (state.queuedNote === null ? 0 : 1) +
    noticeRows;
  const lines: string[] =
    state.mode === "text"
      ? requestLines(state, rows, trailing)
      : fileLines(state, glyphs, rows, trailing);
  if (state.submitting && state.spawned === null) lines.push("starting...");
  if (state.spawned !== null) {
    lines.push(`spawn log: ${state.spawned.displayPath}`);
    state.spawned.tail.forEach((line) => {
      lines.push(`  ${line}`);
    });
  }
  if (state.queuedNote !== null) lines.push(state.queuedNote);
  return {
    kind: "intake",
    title: title(state, glyphs),
    lines,
    keys:
      state.mode === "text"
        ? [
            keyHint("Tab", "file mode"),
            keyHint("Ctrl-J", "newline"),
            keyHint("Enter", "start"),
            keyHint("Esc", "cancel"),
          ]
        : [keyHint("Tab", "text mode"), keyHint("Enter", "start"), keyHint("Esc", "cancel")],
    notice: state.error,
  };
}
