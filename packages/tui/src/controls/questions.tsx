/**
 * The questions pane: one pure state machine and one panel builder. Nothing here calls the
 * factory; an answer is returned to `entry.tsx`, which records it through `Factory.answer` and
 * only labels it "answered" once the run state carries the answer.
 */
import type { KeyInput } from "../model/keys.ts";
import type { PanelView, QuestionRow, RunDetail } from "../model/view-model.ts";
import { answerRecorded, keyHint } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";

export interface AnswerDraft {
  readonly step: string;
  readonly question: string;
  readonly text: string;
  /** `Factory.answer` returned; waiting for `question.answered`. */
  readonly recorded: boolean;
}

export interface QuestionsState {
  /** Index into `run.questions`. */
  readonly selected: number;
  readonly draft: AnswerDraft | null;
  readonly notice: string | null;
}

export const initialQuestions: QuestionsState = {
  selected: 0,
  draft: null,
  notice: null,
};

export interface AnswerRequest {
  readonly answer: string;
  readonly question: string;
}

export interface QuestionsOutcome {
  readonly state: QuestionsState;
  /** Set only when the caller should record the answer through `Factory.answer`. */
  readonly answer?: AnswerRequest;
}

function recordAt(run: RunDetail, index: number): QuestionRow | undefined {
  return run.questions[index];
}

/** An unanswered record opens its prompt directly; the other statuses offer none. */
function draftFor(record: QuestionRow): AnswerDraft | null {
  if (record.status !== "unanswered") return null;
  return { step: record.step, question: record.question, text: "", recorded: false };
}

function withSelection(run: RunDetail, state: QuestionsState, index: number): QuestionsState {
  const record = recordAt(run, index);
  if (record === undefined) return state;
  const draft = draftFor(record);
  return { selected: index, draft, notice: null };
}

/** `Q` opens the pane only when the run asked something; the first unanswered record is selected. */
export function openQuestions(run: RunDetail): QuestionsState | null {
  if (run.questions.length === 0) return null;
  const index = run.questions.findIndex((record) => record.status === "unanswered");
  return withSelection(run, initialQuestions, index === -1 ? 0 : index);
}

function append(state: QuestionsState, text: string): QuestionsState {
  if (state.draft === null) return state;
  return { ...state, draft: { ...state.draft, text: state.draft.text + text }, notice: null };
}

function removeLast(state: QuestionsState): QuestionsState {
  if (state.draft === null) return state;
  return {
    ...state,
    draft: { ...state.draft, text: state.draft.text.slice(0, -1) },
    notice: null,
  };
}

/** One keypress against the pane; effects never happen here. */
export function questionsKeys(
  run: RunDetail,
  state: QuestionsState,
  input: string,
  key: KeyInput,
): QuestionsOutcome {
  const record = recordAt(run, state.selected);

  if (key.escape) {
    return state.draft === null ? { state } : { state: { ...state, draft: null, notice: null } };
  }

  if (state.draft === null && (key.upArrow || (!key.ctrl && input === "k"))) {
    return { state: withSelection(run, state, Math.max(0, state.selected - 1)) };
  }
  if (state.draft === null && (key.downArrow || (!key.ctrl && input === "j"))) {
    return {
      state: withSelection(run, state, Math.min(run.questions.length - 1, state.selected + 1)),
    };
  }

  if (key.return) {
    if (record === undefined) return { state };
    if (state.draft === null) {
      const draft = draftFor(record);
      return draft === null ? { state } : { state: { ...state, draft, notice: null } };
    }
    const text = state.draft.text.trim();
    if (text === "") return { state: { ...state, notice: "the answer is empty" } };
    // `answered` comes only from `question.answered`; a skipped record takes no answer.
    if (record.status !== "unanswered" && !state.draft.recorded) return { state };
    return { state, answer: { answer: text, question: record.question } };
  }

  if (state.draft === null) return { state };
  if (key.backspace) return { state: removeLast(state) };
  if (key.tab || key.ctrl || key.meta || input.length === 0) return { state };
  return { state: append(state, input) };
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake and approval titles.
  return glyphs.bullet === "-" ? "-" : "—";
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
    case "unanswered": {
      const draft = selected ? state.draft : null;
      if (draft?.recorded === true) {
        lines.push(`  ${recordedLabel(glyphs)}`);
      } else {
        lines.push(`  unanswered ${dash(glyphs)} Enter answers`);
        if (draft !== null) lines.push(`  answer> ${draft.text}`);
      }
      break;
    }
    default: {
      const unhandled: never = record.status;
      throw new Error(`unknown question status: ${String(unhandled)}`);
    }
  }
  return lines;
}

export interface QuestionsPanelInput {
  readonly run: RunDetail;
  readonly state: QuestionsState;
  readonly glyphs: GlyphSet;
}

/** The first line is the run's questions file; every record then gets its own block. */
export function questionsPanel(input: QuestionsPanelInput): PanelView {
  const { run, state, glyphs } = input;
  const questionsFile =
    run.questions[0]?.questionsFile ?? `openspec/changes/${run.id}/questions.md`;
  const lines = [questionsFile];
  run.questions.forEach((record, index) => {
    lines.push(...recordLines(record, index, state, glyphs));
  });
  const selected = run.questions[state.selected];
  const canAnswer = selected?.status === "unanswered";
  const keys = canAnswer
    ? [keyHint("Enter", "answer"), keyHint("Esc", "close")]
    : [keyHint("Esc", "close")];
  return {
    kind: "questions",
    title: `Questions ${dash(glyphs)} ${run.id}`,
    lines,
    keys,
    notice: state.notice,
  };
}
