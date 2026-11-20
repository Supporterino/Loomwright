/**
 * The questions pane: one pure state machine and one panel builder. Nothing here calls the
 * factory; an answer is returned to `entry.tsx`, which records it through `Factory.answer` and
 * only labels it "answered" once the run state carries the answer.
 */
import type { KeyInput } from "../model/keys.ts";
import type { PanelView, QuestionRow, RunDetail } from "../model/view-model.ts";
import { clampOffset, nextOffset, sliceWindow, window as windowOf } from "../model/viewport.ts";
import { answerRecorded, keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import { dash } from "../views/style.ts";

export type QuestionsFocus = "record" | "composer";

export interface QuestionsState {
  /** Index into `run.questions`. */
  readonly selected: number;
  readonly focus: QuestionsFocus;
  /** Composer text; empty while no composer is open. */
  readonly text: string;
  /** Rows scrolled within the record list. */
  readonly offset: number;
  /** Records whose `Factory.answer` call returned, keyed by `recordKey(step, question)`. */
  readonly recorded: ReadonlySet<string>;
  readonly notice: string | null;
}

export const initialQuestions: QuestionsState = {
  selected: 0,
  focus: "record",
  text: "",
  offset: 0,
  recorded: new Set<string>(),
  notice: null,
};

/** One record's answer attempt: the step and question identify it across re-opened panes. */
export function recordKey(step: string, question: string): string {
  return `${step}\u0000${question}`;
}

export interface AnswerRequest {
  readonly answer: string;
  readonly question: string;
}

export interface QuestionsOutcome {
  readonly state: QuestionsState;
  /** Set only when the caller should record the answer through `Factory.answer`. */
  readonly answer?: AnswerRequest;
  /** Set on `Esc` outside a composer: the caller closes the pane. */
  readonly close?: boolean;
}

/** Every record renders three body lines: step, question and status. */
const RECORD_BLOCK_ROWS = 3;

/** Rows the panel border, title, key footer row, frame footer and spare row spend. */
const PANE_CHROME_ROWS = 6;

/**
 * The body rows a questions pane of `rows` terminal rows may give to records; the questions-file
 * line, the panel's own border, title and key rows, the frame footer and, when present, the notice
 * row are spent. Never zero so a short pane still scrolls.
 */
export function questionsBodyRows(rows: number, noticeRows = 0): number {
  return Math.max(1, rows - PANE_CHROME_ROWS - Math.max(0, noticeRows));
}

function recordAt(run: RunDetail, index: number): QuestionRow | undefined {
  return run.questions[index];
}

/** `Q` opens the pane only when the run asked something; the first unanswered record is selected. */
export function openQuestions(run: RunDetail): QuestionsState | null {
  if (run.questions.length === 0) return null;
  const index = run.questions.findIndex((record) => record.status === "unanswered");
  return { ...initialQuestions, selected: index === -1 ? 0 : index };
}

/** The offset that keeps `selected` inside the pane's record window. */
export function questionsSelectionOffset(
  run: RunDetail,
  selected: number,
  offset: number,
  rows: number,
  composerRows = 0,
): number {
  const total = run.questions.length * RECORD_BLOCK_ROWS;
  const size = Math.max(1, questionsBodyRows(rows) - composerRows);
  return selectedWindowOffset(offset, selected, total, size);
}

/**
 * The smallest move that puts the whole selected record inside the window. A window taller than
 * the record only needs its start visible; a short one still keeps the header on screen.
 */
function selectedWindowOffset(
  offset: number,
  selected: number,
  total: number,
  size: number,
): number {
  const start = selected * RECORD_BLOCK_ROWS;
  const end = start + RECORD_BLOCK_ROWS;
  const next = nextOffset(offset, start, total, size);
  return end > next + size ? clampOffset(end - size, total, size) : next;
}

function selectRecord(
  run: RunDetail,
  state: QuestionsState,
  index: number,
  rows: number | undefined,
): QuestionsState {
  if (index === state.selected) return state;
  const offset =
    rows === undefined ? state.offset : questionsSelectionOffset(run, index, state.offset, rows);
  return { ...state, selected: index, offset, notice: null };
}

function append(state: QuestionsState, text: string): QuestionsState {
  return { ...state, text: state.text + text, notice: null };
}

/** Deletes one code point, so an emoji typed into the composer is removed whole. */
function removeLast(state: QuestionsState): QuestionsState {
  return { ...state, text: Array.from(state.text).slice(0, -1).join(""), notice: null };
}

/** One keypress against the pane; effects never happen here. */
export function questionsKeys(
  run: RunDetail,
  state: QuestionsState,
  input: string,
  key: KeyInput,
  rows?: number,
): QuestionsOutcome {
  const record = recordAt(run, state.selected);

  if (key.escape) {
    if (state.focus === "composer") {
      return { state: { ...state, focus: "record", text: "", notice: null } };
    }
    return { state, close: true };
  }

  if (state.focus === "record") {
    if (key.upArrow || (!key.ctrl && input === "k")) {
      return { state: selectRecord(run, state, Math.max(0, state.selected - 1), rows) };
    }
    if (key.downArrow || (!key.ctrl && input === "j")) {
      return {
        state: selectRecord(
          run,
          state,
          Math.min(run.questions.length - 1, state.selected + 1),
          rows,
        ),
      };
    }
    if (key.return) {
      if (record === undefined || record.status !== "unanswered") return { state };
      const offset =
        rows === undefined
          ? state.offset
          : questionsSelectionOffset(run, state.selected, state.offset, rows, 1);
      return { state: { ...state, focus: "composer", text: "", offset, notice: null } };
    }
    return { state };
  }

  if (key.ctrl && (input === "j" || input === "\n" || input === "\r")) {
    return { state: append(state, "\n") };
  }
  if (key.return) {
    if (record === undefined || record.status !== "unanswered") return { state };
    // Already sent to `Factory.answer`; only `question.answered` changes the record now.
    if (state.recorded.has(recordKey(record.step, record.question))) return { state };
    const answer = state.text.trim();
    if (answer === "") return { state: { ...state, notice: "the answer is empty" } };
    return { state, answer: { answer, question: record.question } };
  }
  if (key.backspace) return { state: removeLast(state) };
  // Navigation stays inert while composing, even when the terminal reports a raw sequence.
  if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) return { state };
  if (key.tab || key.ctrl || key.meta || input.length === 0) return { state };
  return { state: append(state, input) };
}

