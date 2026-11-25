import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { type Script, ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  createSingleRepoFixture,
  type Fixture,
  fixtureGit,
  writeFiles,
} from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { readApproval, specHash } from "../src/approval/approval.ts";
import { PreconditionError, UsageError } from "../src/errors.ts";
import { writeCommand } from "../src/events/inbox.ts";
import { reduce } from "../src/events/protocol.ts";
import { readEvents } from "../src/events/reader.ts";
import { git } from "../src/exec.ts";
import { type Factory, open, type RunOutcome } from "../src/factory.ts";
import type { AgentRuntime } from "../src/runtime/types.ts";
import { claimActive, readActive, readQueue } from "../src/state/active.ts";
import { factoryDir, withFileLock } from "../src/state/files.ts";
import { loadRun, newRun, saveRun, TaskState, updateRun } from "../src/state/run.ts";

const ID = "add-health";
const RUN_REQUEST = "Add math helpers";

const PASS_ALL = {
  format: "true",
  lint: "true",
  types: "true",
  test: "true",
  testAffected: "true",
} as const;

const TASKS: ScriptedTask[] = [
  {
    id: "1.1",
    title: "Add a multiply helper",
    repo: "app",
    deps: [],
    touches: ["src/mul.ts"],
    file: "src/mul.ts",
    content: "export const mul = (a: number, b: number): number => a * b;\n",
  },
];

let fx: Fixture;

beforeEach(async () => {
  fx = await createSingleRepoFixture();
  expect((await cli(fx.root, "init")).code).toBe(0);
});

afterEach(() => fx.cleanup());

/** The scripted team, optionally asking a question in design and delaying implementers. */
function script(options: { delayMs?: number; questions?: readonly string[] } = {}): Script {
  const team = factoryScript({
    changeId: ID,
    summary: "Math helpers",
    repos: ["app"],
    tasks: TASKS,
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
  });
  if (options.questions === undefined) return team;
  const questions = options.questions;
  return async (call) => {
    const step = await team(call);
    if (call.agent === "architect" && call.prompt.startsWith("Write the OpenSpec change")) {
      return {
        ...step,
        handoff: { ...(step.handoff ?? {}), openQuestions: [...questions] },
      };
    }
    return step;
  };
}

interface Harness {
  readonly factory: Factory;
  readonly runtime: ScriptedRuntime;
  readonly out: string[];
  readonly err: string[];
}

async function harness(team: Script): Promise<Harness> {
  const runtime = new ScriptedRuntime(team);
  const out: string[] = [];
  const err: string[] = [];
  const factory = await open(fx.root, {
    runtime: () => runtime,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    heartbeatMs: 0,
  });
  return { factory, runtime, out, err };
}

/** Gates must pass for a complete run; the fixture's real toolchain is irrelevant here. */
async function configureGates(): Promise<void> {
  const file = join(fx.root, "factory.config.jsonc");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      '"overrides": {}',
      `"overrides": ${JSON.stringify({ app: PASS_ALL })}`,
    ),
  );
  await fixtureGit(fx.root, "commit", "-q", "-am", "chore: configure the factory");
}

/** Designs the change and stops at approval, without approving it. */
async function readyToApprove(team: Script): Promise<Harness> {
  await configureGates();
  const h = await harness(team);
  const outcome = await h.factory.run(RUN_REQUEST);
  expect(outcome.phase).toBe("awaiting-approval");
  return h;
}

/** Designs and approves without continuing: the starting point of the drive tests. */
async function designed(team: Script): Promise<Harness> {
  const h = await readyToApprove(team);
  await h.factory.approve(ID, { continue: false });
  return h;
}

/** A designed run paused on the design question a reader would answer. */
async function pausedOnQuestion(team: Script): Promise<Harness> {
  const h = await harness(team);
  await h.factory.run(RUN_REQUEST);
  await updateRun(fx.root, ID, (draft) => {
    draft.phase = "paused";
    draft.pausedReason = "needs an answer";
  });
  return h;
}

