import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvents } from "../src/events/reader.ts";
import { openStandaloneEvents } from "../src/events/standalone.ts";
import { applyAnswerCommand } from "../src/pipeline/answer.ts";
import { loadRun, newRun, type RunState, saveRun } from "../src/state/run.ts";

const ID = "add-health";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loomwright-answer-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function save(records: RunState["clarifications"], options: { draft?: string } = {}): RunState {
  const run = newRun(ID, "Add math helpers", "awaiting-approval");
  run.clarifications = records;
  if (options.draft !== undefined) run.draft = options.draft;
  return saveRun(root, run);
}

const unanswered = {
  step: "design",
  question: "Ship it?",
  status: "unanswered",
  at: "2026-01-01T00:00:00.000Z",
} as const;

const questionsFile = (dir = root): string => join(dir, "openspec", "changes", ID, "questions.md");

const localFile = (): string => join(root, ".factory", "clarifications", `${ID}.md`);

describe("applyAnswerCommand", () => {
  test("an answer is delivered and consumed", async () => {
    save([unanswered]);
    const events: string[] = [];

    const result = await applyAnswerCommand(
      root,
      ID,
      { question: "Ship it?", answer: "yes" },
      { onApplied: (record) => events.push(`${record.step}:${record.question}`) },
    );

    expect(result).toBe("applied");
    const record = loadRun(root, ID)?.clarifications[0];
    expect(record).toMatchObject({ status: "answered", answer: "yes" });
    expect(events).toEqual(["design:Ship it?"]);
    expect(existsSync(localFile())).toBe(true);
    expect(readFileSync(questionsFile(), "utf8")).toContain("**Answer:** yes");
  });

  test("a live driver owns the answer and both clarification files are rewritten", async () => {
    save([unanswered]);
    let applied = 0;

    const result = await applyAnswerCommand(
      root,
      ID,
      { question: "Ship it?", answer: "yes" },
      { onApplied: () => (applied += 1) },
    );

    expect(result).toBe("applied");
    expect(applied).toBe(1);
    expect(loadRun(root, ID)?.clarifications[0]?.status).toBe("answered");
    expect(readFileSync(localFile(), "utf8")).toContain("**Answer:** yes");
    expect(readFileSync(questionsFile(), "utf8")).toContain("**Answer:** yes");
  });

  test("a re-delivered answer is a no-op", async () => {
    save([{ ...unanswered, status: "answered", answer: "first" }]);
    let applied = 0;

    const result = await applyAnswerCommand(
      root,
      ID,
      { question: "Ship it?", answer: "second" },
      { onApplied: () => (applied += 1) },
    );

    expect(result).toBe("unchanged");
    expect(applied).toBe(0);
    const record = loadRun(root, ID)?.clarifications[0];
    expect(record).toMatchObject({ status: "answered", answer: "first", at: unanswered.at });
    // Self-healing: the files are rewritten even though nothing was emitted.
    expect(readFileSync(questionsFile(), "utf8")).toContain("**Answer:** first");
  });

  test("an unrecorded question keeps the fallback", async () => {
    save([]);
    const applied: RunState["clarifications"] = [];

    await applyAnswerCommand(
      root,
      ID,
      { question: "Unrecorded?", answer: "late" },
      { onApplied: (record) => applied.push(record) },
    );

    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      step: "answer",
      question: "Unrecorded?",
      status: "answered",
      answer: "late",
    });
    expect(loadRun(root, ID)?.clarifications).toHaveLength(1);
  });

  test("an answer with no driver is persisted immediately and emits one event", async () => {
    const run = save([unanswered]);
    const events = openStandaloneEvents(root, ID, run.phase);

    const result = await applyAnswerCommand(
      root,
      ID,
      { question: "Ship it?", answer: "yes" },
      {
        onApplied: (record) =>
          events.emit("question.answered", {
            step: record.step,
            question: record.question,
            status: "answered",
            answer: record.answer ?? "yes",
          }),
      },
    );
    events.close();
    events.close(); // idempotent

    expect(result).toBe("applied");
    const after = loadRun(root, ID);
    expect(after?.clarifications[0]).toMatchObject({ status: "answered", answer: "yes" });
    expect(after?.phase).toBe(run.phase);
    expect(after?.tasks).toEqual(run.tasks);
    const log = readEvents(root, ID).events;
    expect(log[0]?.type).toBe("run.started");
    const answered = log.filter((event) => event.type === "question.answered");
    expect(answered).toHaveLength(1);
    expect(answered[0]?.data).toMatchObject({
      step: "design",
      question: "Ship it?",
      status: "answered",
      answer: "yes",
    });
    expect(readFileSync(localFile(), "utf8")).toContain("**Answer:** yes");
    expect(readFileSync(questionsFile(), "utf8")).toContain("**Answer:** yes");
  });

  test("the draft's questions file is the one rewritten", async () => {
    const draft = join(".factory", "drafts", ID);
    save([unanswered], { draft });

    await applyAnswerCommand(root, ID, { question: "Ship it?", answer: "yes" });

    expect(readFileSync(questionsFile(join(root, draft)), "utf8")).toContain("**Answer:** yes");
    expect(existsSync(questionsFile())).toBe(false);
  });

  test("a deferred answer writes nothing", async () => {
    save([unanswered]);
    const runPath = join(root, ".factory", "runs", `${ID}.json`);
    const before = readFileSync(runPath, "utf8");
    let applied = 0;

    const result = await applyAnswerCommand(
      root,
      ID,
      { question: "Ship it?", answer: "yes" },
      { whenLocked: () => false, onApplied: () => (applied += 1) },
    );

    expect(result).toBe("deferred");
    expect(applied).toBe(0);
    expect(readFileSync(runPath, "utf8")).toBe(before);
    expect(existsSync(localFile())).toBe(false);
  });

  test("a missing run reports missing-run without a write", async () => {
    mkdirSync(join(root, ".factory"), { recursive: true });

    const result = await applyAnswerCommand(root, ID, { answer: "yes" });

    expect(result).toBe("missing-run");
    expect(loadRun(root, ID)).toBeUndefined();
    expect(existsSync(join(root, ".factory", "clarifications", `${ID}.md`))).toBe(false);
  });
});
