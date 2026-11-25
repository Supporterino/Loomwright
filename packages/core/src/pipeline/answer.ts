import {
  type Clarification,
  now as defaultNow,
  type RunState,
  saveRun,
  withRunLock,
} from "../state/run.ts";
import { specDirFor, writeClarifications } from "./clarify.ts";

export type AnswerResult = "applied" | "unchanged" | "deferred" | "missing-run";

export interface AnswerOptions {
  /** Re-checked under the run lock; return false to defer to a driver that appeared. */
  readonly whenLocked?: (run: RunState) => boolean;
  /** Called once with the record that was answered, only for `applied`. */
  readonly onApplied?: (record: Clarification) => void;
  readonly now?: () => string;
}

type Locked =
  | { readonly result: "applied"; readonly record: Clarification }
  | { readonly result: "unchanged" | "deferred" | "missing-run" };

function findRecord(
  records: readonly Clarification[],
  command: { readonly answer: string; readonly question?: string },
): Clarification | undefined {
  if (command.question === undefined)
    return records.find((record) => record.status === "unanswered");
  return records.find((record) => record.question === command.question);
}

/**
 * The one state transition for an `answer`: both the driver consuming its inbox and the direct
 * path when no driver owns the run call it. The caller owns the inbox file.
 */
export async function applyAnswerCommand(
  root: string,
  id: string,
  command: { readonly answer: string; readonly question?: string },
  options?: AnswerOptions,
): Promise<AnswerResult> {
  const locked = await withRunLock<Locked>(root, id, (current) => {
    if (current === undefined) return { result: "missing-run" };
    if (options?.whenLocked?.(current) === false) return { result: "deferred" };
    const records = current.clarifications;
    const record = findRecord(records, command);
    if (record?.status === "answered") {
      // A re-delivered answer keeps the recorded text; the rewrite repairs a stale file.
      writeClarifications({
        root,
        id,
        specDir: specDirFor(root, current.draft),
        records,
      });
      return { result: "unchanged" };
    }
    let answered: Clarification;
    if (record === undefined) {
      // A TUI can answer before an ask loop recorded the question: keep the answer anyway.
      answered = {
        step: "answer",
        question: command.question ?? "answer",
        status: "answered",
        answer: command.answer,
        at: (options?.now ?? defaultNow)(),
      };
      records.push(answered);
    } else {
      record.status = "answered";
      record.answer = command.answer;
      record.at = (options?.now ?? defaultNow)();
      answered = record;
    }
    saveRun(root, current);
    writeClarifications({
      root,
      id,
      specDir: specDirFor(root, current.draft),
      records,
    });
    return { result: "applied", record: answered };
  });
  if (locked.result === "applied") options?.onApplied?.(locked.record);
  return locked.result;
}
