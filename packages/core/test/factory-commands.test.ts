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
} from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { readApproval, specHash } from "../src/approval/approval.ts";
import { PreconditionError, UsageError } from "../src/errors.ts";
import { reduce } from "../src/events/protocol.ts";
import { readEvents } from "../src/events/reader.ts";
import { git } from "../src/exec.ts";
import { type Factory, open, type RunOutcome } from "../src/factory.ts";
import type { AgentRuntime } from "../src/runtime/types.ts";
import { claimActive, readActive } from "../src/state/active.ts";
import { factoryDir } from "../src/state/files.ts";
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

  test("an answer is delivered and consumed", async () => {
    const h = await harness(script({ questions: ["Ship it?"] }));
    await h.factory.run(RUN_REQUEST);
    const designedRun = loadRun(fx.root, ID);
    expect(designedRun?.clarifications.some((c) => c.status === "unanswered")).toBe(true);
    await updateRun(fx.root, ID, (draft) => {
      draft.phase = "paused";
      draft.pausedReason = "needs an answer";
    });

    await h.factory.answer(ID, "yes", "Ship it?");
    expect(readdirSync(inboxOf())).toHaveLength(1);
    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("awaiting-approval");

    const run = loadRun(fx.root, ID);
    const record = run?.clarifications.find((c) => c.question === "Ship it?");
    expect(record?.status).toBe("answered");
    expect(record?.answer).toBe("yes");
    expect(readdirSync(inboxOf())).toHaveLength(0);

    const answered = readEvents(fx.root, ID).events.filter(
      (event) => event.type === "question.answered",
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]?.data).toMatchObject({
      question: "Ship it?",
      status: "answered",
      answer: "yes",
    });
  });

  test("an answer with no recorded question is appended", async () => {
    saveRun(fx.root, newRun(ID, RUN_REQUEST, "awaiting-approval"));
    const h = await harness(script());

    await h.factory.answer(ID, "late answer", "Unrecorded?");
    const outcome = await h.factory.resume(ID);
    expect(outcome.phase).toBe("awaiting-approval");
    const record = loadRun(fx.root, ID)?.clarifications.find((c) => c.question === "Unrecorded?");
    expect(record).toMatchObject({
      step: "answer",
      status: "answered",
      answer: "late answer",
    });
    expect(readdirSync(inboxOf())).toHaveLength(0);
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
    expect(readdirSync(inboxOf()).sort()).toHaveLength(2);
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