/** A run awaiting approval with one unanswered question and no event log yet. */
function seedQuestion(options: { draft?: string } = {}): void {
  const run = newRun(ID, RUN_REQUEST, "awaiting-approval");
  run.clarifications = [
    { step: "design", question: "Ship it?", status: "unanswered", at: "2026-01-01T00:00:00.000Z" },
  ];
  if (options.draft !== undefined) run.draft = options.draft;
  // The change folder exists before an answer; the writer only adds questions.md to it.
  const specDir = options.draft === undefined ? fx.root : join(fx.root, options.draft);
  mkdirSync(join(specDir, "openspec", "changes", ID), { recursive: true });
  saveRun(fx.root, run);
}

/** A stale answer with a fixed name that sorts before the `Date.now()` names `writeCommand` makes. */
function writeStaleAnswer(answer: string): void {
  mkdirSync(inboxOf(), { recursive: true });
  writeFileSync(
    join(inboxOf(), "answer-0.json"),
    JSON.stringify({ command: "answer", runId: ID, question: "Ship it?", answer }),
  );
}

const questionEvents = () =>
  readEvents(fx.root, ID).events.filter((event) => event.type === "question.answered");

/** Starts `resume` and pauses while the first implementer turn is in flight. */
async function pauseDuringImplement(h: Harness): Promise<RunOutcome> {
  const driving = h.factory.resume(ID);
  const deadline = Date.now() + 15_000;
  const inImplementer = (): boolean =>
    h.runtime.calls.some((call) => call.agent.startsWith("implementer-"));
  while (!inImplementer() && Date.now() < deadline) await Bun.sleep(10);
  expect(inImplementer()).toBe(true);
  await h.factory.pause(ID);
  return driving;
}

function inboxOf(): string {
  return factoryDir(fx.root, "commands", ID);
}

