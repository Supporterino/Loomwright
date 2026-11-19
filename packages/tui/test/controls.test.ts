import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import { RunState, TaskState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import { approvalStarted } from "../src/approval/overlay.ts";
import {
  confirmFor,
  confirmKeys,
  confirmPanel,
  landFor,
  resumeFor,
  retryFor,
} from "../src/controls/actions.ts";
import {
  openQuestions,
  type QuestionsState,
  questionsKeys,
  questionsPanel,
} from "../src/controls/questions.tsx";
import {
  createResumeGuard,
  landConfirmation,
  landFailed,
  landSettled,
  performControl,
  recordAnswer,
  resumeFailed,
  resumeStarted,
  runInSession,
  startLand,
  startResume,
  type UiData,
} from "../src/entry.tsx";
import {
  actionArgs,
  type ExitResult,
  type LaunchAction,
  type LaunchResult,
} from "../src/launch/launcher.ts";
import { collectFacts } from "../src/model/facts.ts";
import type { KeyInput } from "../src/model/keys.ts";
import { buildViewModel, type RunDetail, type ViewModelInput } from "../src/model/view-model.ts";
import { createTerminalSession, type TerminalSession } from "../src/session.ts";
import { answerRecorded } from "../src/strings.ts";
import { ASCII_GLYPHS, UNICODE_GLYPHS } from "../src/theme/glyphs.ts";

const ISO = "2026-11-18T10:00:00.000Z";
const RUN = "add-health";
const LOG = ".factory/logs/tui-spawn-test.log";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

function runState(overrides: Record<string, unknown> = {}): RunState {
  return RunState.parse({
    version: 1,
    id: RUN,
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "implementing",
    summary: "Add health endpoints",
    ...overrides,
  });
}

function taskState(overrides: Record<string, unknown>): TaskState {
  return TaskState.parse({
    id: "first",
    title: "Health endpoint",
    repo: "app",
    deps: [],
    touches: [],
    status: "pending",
    ...overrides,
  });
}

function usageSummary(): UsageSummary {
  return {
    total: ZERO_USAGE,
    sessions: 0,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: ZERO_USAGE,
    top: [],
    wastedReads: 0,
  };
}

function statusDoc(run: RunState): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [{ ...run, usage: usageSummary() }],
  };
}

function viewInput(run: RunState, overrides: Partial<ViewModelInput> = {}): ViewModelInput {
  return {
    source: "live",
    screen: "run",
    columns: 120,
    rows: 40,
    now: Date.parse(ISO),
    snapshot: null,
    facts: collectFacts([]),
    status: statusDoc(run),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId: run.tasks.find((task) => task.status === "failed")?.id ?? null,
    panel: null,
    notice: null,
    ...overrides,
  };
}

function detail(run: RunState): RunDetail {
  const view = buildViewModel(viewInput(run));
  if (view.run === null) throw new Error("the fixture has no run detail");
  return view.run;
}

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    ctrl: false,
    shift: false,
    meta: false,
    pageUp: false,
    pageDown: false,
    delete: false,
    backspace: false,
    ...overrides,
  };
}

function askRun(
  records: readonly {
    readonly step: string;
    readonly question: string;
    readonly status: "answered" | "skipped" | "unanswered";
    readonly answer?: string;
  }[],
  overrides: Record<string, unknown> = {},
): RunDetail {
  return detail(
    runState({
      clarifications: records.map((record) => ({ ...record, at: ISO })),
      ...overrides,
    }),
  );
}

function panelText(run: RunDetail, state: QuestionsState): string {
  const panel = questionsPanel({ run, state, glyphs: UNICODE_GLYPHS });
  return [
    panel.title,
    ...panel.lines,
    panel.notice ?? "",
    ...panel.keys.map((hint) => hint.key),
  ].join("\n");
}

function typeText(run: RunDetail, state: QuestionsState, text: string): QuestionsState {
  let current = state;
  for (const character of text) {
    current = questionsKeys(run, current, character, key()).state;
  }
  return current;
}