/**
 * The state after `Factory.answer` returned: remember the record so its row keeps reading
 * `recorded — applies at the next step`, then select the next unanswered record after it.
 */
export function recordAnswerInState(
  run: RunDetail,
  state: QuestionsState,
  step: string,
  question: string,
  rows?: number,
): QuestionsState {
  const recorded = new Set(state.recorded);
  recorded.add(recordKey(step, question));
  const next = run.questions.findIndex(
    (record, index) => index > state.selected && record.status === "unanswered",
  );
  const selected = next === -1 ? state.selected : next;
  const offset =
    rows === undefined ? state.offset : questionsSelectionOffset(run, selected, state.offset, rows);
  return {
    ...state,
    selected,
    focus: "record",
    text: "",
    offset,
    recorded,
    notice: null,
  };
}

function recordedLabel(glyphs: GlyphSet): string {
  return glyphs.bullet === "-" ? answerRecorded.replace("—", "-") : answerRecorded;
}

function marker(selected: boolean, glyphs: GlyphSet): string {
  return selected ? glyphs.focus : " ";
}

function statusGlyph(record: QuestionRow, glyphs: GlyphSet): string {
  switch (record.status) {
    case "answered":
      return glyphs.passed;
    case "skipped":
      return glyphs.skipped;
    case "unanswered":
      return glyphs.pending;
    default: {
      const unhandled: never = record.status;
      throw new Error(`unknown question status: ${String(unhandled)}`);
    }
  }
}

function recordLines(
  record: QuestionRow,
  index: number,
  state: QuestionsState,
  glyphs: GlyphSet,
): string[] {
  const selected = index === state.selected;
  const lines = [
    `${marker(selected, glyphs)} ${statusGlyph(record, glyphs)} ${record.step}`,
    `  ${record.question}`,
  ];
  switch (record.status) {
    case "answered":
      lines.push(
        record.answer === undefined ? "  answered" : `  answered ${dash(glyphs)} ${record.answer}`,
      );
      break;
    case "skipped":
      lines.push("  skipped");
      break;
    case "unanswered":
      lines.push(
        state.recorded.has(recordKey(record.step, record.question))
          ? `  ${recordedLabel(glyphs)}`
          : `  unanswered ${dash(glyphs)} Enter answers`,
      );
      break;
    default: {
      const unhandled: never = record.status;
      throw new Error(`unknown question status: ${String(unhandled)}`);
    }
  }
  return lines;
}

/** The composer under the selected record: each newline in the text is its own panel line. */
function composerLines(text: string): string[] {
  return text.split("\n").map((line, index) => (index === 0 ? `answer> ${line}` : `  ${line}`));
}

function footerKeys(run: RunDetail, state: QuestionsState): PanelView["keys"] {
  if (state.focus === "composer") {
    return [
      keyHint("Ctrl-J", "newline"),
      keyHint("Enter", "record"),
      keyHint("Esc", "leaves the composer to navigate"),
    ];
  }
  const keys: PanelView["keys"][number][] = [keyHint("j/k", "navigate")];
  if (run.questions[state.selected]?.status === "unanswered") keys.push(keyHint("Enter", "answer"));
  keys.push(keyHint("Esc", "close"));
  return keys;
}

export interface QuestionsPanelInput {
  readonly run: RunDetail;
  readonly state: QuestionsState;
  readonly glyphs: GlyphSet;
  /** Terminal rows; absent means no clipping and the panel is as long as its records. */
  readonly rows?: number;
}

/** The first line is the run's questions file; every record then gets its own block. */
export function questionsPanel(input: QuestionsPanelInput): PanelView {
  const { run, state, glyphs, rows } = input;
  const questionsFile =
    run.questions[0]?.questionsFile ?? `openspec/changes/${run.id}/questions.md`;
  const composer = state.focus === "composer" ? composerLines(state.text) : [];
  const blocks = run.questions.map((record, index) => recordLines(record, index, state, glyphs));

  let lines: readonly string[];
  if (rows === undefined) {
    lines = [questionsFile, ...blocks.flat(), ...composer];
  } else {
    const flat = blocks.flat();
    // A notice gets its own panel row, so it comes out of the records' budget first.
    const bodyRows = questionsBodyRows(rows, state.notice === null ? 0 : 1);
    // A composer taller than the pane keeps its newest lines so the frame still fits.
    const composerRows = Math.min(composer.length, Math.max(0, bodyRows - 1));
    const shownComposer = composerRows === 0 ? [] : composer.slice(composer.length - composerRows);
    const recordRows = Math.max(1, bodyRows - shownComposer.length);
    const offset = selectedWindowOffset(state.offset, state.selected, flat.length, recordRows);
    lines = [
      questionsFile,
      ...sliceWindow(flat, windowOf(offset, flat.length, recordRows)),
      ...shownComposer,
    ];
  }

  return {
    kind: "questions",
    title: `Questions ${dash(glyphs)} ${run.id}`,
    lines,
    keys: footerKeys(run, state),
    notice: state.notice,
  };
}