describe("Factory commands", () => {
  test("the API surface is complete", async () => {
    const factory: Factory = await open(fx.root);

    expect(Object.keys(factory).sort()).toEqual(
      [
        "abort",
        "answer",
        "approve",
        "events",
        "listRuns",
        "pause",
        "retry",
        "resume",
        "run",
        "status",
      ].sort(),
    );
    const writes = ["run", "resume", "approve", "retry", "abort", "answer", "pause"] as const;
    for (const member of writes) {
      expect(factory[member]).toBeInstanceOf(Function);
      expect(factory[member].constructor.name).toBe("AsyncFunction");
    }
  });

  test("approve keeps the hash and commit rules", async () => {
    const h = await readyToApprove(script());

    const approval = await h.factory.approve(ID, { continue: false });
    expect(existsSync(join(fx.root, ".factory", "approvals", `${ID}.json`))).toBe(true);
    const stored = readApproval(fx.root, ID);
    if (stored === undefined) throw new Error("approve did not record an approval");
    expect(stored).toEqual(approval);
    expect(stored.approver).toBe("fixture@example.com");
    expect(stored.specCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(stored.hash).toBe(specHash(fx.root, ID));
    const onBranch = await git(["merge-base", "--is-ancestor", stored.specCommit, `change/${ID}`], {
      cwd: fx.root,
    });
    expect(onBranch.code).toBe(0);

    // An edit after approval fails the same verifyApproval check the CLI runs.
    const file = join(fx.root, "openspec", "changes", ID, "proposal.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}\nA late edit.\n`);
    try {
      await h.factory.resume(ID);
      throw new Error("resume should have rejected the edited spec");
    } catch (err: unknown) {
      if (!(err instanceof PreconditionError)) throw err;
      expect(err.message).toBe(`the spec of ${ID} changed after approval`);
    }
  });

  test("an adopted change approved without a log starts at seq 1 with run.started", async () => {
    const dir = `openspec/changes/${ID}`;
    writeFiles(fx.root, {
      [`${dir}/.openspec.yaml`]: "schema: spec-driven\n",
      [`${dir}/proposal.md`]:
        "## Why\nExisting teams already use OpenSpec and want the factory to finish their changes.\n\n## What Changes\n- Add the endpoint\n",
      [`${dir}/design.md`]:
        "## Context\nSmall change.\n\n## Decisions\n- Reuse the existing server.\n",
      [`${dir}/specs/health/spec.md`]:
        "## ADDED Requirements\n\n### Requirement: Health endpoint\nThe service SHALL expose GET /health.\n\n#### Scenario: Healthy\n- **WHEN** a client calls GET /health\n- **THEN** the response is 200\n",
      [`${dir}/tasks.md`]:
        "## 1. app\n\n- [ ] 1.1 Add the endpoint\n  - repo: app\n  - deps: none\n  - touches: src/**\n",
    });
    await fixtureGit(fx.root, "add", "-A");
    await fixtureGit(fx.root, "commit", "-q", "-m", `docs(spec): ${ID}`);
    expect((await cli(fx.root, "adopt", ID)).code).toBe(0);
    expect(existsSync(join(fx.root, ".factory", "events", `${ID}.jsonl`))).toBe(false);

    const h = await harness(script());
    await h.factory.approve(ID, { continue: false });

    const events = readEvents(fx.root, ID).events;
    expect(events[0]?.type).toBe("run.started");
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.data).toMatchObject({ phase: "awaiting-approval" });
    const snapshot = reduce(events);
    expect(snapshot.phase).toBe("queued");
    expect(snapshot.lastSeq).toBe(events.length);
  });

  test("a second driver is rejected", async () => {
    const run = newRun(ID, RUN_REQUEST, "implementing");
    run.tasks = [
      TaskState.parse({
        id: "1.1",
        title: "Task 1.1",
        repo: "app",
        deps: [],
        touches: ["src/**"],
        status: "pending",
      }),
    ];
    saveRun(fx.root, run);
    await claimActive(fx.root, ID, process.ppid);
    const before = readActive(fx.root);
    const h = await harness(script());

    try {
      await h.factory.resume(ID);
      throw new Error("resume should have rejected the live driver");
    } catch (err: unknown) {
      if (!(err instanceof PreconditionError)) throw err;
      expect(err.message).toBe(`${ID} is already being driven by pid ${process.ppid}`);
    }
    expect(readActive(fx.root)).toEqual(before);
    expect(h.runtime.calls).toHaveLength(0);
  });

  test("a command for a second change keeps the active change's driver claimed", async () => {
    const h = await readyToApprove(script());
    saveRun(fx.root, newRun("other-change", "Someone else's change", "implementing"));
    await claimActive(fx.root, "other-change");
    const before = readActive(fx.root);

    await h.factory.approve(ID);

    expect(readActive(fx.root)).toEqual(before);
    expect(readQueue(fx.root).entries.map((entry) => entry.changeId)).toEqual([ID]);
  });

  test("the driver of the change a command drove is released when it fails", async () => {
    const h = await readyToApprove(script());
    await h.factory.approve(ID, { continue: false });
    const file = join(fx.root, "openspec", "changes", ID, "proposal.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}\nA late edit.\n`);

    await expect(h.factory.resume(ID)).rejects.toThrow(/changed after approval/);

    expect(readActive(fx.root)).toMatchObject({ changeId: ID, pid: null });
  });

  test("an answer is delivered and consumed", async () => {
    const h = await pausedOnQuestion(script({ questions: ["Ship it?"] }));
    const designedRun = loadRun(fx.root, ID);
    expect(designedRun?.clarifications.some((c) => c.status === "unanswered")).toBe(true);

    writeCommand(fx.root, {
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "yes",
    });
    expect(readdirSync(inboxOf())).toHaveLength(1);
    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("awaiting-approval");

    const run = loadRun(fx.root, ID);
    const record = run?.clarifications.find((c) => c.question === "Ship it?");
    expect(record?.status).toBe("answered");
    expect(record?.answer).toBe("yes");
    expect(readdirSync(inboxOf())).toHaveLength(0);

    const answered = questionEvents();
    expect(answered).toHaveLength(1);
    expect(answered[0]?.data).toMatchObject({
      question: "Ship it?",
      status: "answered",
      answer: "yes",
    });
  });

  test("a live driver owns the answer", async () => {
    const h = await pausedOnQuestion(script({ questions: ["Ship it?"] }));
    // A live pid makes `driverAlive` accept this process as the driver.
    await claimActive(fx.root, ID);
    const before = loadRun(fx.root, ID);

    await h.factory.answer(ID, "yes", "Ship it?");

    expect(readdirSync(inboxOf())).toHaveLength(1);
    expect(loadRun(fx.root, ID)).toEqual(before);
    expect(questionEvents()).toHaveLength(0);

    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("awaiting-approval");
    expect(
      loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Ship it?"),
    ).toMatchObject({ status: "answered", answer: "yes" });
    expect(readdirSync(inboxOf())).toHaveLength(0);
    expect(questionEvents()).toHaveLength(1);
    expect(readFileSync(join(fx.root, ".factory", "clarifications", `${ID}.md`), "utf8")).toContain(
      "**Answer:** yes",
    );
    expect(
      readFileSync(join(fx.root, "openspec", "changes", ID, "questions.md"), "utf8"),
    ).toContain("**Answer:** yes");
  });

  test("an answer with no driver is persisted immediately", async () => {
    seedQuestion();
    const before = loadRun(fx.root, ID);
    const factory = await open(fx.root);

    await factory.answer(ID, "yes", "Ship it?");

    const after = loadRun(fx.root, ID);
    expect(after?.clarifications).toEqual([
      {
        step: "design",
        question: "Ship it?",
        status: "answered",
        answer: "yes",
        at: expect.any(String),
      },
    ]);
    expect(after?.phase).toBe(before?.phase);
    expect(after?.tasks).toEqual(before?.tasks);
    expect(existsSync(join(fx.root, ".factory", "approvals", `${ID}.json`))).toBe(false);

    const answered = questionEvents();
    expect(answered).toHaveLength(1);
    expect(answered[0]?.data).toMatchObject({
      step: "design",
      question: "Ship it?",
      status: "answered",
      answer: "yes",
    });

    expect(readFileSync(join(fx.root, ".factory", "clarifications", `${ID}.md`), "utf8")).toContain(
      "**Answer:** yes",
    );
    expect(
      readFileSync(join(fx.root, "openspec", "changes", ID, "questions.md"), "utf8"),
    ).toContain("**Answer:** yes");
    expect(existsSync(inboxOf())).toBe(false);
  });

  test("the draft's questions file is the one rewritten", async () => {
    const draft = join(".factory", "worktrees", ID, "app", "draft");
    seedQuestion({ draft });
    const factory = await open(fx.root);

    await factory.answer(ID, "yes", "Ship it?");

    expect(
      readFileSync(join(fx.root, draft, "openspec", "changes", ID, "questions.md"), "utf8"),
    ).toContain("**Answer:** yes");
    expect(existsSync(join(fx.root, "openspec", "changes", ID, "questions.md"))).toBe(false);
  });

  test("a direct apply removes a stale answer file", async () => {
    seedQuestion();
    writeCommand(fx.root, {
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "stale",
    });
    const factory = await open(fx.root);

    await factory.answer(ID, "fresh", "Ship it?");

    expect(readdirSync(inboxOf())).toHaveLength(0);
    expect(
      loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Ship it?")?.answer,
    ).toBe("fresh");
    expect(questionEvents()).toHaveLength(1);
  });

  test("a deferred answer removes a stale answer file", async () => {
    seedQuestion();
    writeStaleAnswer("stale");
    const factory = await open(fx.root);
    const lock = join(factoryDir(fx.root, "runs"), `${ID}.json.lock`);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = withFileLock(lock, () => held);

    const answering = factory.answer(ID, "fresh", "Ship it?");
    // A driver claims the run while the answer waits for the lock, so it is deferred to the inbox.
    await claimActive(fx.root, ID);
    release();
    await locked;
    await answering;

    const files = readdirSync(inboxOf());
    expect(files).toHaveLength(1);
    const fileName = files[0];
    if (fileName === undefined) throw new Error("the deferred answer did not write an inbox file");
    expect(JSON.parse(readFileSync(join(inboxOf(), fileName), "utf8"))).toMatchObject({
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "fresh",
    });
  });

  test("a live driver answer replaces a stale answer file", async () => {
    const h = await pausedOnQuestion(script({ questions: ["Ship it?"] }));
    await claimActive(fx.root, ID);
    writeStaleAnswer("stale");

    await h.factory.answer(ID, "fresh", "Ship it?");

    const files = readdirSync(inboxOf());
    expect(files).toHaveLength(1);
    const fileName = files[0];
    if (fileName === undefined) throw new Error("the live answer did not write an inbox file");
    expect(JSON.parse(readFileSync(join(inboxOf(), fileName), "utf8"))).toMatchObject({
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "fresh",
    });
    expect(questionEvents()).toHaveLength(0);
  });

  test("an answer for a missing run keeps the inbox file", async () => {
    const factory = await open(fx.root);

    await factory.answer(ID, "yes", "Ship it?");

    // The run file does not exist, so the writer keeps the inbox write for a later process.
    expect(loadRun(fx.root, ID)).toBeUndefined();
    const files = readdirSync(inboxOf());
    expect(files).toHaveLength(1);
    const fileName = files[0];
    if (fileName === undefined) throw new Error("the answer did not write an inbox file");
    expect(JSON.parse(readFileSync(join(inboxOf(), fileName), "utf8"))).toMatchObject({
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "yes",
    });
    expect(existsSync(join(fx.root, ".factory", "clarifications", `${ID}.md`))).toBe(false);
    expect(existsSync(join(fx.root, ".factory", "events", `${ID}.jsonl`))).toBe(false);
  });

  test("a re-delivered answer is a no-op", async () => {
    seedQuestion();
    const factory = await open(fx.root);
    await factory.answer(ID, "first", "Ship it?");
    expect(questionEvents()).toHaveLength(1);
    writeCommand(fx.root, {
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "stale",
    });

    await factory.answer(ID, "second", "Ship it?");

    expect(
      loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Ship it?")?.answer,
    ).toBe("first");
    expect(questionEvents()).toHaveLength(1);
    expect(readdirSync(inboxOf())).toHaveLength(0);
    // Idempotency still repairs the clarification files.
    expect(readFileSync(join(fx.root, ".factory", "clarifications", `${ID}.md`), "utf8")).toContain(
      "**Answer:** first",
    );
    expect(
      readFileSync(join(fx.root, "openspec", "changes", ID, "questions.md"), "utf8"),
    ).toContain("**Answer:** first");
  });

  test("a re-delivered answer is a no-op when the driver consumes the inbox", async () => {
    seedQuestion();
    const h = await harness(script());
    await h.factory.answer(ID, "first", "Ship it?");
    expect(questionEvents()).toHaveLength(1);
    writeCommand(fx.root, {
      command: "answer",
      runId: ID,
      question: "Ship it?",
      answer: "stale",
    });

    const outcome = await h.factory.resume(ID);

    expect(outcome.phase).toBe("awaiting-approval");
    expect(
      loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Ship it?")?.answer,
    ).toBe("first");
    // The driver's unchanged branch emits nothing and still removes the stale file.
    expect(questionEvents()).toHaveLength(1);
    expect(readdirSync(inboxOf())).toHaveLength(0);
    expect(readFileSync(join(fx.root, ".factory", "clarifications", `${ID}.md`), "utf8")).toContain(
      "**Answer:** first",
    );
  });

  test("an unrecorded question keeps the fallback", async () => {
    saveRun(fx.root, newRun(ID, RUN_REQUEST, "awaiting-approval"));
    const h = await harness(script());

    await h.factory.answer(ID, "late answer", "Unrecorded?");

    const record = loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Unrecorded?");
    expect(record).toMatchObject({
      step: "answer",
      status: "answered",
      answer: "late answer",
    });
    const answered = questionEvents();
    expect(answered).toHaveLength(1);
    expect(answered[0]?.data).toMatchObject({
      step: "answer",
      question: "Unrecorded?",
      status: "answered",
      answer: "late answer",
    });
    expect(existsSync(inboxOf())).toBe(false);
  });

  test("a pause is requested and consumed", async () => {
    const h = await designed(script({ delayMs: 300 }));
    const before = loadRun(fx.root, ID);
    // Sentinel under the worktree root: pause must not clean up what the step kept.
    const sentinel = join(fx.root, ".factory", "worktrees", ID, "app", "sentinel");
    mkdirSync(sentinel, { recursive: true });
    writeFileSync(join(sentinel, "kept.txt"), "kept\n");

    const outcome = await pauseDuringImplement(h);
    expect(outcome).toMatchObject({ phase: "paused", detail: "pause requested" });

    const run = loadRun(fx.root, ID);
    expect(before?.branches["."]).toBeDefined();
    expect(run?.phase).toBe("paused");
    expect(run?.pausedReason).toBe("pause requested");
    expect(run?.branches["."]).toEqual(before?.branches["."]);
    expect(run?.branches.app?.branch).toBe(`change/${ID}`);
    expect(run?.tasks.some((task) => task.status === "merged")).toBe(true);
    expect(existsSync(join(sentinel, "kept.txt"))).toBe(true);
    expect(readdirSync(inboxOf())).toHaveLength(0);
    const active = readActive(fx.root);
    expect(active?.changeId).toBe(ID);
    expect(active?.pid).toBeNull();

    const events = readEvents(fx.root, ID).events;
    const requested = events.findIndex((event) => event.type === "run.pause-requested");
    const stopped = events.findIndex((event) => event.type === "run.paused");
    expect(requested).toBeGreaterThanOrEqual(0);
    expect(stopped).toBeGreaterThan(requested);
    expect(events.filter((event) => event.type === "run.paused")).toHaveLength(1);
    const snapshot = reduce(events);
    expect(snapshot.phase).toBe("paused");
    expect(snapshot.pausedReason).toBe("pause requested");
  });

  test("pause then resume continues from paused", async () => {
    const h = await designed(script({ delayMs: 200 }));
    const paused = await pauseDuringImplement(h);
    expect(paused.phase).toBe("paused");

    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("done");
    expect(loadRun(fx.root, ID)?.pausedReason).toBeUndefined();
    // The replay matches the run file: resuming drops the reason the pause recorded.
    const snapshot = reduce(readEvents(fx.root, ID).events);
    expect(snapshot.phase).toBe("done");
    expect(snapshot.pausedReason).toBeNull();
    const starts = readEvents(fx.root, ID).events.filter((event) => event.type === "run.started");
    expect(starts).toHaveLength(1);
  });

  test("an invalid command file is rejected", async () => {
    saveRun(fx.root, newRun(ID, RUN_REQUEST, "awaiting-approval"));
    const inbox = inboxOf();
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "clean-1.json"), JSON.stringify({ command: "clean", runId: ID }));
    writeFileSync(join(inbox, "broken-1.json"), "not json");
    writeFileSync(join(inbox, "approve-1.json"), JSON.stringify({ command: "approve", runId: ID }));
    const h = await harness(script());

    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("awaiting-approval");
    expect(h.err.some((line) => line.includes("clean-1.json"))).toBe(true);
    expect(h.err.some((line) => line.includes("broken-1.json"))).toBe(true);
    expect(h.err.some((line) => line.includes("approve-1.json"))).toBe(true);
    expect(readdirSync(inbox).sort()).toEqual(["approve-1.json", "broken-1.json", "clean-1.json"]);
  });

  test("a partial or temp command file is ignored until it is renamed", async () => {
    saveRun(fx.root, newRun(ID, RUN_REQUEST, "awaiting-approval"));
    const inbox = inboxOf();
    mkdirSync(inbox, { recursive: true });
    const temp = join(inbox, "pause-123.json.tmp");
    writeFileSync(temp, JSON.stringify({ command: "pause", runId: ID }));
    const h = await harness(script());

    await h.factory.resume(ID);
    expect(loadRun(fx.root, ID)?.phase).toBe("awaiting-approval");
    expect(existsSync(temp)).toBe(true);

    renameSync(temp, join(inbox, "pause-123.json"));
    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("paused");
    expect(loadRun(fx.root, ID)?.pausedReason).toBe("pause requested");
  });

  test("abort is unchanged", async () => {
    const run = newRun(ID, RUN_REQUEST, "paused");
    run.branches["."] = { branch: `change/${ID}`, base: "0".repeat(40) };
    saveRun(fx.root, run);
    await claimActive(fx.root, ID);
    const h = await harness(script());

    await h.factory.abort(ID);

    const after = loadRun(fx.root, ID);
    expect(after?.phase).toBe("aborted");
    expect(after?.abortRequested).toBe(true);
    expect(after?.branches).toEqual(run.branches);
    expect(readActive(fx.root)).toBeUndefined();
  });

  test("a malformed runId is rejected before a control command acts", async () => {
    const factory = await open(fx.root);
    const commands: (() => Promise<unknown>)[] = [
      () => factory.resume("../../x"),
      () => factory.approve("../../x"),
      () => factory.retry("../../x", "1.1"),
      () => factory.abort("../../x"),
      () => factory.answer("../../x", "yes"),
      () => factory.pause("../../x"),
    ];
    for (const command of commands) {
      await expect(command()).rejects.toThrow(/expected a change id/);
    }
    expect(existsSync(join(fx.root, "x"))).toBe(false);
    expect(existsSync(join(fx.root, ".factory", "commands"))).toBe(false);
  });

  test("no listener is started", async () => {
    const eventsDir = join(import.meta.dir, "..", "src", "events");
    const sources = [
      join(import.meta.dir, "..", "src", "factory.ts"),
      ...readdirSync(eventsDir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(eventsDir, name)),
    ];
    const forbidden = /from\s+"node:(?:net|http|http2|dgram|child_process)"/;
    for (const file of sources) expect(readFileSync(file, "utf8")).not.toMatch(forbidden);

    saveRun(fx.root, newRun(ID, RUN_REQUEST, "awaiting-approval"));
    const scripted = new ScriptedRuntime(script());
    let opens = 0;
    const counted: AgentRuntime = {
      open: (spec) => {
        opens += 1;
        return scripted.open(spec);
      },
      close: () => scripted.close(),
    };
    const factory = await open(fx.root, { runtime: () => counted });
    await factory.status();
    await factory.listRuns();
    const lines: string[] = [];
    for await (const line of factory.events(ID)) lines.push(line.line);
    expect(lines).toEqual([]);
    await factory.pause(ID);
    await factory.answer(ID, "yes");
    expect(opens).toBe(0);
    // The direct answer left no inbox file; only the pause request remains.
    expect(readdirSync(inboxOf())).toEqual([expect.stringContaining("pause")]);
  });

  test("retry keeps its usage errors", async () => {
    const run = newRun(ID, RUN_REQUEST, "implementing");
    run.tasks = [
      TaskState.parse({
        id: "1.1",
        title: "Task 1.1",
        repo: "app",
        deps: [],
        touches: ["src/**"],
        status: "pending",
      }),
    ];
    saveRun(fx.root, run);
    const factory = await open(fx.root);

    try {
      await factory.retry(ID, "nope");
      throw new Error("retry should have rejected an unknown task");
    } catch (err: unknown) {
      if (!(err instanceof UsageError)) throw err;
      expect(err.message).toBe(`retry: ${ID} has no task nope`);
    }
    try {
      await factory.retry(ID, "1.1");
      throw new Error("retry should have rejected a task that is not failed");
    } catch (err: unknown) {
      if (!(err instanceof PreconditionError)) throw err;
      expect(err.message).toBe("task 1.1 is pending, not failed");
    }
  });
});