function fakeFactory(): {
  readonly factory: Pick<Factory, "abort" | "retry" | "answer" | "resume">;
  readonly aborts: readonly string[];
  readonly retries: readonly { readonly id: string; readonly taskId: string }[];
  readonly answers: readonly {
    readonly id: string;
    readonly answer: string;
    readonly question: string;
  }[];
  readonly resumes: readonly string[];
} {
  const aborts: string[] = [];
  const retries: { id: string; taskId: string }[] = [];
  const answers: { id: string; answer: string; question: string }[] = [];
  const resumes: string[] = [];
  return {
    aborts,
    retries,
    answers,
    resumes,
    factory: {
      abort: async (id) => {
        aborts.push(id);
      },
      retry: async (id, taskId) => {
        retries.push({ id, taskId });
      },
      answer: async (id, answer, question) => {
        answers.push({ id, answer, question: question ?? "" });
      },
      resume: async (id) => {
        resumes.push(id);
        return { id, phase: "implementing" };
      },
    },
  };
}

function fakeLauncher(): {
  readonly launcher: { launch(action: LaunchAction): Promise<never> };
  readonly launches: readonly LaunchAction[];
} {
  const launches: LaunchAction[] = [];
  return {
    launches,
    launcher: {
      async launch(action: LaunchAction): Promise<never> {
        launches.push(action);
        throw new Error("the launcher fake never resolves");
      },
    },
  };
}

/** A launcher that spawns at once and lets the test decide when (and how) the child exits. */
function resumeLauncher(
  logPath = LOG,
  displayPath = LOG,
): {
  readonly launcher: { launch(action: LaunchAction): Promise<LaunchResult> };
  readonly launches: readonly LaunchAction[];
  readonly exit: (code: number | null) => void;
} {
  const launches: LaunchAction[] = [];
  let settle: (result: ExitResult) => void = () => {};
  const exited = new Promise<ExitResult>((resolve) => {
    settle = resolve;
  });
  return {
    launches,
    exit: (code) => settle({ code, signal: null }),
    launcher: {
      async launch(action: LaunchAction): Promise<LaunchResult> {
        launches.push(action);
        return { pid: 4242, logPath, displayPath, exited };
      },
    },
  };
}

function uiData(overrides: Partial<UiData> = {}): UiData {
  const run = runState();
  return {
    screen: "run",
    selectedRunId: run.id,
    selectedTaskId: null,
    columns: 120,
    rows: 40,
    status: statusDoc(run),
    runs: [run],
    snapshot: null,
    facts: collectFacts([]),
    notice: null,
    intake: null,
    approval: null,
    questions: null,
    confirmation: null,
    help: false,
    identity: null,
    ...overrides,
  };
}

describe("Q opens the questions pane only when questions exist", () => {
  test("openQuestions returns null for a run with no questions", () => {
    expect(openQuestions(askRun([]))).toBeNull();
  });

  test("the Q footer hint appears only when the run asked something", () => {
    const asked = buildViewModel(
      viewInput(
        runState({
          clarifications: [
            {
              step: "design",
              question: "Which endpoints should be public?",
              status: "unanswered",
              at: ISO,
            },
          ],
        }),
      ),
    );
    expect(asked.footer.some((hint) => hint.key === "Q")).toBe(true);

    const quiet = buildViewModel(viewInput(runState()));
    expect(quiet.footer.some((hint) => hint.key === "Q")).toBe(false);
  });

  test("an unanswered record opens its draft directly", () => {
    const run = askRun([
      { step: "design", question: "Which endpoints should be public?", status: "unanswered" },
      { step: "design", question: "Do health checks need auth?", status: "skipped" },
    ]);
    const state = openQuestions(run);
    expect(state).toEqual({
      selected: 0,
      draft: {
        step: "design",
        question: "Which endpoints should be public?",
        text: "",
        recorded: false,
      },
      notice: null,
    });
    if (state === null) throw new Error("the pane did not open");
    expect(questionsPanel({ run, state, glyphs: UNICODE_GLYPHS }).kind).toBe("questions");
    expect(panelText(run, state)).toContain("answer>");
  });
});

