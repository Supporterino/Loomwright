/**
 * The new-run dialog: one pure state machine and one panel builder. It never opens the factory
 * or spawns anything; `entry.tsx` turns a `submit` into a launch and writes the result back.
 */
import type { StatusDocument } from "@loomwright/core/factory";
import type { LaunchAction } from "../launch/launcher.ts";
import type { KeyInput } from "../model/keys.ts";
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
  readonly openError: string | null;
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
  if (ctx.openError !== null) {
    return {
      state: { ...state, error: `${ctx.openError} — run \`loomwright init\`` },
    };
  }
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
  if (key.backspace) return { state: removeLast(state, ctx) };
  if (key.escape || input.length === 0) return { state };
  return state.mode === "text"
    ? { state: { ...state, text: state.text + input, error: null } }
    : { state: editFile(state, input, ctx) };
}

function title(state: IntakeState, glyphs: GlyphSet): string {
  // The ASCII glyph set is the frame test's mode; keep its title ASCII too.
  const dash = glyphs.bullet === "-" ? "-" : "—";
  return `New change ${dash} ${state.mode}`;
}

const PREVIEW_LINES = 14;

function fileLines(state: IntakeState, glyphs: GlyphSet): string[] {
  const lines = [`path: ${state.path === "" ? "(type a path)" : state.path}`];
  for (const candidate of state.candidates.slice(0, 8)) {
    const marker = candidate.kind === "dir" ? glyphs.focus : glyphs.bullet;
    lines.push(`  ${marker} ${candidate.path}`);
  }
  if (state.file !== null) {
    lines.push(`file: ${state.file.absolute}`);
    lines.push(`size: ${state.file.bytes} bytes`);
    // A 24-row frame leaves room for this window; the RequestFile keeps all twenty lines.
    lines.push(`preview (${state.file.preview.length} lines):`);
    for (const line of state.file.preview.slice(0, PREVIEW_LINES)) lines.push(`  | ${line}`);
  }
  return lines;
}

/** The panel the frame renders; the error rides in `notice` so it stays inline and visible. */
export function intakePanel(state: IntakeState, glyphs: GlyphSet): PanelView {
  const lines: string[] =
    state.mode === "text"
      ? [state.text === "" ? "request: (empty)" : `request: ${state.text}`]
      : fileLines(state, glyphs);
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