describe("an answer is recorded, then confirmed", () => {
  test("a typed answer emits one answer with the question text and Factory.answer records it", async () => {
    const run = askRun([
      { step: "design", question: "Which endpoints should be public?", status: "unanswered" },
    ]);
    const opened = openQuestions(run);
    if (opened === null) throw new Error("the pane did not open");
    const typed = typeText(run, opened, "public /health");

    const outcome = questionsKeys(run, typed, "Enter", key({ return: true }));
    expect(outcome.answer).toEqual({
      answer: "public /health",
      question: "Which endpoints should be public?",
    });

    const fake = fakeFactory();
    if (outcome.answer !== undefined) {
      await recordAnswer(fake.factory, run.id, outcome.answer.answer, outcome.answer.question);
    }
    expect(fake.answers).toEqual([
      { id: RUN, answer: "public /health", question: "Which endpoints should be public?" },
    ]);
    expect(fake.resumes).toEqual([]);
  });

  test("blank answer does not emit and the row is recorded only after the call", () => {
    const run = askRun([
      { step: "design", question: "Which endpoints should be public?", status: "unanswered" },
    ]);
    const opened = openQuestions(run);
    if (opened === null) throw new Error("the pane did not open");

    const blank = questionsKeys(run, opened, "Enter", key({ return: true }));
    expect(blank.answer).toBeUndefined();
    expect(blank.state.notice).toBe("the answer is empty");

    const typed = typeText(run, blank.state, "public");
    const emitted = questionsKeys(run, typed, "Enter", key({ return: true }));
    if (emitted.answer === undefined) throw new Error("the typed answer did not emit");
    const recorded: QuestionsState = {
      ...emitted.state,
      draft: emitted.state.draft === null ? null : { ...emitted.state.draft, recorded: true },
    };
    const pending = panelText(run, recorded);
    expect(pending).toContain(answerRecorded);
    expect(pending).not.toContain("answered -");

    const answeredRun = askRun([
      {
        step: "design",
        question: "Which endpoints should be public?",
        status: "answered",
        answer: "public /health",
      },
    ]);
    const answered = panelText(answeredRun, {
      selected: 0,
      draft: null,
      notice: null,
    });
    expect(answered).toContain("answered");
    expect(answered).toContain("public /health");
  });

  test("a second Enter before question.answered does not emit the answer again", () => {
    const run = askRun([
      { step: "design", question: "Which endpoints should be public?", status: "unanswered" },
    ]);
    const opened = openQuestions(run);
    if (opened === null) throw new Error("the pane did not open");
    const typed = typeText(run, opened, "public /health");
    const first = questionsKeys(run, typed, "Enter", key({ return: true }));
    if (first.answer === undefined) throw new Error("the first Enter did not emit");

    const recorded: QuestionsState = {
      ...first.state,
      draft: first.state.draft === null ? null : { ...first.state.draft, recorded: true },
    };
    const second = questionsKeys(run, recorded, "Enter", key({ return: true }));
    expect(second.answer).toBeUndefined();
    expect(second.state).toEqual(recorded);
  });
});

describe("the run is not asked", () => {
  test("an unanswered question is listed and the pane points at questions.md", () => {
    const run = askRun([
      { step: "design", question: "Which endpoints should be public?", status: "unanswered" },
    ]);
    const state = openQuestions(run);
    if (state === null) throw new Error("the pane did not open");
    const text = panelText(run, state);
    expect(text).toContain("openspec/changes/add-health/questions.md");
    expect(text).toContain("Which endpoints should be public?");
    expect(text).toContain("unanswered");
    expect(text).toContain("answer>");
    // No stdin prompt: the pane only holds a draft, and no answer exists until the user types.
    expect(text.split("\n").some((line) => line.trim().startsWith("answered"))).toBe(false);
  });

  test("a draft run points at the draft's questions.md", () => {
    const run = askRun([{ step: "design", question: "Which endpoints?", status: "unanswered" }], {
      draft: ".factory/drafts/add-health",
    });
    const state = openQuestions(run);
    if (state === null) throw new Error("the pane did not open");
    expect(panelText(run, state)).toContain(
      ".factory/drafts/add-health/openspec/changes/add-health/questions.md",
    );
  });
});

describe("a skipped question is shown as skipped", () => {
  test("the row says skipped, offers no prompt and Enter emits nothing", () => {
    const run = askRun([
      { step: "design", question: "Do health checks need auth?", status: "skipped" },
    ]);
    const state = openQuestions(run);
    if (state === null) throw new Error("the pane did not open");
    expect(state.draft).toBeNull();
    const text = panelText(run, state);
    expect(text).toContain("skipped");
    expect(text).not.toContain("Enter answers");
    expect(text).not.toContain("answer>");

    const outcome = questionsKeys(run, state, "Enter", key({ return: true }));
    expect(outcome.answer).toBeUndefined();
    expect(outcome.state).toEqual(state);
  });
});

describe("abort needs its own confirmation", () => {
  test("x names the change id and keeps branches and worktrees; cancel calls nothing", async () => {
    const run = runState();
    const view = buildViewModel(viewInput(run));
    const action = confirmFor(view);
    expect(action).toEqual({ kind: "abort", id: RUN });
    if (action === null) throw new Error("the abort confirmation did not open");

    const panel = confirmPanel(action, ASCII_GLYPHS);
    expect(panel.kind).toBe("confirm");
    expect(panel.title).toBe(`Abort ${RUN}?`);
    expect(panel.lines.join("\n")).toContain(RUN);
    expect(panel.lines.join("\n")).toContain("branches and worktrees are kept");

    const fake = fakeFactory();
    const { launcher } = fakeLauncher();
    expect(confirmKeys("n", key())).toBe("cancel");
    expect(confirmKeys("", key({ escape: true }))).toBe("cancel");
    expect(fake.aborts).toEqual([]);

    expect(confirmKeys("", key({ return: true }))).toBe("confirm");
    await performControl({ factory: fake.factory, launcher }, action);
    expect(fake.aborts).toEqual([RUN]);
  });

  test("y confirms and a done or aborted run offers no abort", () => {
    expect(confirmKeys("y", key())).toBe("confirm");
    expect(confirmFor(buildViewModel(viewInput(runState({ phase: "done" }))))).toBeNull();
    expect(confirmFor(buildViewModel(viewInput(runState({ phase: "aborted" }))))).toBeNull();
  });
});

describe("retry is limited to failed tasks", () => {
  test("a failed selected task retries with the change id and task id", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", status: "failed" })],
    });
    const view = buildViewModel(viewInput(run));
    const action = retryFor(view);
    expect(action).toEqual({ kind: "retry", id: RUN, taskId: "first" });
    if (action === null) throw new Error("retry was not offered");

    const fake = fakeFactory();
    const { launcher } = fakeLauncher();
    await performControl({ factory: fake.factory, launcher }, action);
    expect(fake.retries).toEqual([{ id: RUN, taskId: "first" }]);
    expect(fake.resumes).toEqual([]);
  });

  test("a task that is not failed offers no retry", () => {
    const run = runState({
      tasks: [taskState({ id: "first", status: "running" })],
    });
    expect(retryFor(buildViewModel(viewInput(run)))).toBeNull();
    expect(retryFor(buildViewModel(viewInput(runState())))).toBeNull();
  });
});

describe("resume is a child, not a call", () => {
  test("r on a paused run launches the detached resume and never calls Factory.resume", async () => {
    const run = runState({ phase: "paused" });
    const view = buildViewModel(viewInput(run));
    const action = resumeFor(view);
    expect(action).toEqual({ kind: "resume", id: RUN });
    if (action === null) throw new Error("resume was not offered");

    const fake = fakeFactory();
    const { launcher, launches } = fakeLauncher();
    await expect(performControl({ factory: fake.factory, launcher }, action)).rejects.toThrow(
      "the launcher fake never resolves",
    );
    expect(launches).toEqual([{ kind: "resume", id: RUN }]);
    expect(fake.resumes).toEqual([]);
  });

  test("an aborted and a queued run resume the same way and an implementing run offers nothing", () => {
    expect(resumeFor(buildViewModel(viewInput(runState({ phase: "aborted" }))))).toEqual({
      kind: "resume",
      id: RUN,
    });
    // Approve only leaves the run queued: the footer and `r` must still offer resume.
    const queued = buildViewModel(viewInput(runState({ phase: "queued" })));
    expect(resumeFor(queued)).toEqual({ kind: "resume", id: RUN });
    expect(queued.footer.some((hint) => hint.key === "r")).toBe(true);
    expect(resumeFor(buildViewModel(viewInput(runState())))).toBeNull();
  });

  test("the footer lists r resume for an aborted run too, the same predicate as resumeFor", () => {
    const aborted = buildViewModel(viewInput(runState({ phase: "aborted" })));
    expect(aborted.footer).toContainEqual({ key: "r", label: "resume", enabled: true });

    // The footer hint and `r` share one predicate: neither appears for an implementing or done run.
    for (const phase of ["paused", "aborted", "queued", "implementing", "done"] as const) {
      const view = buildViewModel(viewInput(runState({ phase })));
      expect(view.footer.some((hint) => hint.key === "r")).toBe(resumeFor(view) !== null);
    }
  });

  test("resume hands back the child's LaunchResult and abort returns null", async () => {
    const fake = fakeFactory();
    const { launcher } = resumeLauncher();
    const result = await performControl(
      { factory: fake.factory, launcher },
      {
        kind: "resume",
        id: RUN,
      },
    );
    expect(result.pid).toBe(4242);
    expect(result.displayPath).toBe(LOG);
    expect(
      await performControl({ factory: fake.factory, launcher }, { kind: "abort", id: RUN }),
    ).toBeNull();
  });
});

describe("a resumed child is guarded and observed", () => {
  test("a double-tapped r launches one resume child for the run", async () => {
    const fake = fakeFactory();
    const { launcher, launches, exit } = resumeLauncher();
    const deps = {
      factory: fake.factory,
      launcher,
      guard: createResumeGuard(),
      update: () => {},
      refresh: async () => {},
    };

    startResume(deps, RUN);
    startResume(deps, RUN);
    await Bun.sleep(0);
    expect(launches).toEqual([{ kind: "resume", id: RUN }]);

    // The guard clears on the child's exit, so the next `r` is a new resume rather than a lost key.
    exit(0);
    await Bun.sleep(0);
    startResume(deps, RUN);
    await Bun.sleep(0);
    expect(launches).toHaveLength(2);
  });

  test("a failed child is visible: a non-zero resume exit shows the code and the last ten log lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "loomwright-resume-"));
    try {
      const logPath = join(dir, "resume.log");
      const lines = Array.from(
        { length: 12 },
        (_, index) => `log line ${String(index + 1).padStart(2, "0")}`,
      );
      writeFileSync(logPath, lines.join("\n"));
      const data = resumeFailed(uiData(), RUN, { logPath, displayPath: LOG }, 3);
      expect(data.approval).toBeNull();
      expect(data.notice).toContain(`resume ${RUN} exited with code 3`);
      expect(data.notice).toContain(`spawn log: ${LOG}`);
      for (const line of lines.slice(-10)) expect(data.notice).toContain(line);
      expect(data.notice).not.toContain(lines[0]);
      expect(data.notice).not.toContain(lines[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a non-zero resume from the approve-only wait fails the overlay with its code and tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "loomwright-resume-"));
    try {
      const logPath = join(dir, "resume.log");
      writeFileSync(logPath, "boom\n");
      const waiting = approvalStarted({ kind: "launching", action: "approve-only" }, LOG);
      const data = resumeFailed(
        uiData({ approval: waiting }),
        RUN,
        { logPath, displayPath: LOG },
        4,
      );
      expect(data.notice).toBeNull();
      expect(data.approval).toEqual({
        kind: "failed",
        action: "approve-only",
        code: 4,
        tail: ["boom"],
        logPath: LOG,
      });

      // An overlay state with nothing to fail keeps its state and reports through the notice.
      const idle = resumeFailed(
        uiData({ approval: { kind: "idle" } }),
        RUN,
        { logPath, displayPath: LOG },
        4,
      );
      expect(idle.approval).toEqual({ kind: "idle" });
      expect(idle.notice).toContain("exited with code 4");
      expect(idle.notice).toContain(`spawn log: ${LOG}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a running resume keeps its spawn log path on screen", async () => {
    const fake = fakeFactory();
    const { launcher } = resumeLauncher(join(tmpdir(), "resume.log"), LOG);
    const states: UiData[] = [];
    startResume(
      {
        factory: fake.factory,
        launcher,
        guard: createResumeGuard(),
        update: (change: (data: UiData) => UiData) => states.push(change(uiData())),
        refresh: async () => {},
      },
      RUN,
    );
    await Bun.sleep(0);

    expect(states.at(-1)?.notice).toContain(`resume ${RUN}`);
    expect(states.at(-1)?.notice).toContain(`spawn log: ${LOG}`);
  });

  test("a resume from the approve-only wait points the overlay at the resume child's log", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve-only" }, "old.log");
    const started = resumeStarted(uiData({ approval: waiting }), RUN, LOG);
    expect(started.notice).toContain(`spawn log: ${LOG}`);
    expect(started.approval).toMatchObject({
      kind: "waiting",
      action: "approve-only",
      logPath: LOG,
    });

    // Without the overlay the same path goes to the notice alone.
    expect(resumeStarted(uiData(), RUN, LOG).notice).toContain(`spawn log: ${LOG}`);
  });

  test("startResume surfaces a failed child through the UI update", async () => {
    const fake = fakeFactory();
    const dir = mkdtempSync(join(tmpdir(), "loomwright-resume-"));
    try {
      const logPath = join(dir, "resume.log");
      writeFileSync(logPath, "boom\n");
      const { launcher, exit } = resumeLauncher(logPath, LOG);
      const states: UiData[] = [];
      startResume(
        {
          factory: fake.factory,
          launcher,
          guard: createResumeGuard(),
          update: (change: (data: UiData) => UiData) => states.push(change(uiData())),
          refresh: async () => {},
        },
        RUN,
      );
      await Bun.sleep(0);
      exit(3);
      await Bun.sleep(0);
      expect(states.at(-1)?.notice).toContain("exited with code 3");
      expect(states.at(-1)?.notice).toContain("boom");
      expect(states.at(-1)?.notice).toContain(`spawn log: ${LOG}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a resume that threw releases the guard and shows the message", async () => {
    const fake = fakeFactory();
    let attempts = 0;
    const launcher = {
      async launch(_action: LaunchAction): Promise<LaunchResult> {
        attempts += 1;
        throw new Error("spawn failed");
      },
    };
    const notices: string[] = [];
    const deps = {
      factory: fake.factory,
      launcher,
      guard: createResumeGuard(),
      update: (change: (data: UiData) => UiData) => notices.push(change(uiData()).notice ?? ""),
      refresh: async () => {},
    };

    startResume(deps, RUN);
    await Bun.sleep(0);
    expect(notices).toEqual(["spawn failed"]);
    startResume(deps, RUN);
    await Bun.sleep(0);
    expect(attempts).toBe(2);
  });
});

describe("land confirms before merging", () => {
  test("the confirmation names the change id, local merges, cleanup and that nothing is pushed", () => {
    const view = buildViewModel(viewInput(runState({ phase: "done" })));
    const action = landFor(view);
    expect(action).toEqual({ kind: "land", id: RUN });
    if (action === null) throw new Error("the land confirmation did not open");

    const panel = confirmPanel(action, ASCII_GLYPHS);
    expect(panel.kind).toBe("confirm");
    expect(panel.title).toBe(`Land ${RUN}?`);
    expect(panel.keys.map((hint) => hint.key)).toEqual(["Enter", "Esc"]);
    const text = panel.lines.join("\n");
    expect(text).toContain(RUN);
    expect(text).toContain("merged into their base branches locally");
    expect(text).toContain("worktrees and run state removed");
    expect(text).toContain("nothing is pushed");
  });

  test("no child runs until Enter or y confirms and Esc or n cancels", async () => {
    const fake = fakeFactory();
    const { launcher, launches } = resumeLauncher();
    const view = buildViewModel(viewInput(runState({ phase: "done" })));
    const action = landFor(view);
    if (action === null) throw new Error("land was not offered");

    expect(confirmKeys("n", key())).toBe("cancel");
    expect(confirmKeys("", key({ escape: true }))).toBe("cancel");
    expect(launches).toEqual([]);

    expect(confirmKeys("", key({ return: true }))).toBe("confirm");
    expect(confirmKeys("y", key())).toBe("confirm");
    await performControl({ factory: fake.factory, launcher }, action);
    expect(launches).toEqual([{ kind: "land", id: RUN }]);
  });
});

describe("land is offered only for a done run", () => {
  test("every other phase has no l hint, no landFor and no confirmation", () => {
    for (const phase of [
      "paused",
      "aborted",
      "queued",
      "implementing",
      "reviewing",
      "awaiting-approval",
    ] as const) {
      const view = buildViewModel(viewInput(runState({ phase })));
      expect(
        view.footer.some((hint) => hint.key === "l"),
        phase,
      ).toBe(false);
      expect(landFor(view), phase).toBeNull();
    }

    const done = buildViewModel(viewInput(runState({ phase: "done" })));
    expect(landFor(done)).toEqual({ kind: "land", id: RUN });
    expect(done.footer).toContainEqual({ key: "l", label: "land", enabled: true });
  });
});

describe("a double-tapped land launches one child", () => {
  test("two startLand calls launch one child and a finished child frees the guard", async () => {
    const fake = fakeFactory();
    const { launcher, launches, exit } = resumeLauncher();
    const run = runState({ phase: "done" });
    const deps = {
      factory: fake.factory,
      launcher,
      guard: createResumeGuard(),
      update: () => {},
      refresh: async () => ({ status: statusDoc(run), runs: [run] }),
      stopTail: () => {},
    };

    startLand(deps, RUN);
    startLand(deps, RUN);
    await Bun.sleep(0);
    expect(launches).toEqual([{ kind: "land", id: RUN }]);

    exit(0);
    await Bun.sleep(0);
    startLand(deps, RUN);
    await Bun.sleep(0);
    expect(launches).toHaveLength(2);
  });

  test("the second confirmation is ignored while the land child is in flight", () => {
    const view = buildViewModel(viewInput(runState({ phase: "done" })));
    const guard = createResumeGuard();
    expect(landConfirmation(view, guard)).toEqual({ kind: "land", id: RUN });

    expect(guard.begin(RUN)).toBe(true);
    expect(landConfirmation(view, guard)).toBeNull();

    guard.end(RUN);
    expect(landConfirmation(view, guard)).toEqual({ kind: "land", id: RUN });
  });
});

describe("a landed run leaves the screen", () => {
  test("a zero exit and a refreshed status without the run returns to the list with a notice", async () => {
    const fake = fakeFactory();
    const { launcher, exit } = resumeLauncher();
    const empty: StatusDocument = {
      active: null,
      driverAlive: false,
      queue: [],
      corrupt: [],
      runs: [],
    };
    const states: UiData[] = [];
    let stopped = 0;
    startLand(
      {
        factory: fake.factory,
        launcher,
        guard: createResumeGuard(),
        update: (change) => states.push(change(uiData())),
        refresh: async () => ({ status: empty, runs: [] }),
        stopTail: () => {
          stopped += 1;
        },
      },
      RUN,
    );
    await Bun.sleep(0);
    exit(0);
    await Bun.sleep(0);

    const last = states.at(-1);
    expect(last?.screen).toBe("list");
    expect(last?.selectedRunId).toBeNull();
    expect(last?.selectedTaskId).toBeNull();
    expect(last?.snapshot).toBeNull();
    expect(last?.notice).toContain(`landed ${RUN}`);
    expect(last?.notice).toContain("the run is gone");
    expect(stopped).toBe(1);
  });

  test("a still-listed run stays selected after a zero exit", () => {
    const run = runState({ phase: "done" });
    const next = landSettled(uiData(), RUN, { status: statusDoc(run), runs: [run] });
    expect(next.screen).toBe("run");
    expect(next.selectedRunId).toBe(RUN);
    expect(next.notice).toBeNull();
  });
});

describe("a failed land is visible", () => {
  test("a non-zero exit shows the code and the last ten log lines and never says it landed", () => {
    const dir = mkdtempSync(join(tmpdir(), "loomwright-land-"));
    try {
      const logPath = join(dir, "land.log");
      const lines = Array.from(
        { length: 12 },
        (_, index) => `log line ${String(index + 1).padStart(2, "0")}`,
      );
      writeFileSync(logPath, lines.join("\n"));
      const data = landFailed(uiData(), RUN, { logPath, displayPath: LOG }, 5);
      expect(data.notice).toContain(`land ${RUN} exited with code 5`);
      expect(data.notice).toContain(`spawn log: ${LOG}`);
      for (const line of lines.slice(-10)) expect(data.notice).toContain(line);
      expect(data.notice).not.toContain(lines[0]);
      expect(data.notice).not.toContain(lines[1]);
      expect(data.notice).not.toContain("landed");
      expect(data.selectedRunId).toBe(RUN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a running land keeps its spawn log path on screen until the child settles", async () => {
    const fake = fakeFactory();
    const { launcher, exit } = resumeLauncher(join(tmpdir(), "land.log"), LOG);
    const states: UiData[] = [];
    startLand(
      {
        factory: fake.factory,
        launcher,
        guard: createResumeGuard(),
        update: (change) => states.push(change(uiData())),
        refresh: async () => null,
        stopTail: () => {},
      },
      RUN,
    );
    await Bun.sleep(0);
    expect(states.at(-1)?.notice).toContain(`land ${RUN}`);
    expect(states.at(-1)?.notice).toContain(`spawn log: ${LOG}`);

    // A child that never reports a code keeps the path next to the reason.
    exit(null);
    await Bun.sleep(0);
    expect(states.at(-1)?.notice).toContain("ended without an exit code");
    expect(states.at(-1)?.notice).toContain(`spawn log: ${LOG}`);
  });

  test("startLand surfaces a failed child and leaves the run selected", async () => {
    const fake = fakeFactory();
    const dir = mkdtempSync(join(tmpdir(), "loomwright-land-"));
    try {
      const logPath = join(dir, "land.log");
      writeFileSync(logPath, "merge conflict\n");
      const { launcher, exit } = resumeLauncher(logPath, LOG);
      const states: UiData[] = [];
      startLand(
        {
          factory: fake.factory,
          launcher,
          guard: createResumeGuard(),
          update: (change) => states.push(change(uiData())),
          refresh: async () => null,
          stopTail: () => {},
        },
        RUN,
      );
      await Bun.sleep(0);
      exit(3);
      await Bun.sleep(0);

      const last = states.at(-1);
      expect(last?.notice).toContain("exited with code 3");
      expect(last?.notice).toContain(`spawn log: ${LOG}`);
      expect(last?.notice).toContain("merge conflict");
      expect(last?.notice).not.toContain("landed");
      expect(last?.selectedRunId).toBe(RUN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("land is a child, not a call", () => {
  test("performControl launches the detached land and never calls Factory.land", async () => {
    const fake = fakeFactory();
    const { launcher, launches } = resumeLauncher();
    const result = await performControl(
      { factory: fake.factory, launcher },
      { kind: "land", id: RUN },
    );
    expect(result.pid).toBe(4242);
    expect(launches).toEqual([{ kind: "land", id: RUN }]);
    expect("land" in fake.factory).toBe(false);
  });
});

describe("quit restores the terminal", () => {
  function fakeStreams(): {
    readonly stdin: NodeJS.ReadStream;
    readonly stdout: NodeJS.WriteStream;
    readonly writes: string[];
    readonly raw: boolean[];
  } {
    const writes: string[] = [];
    const raw: boolean[] = [];
    const stdin = {
      isRaw: false,
      setRawMode(value: boolean): void {
        raw.push(value);
      },
      on(): void {},
      off(): void {},
      resume(): void {},
      pause(): void {},
    };
    const stdout = {
      columns: 80,
      rows: 24,
      write(chunk: string): boolean {
        writes.push(chunk);
        return true;
      },
      on(): void {},
      off(): void {},
    };
    return {
      writes,
      raw,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    };
  }

  test("quit leaves once and the last write is the cursor-show and alternate-screen-off", async () => {
    const streams = fakeStreams();
    const real = createTerminalSession(streams.stdin, streams.stdout);
    let leaves = 0;
    const session: TerminalSession = {
      enter: () => real.enter(),
      leave: () => {
        leaves += 1;
        real.leave();
      },
      get columns(): number {
        return real.columns;
      },
      get rows(): number {
        return real.rows;
      },
      onKey: (handler) => real.onKey(handler),
      onResize: (handler) => real.onResize(handler),
      onSignal: (handler) => real.onSignal(handler),
    };

    await runInSession({ session, render: async () => {} });

    expect(leaves).toBe(1);
    expect(streams.writes.at(-1)).toContain("[?25h");
    expect(streams.writes.at(-1)).toContain("[?1049l");
    expect(streams.raw).toEqual([true, false]);
  });

  test("a thrown render leaves once too", async () => {
    const streams = fakeStreams();
    const real = createTerminalSession(streams.stdin, streams.stdout);
    let leaves = 0;
    const session: TerminalSession = {
      enter: () => real.enter(),
      leave: () => {
        leaves += 1;
        real.leave();
      },
      get columns(): number {
        return real.columns;
      },
      get rows(): number {
        return real.rows;
      },
      onKey: (handler) => real.onKey(handler),
      onResize: (handler) => real.onResize(handler),
      onSignal: (handler) => real.onSignal(handler),
    };

    await expect(
      runInSession({
        session,
        render: async () => {
          throw new Error("view threw");
        },
      }),
    ).rejects.toThrow("view threw");

    expect(leaves).toBe(1);
    expect(streams.writes.at(-1)).toContain("[?25h");
    expect(streams.writes.at(-1)).toContain("[?1049l");
  });
});

describe("the launcher matrix is complete", () => {
  test("resume is already in the argv matrix and the UI never waits for it", () => {
    const actions: readonly LaunchAction[] = [
      { kind: "run-text", text: "add a health endpoint" },
      { kind: "run-file", path: "/ws/request.md" },
      { kind: "approve", id: RUN },
      { kind: "approve-only", id: RUN },
      { kind: "reword", id: RUN },
      { kind: "reapprove", id: RUN },
      { kind: "resume", id: RUN },
      { kind: "land", id: RUN },
    ];
    expect(actions.map((action) => actionArgs(action)[0])).toEqual([
      "run",
      "run",
      "approve",
      "approve",
      "reword",
      "reapprove",
      "resume",
      "land",
    ]);
  });
});
