import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readApproval } from "@loomwright/core/approval/approval";
import { loadConfig } from "@loomwright/core/config/load";
import { eventLogPath } from "@loomwright/core/events/jsonl";
import { usageFromLedger } from "@loomwright/core/events/parity";
import { projectRunState } from "@loomwright/core/events/project";
import { RunEvent, type RunSnapshot, reduce } from "@loomwright/core/events/protocol";
import type { EventSink } from "@loomwright/core/events/sink";
import { TerminalSink } from "@loomwright/core/events/terminal";
import { ExitCode } from "@loomwright/core/exit-codes";
import { approve } from "@loomwright/core/pipeline/approve";
import { Pipeline } from "@loomwright/core/pipeline/context";
import { design, intake } from "@loomwright/core/pipeline/design";
import { drive } from "@loomwright/core/pipeline/drive";
import { Progress } from "@loomwright/core/pipeline/progress";
import { readActive, releaseDriver } from "@loomwright/core/state/active";
import { loadRun } from "@loomwright/core/state/run";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  BACKEND_FILES,
  createSingleRepoFixture,
  createSubmoduleFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { type NormaliseContext, normalise } from "./baseline-capture.ts";

/**
 * Golden event logs and reducer parity for the two stub layouts.
 *
 * The fixtures are captured by running the scenario, never written by hand. A deliberate
 * re-capture uses `UPDATE_GOLDENS=1 bun test packages/cli/test/events-golden.test.ts`: the
 * test then writes the fixtures instead of only comparing them. Keep it off by default.
 */

const ID = "add-health";
const EVENTS_DIR = join(import.meta.dir, "fixtures", "events");
const BASELINE_DIR = join(import.meta.dir, "fixtures", "baseline");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const UPDATE = process.env.UPDATE_GOLDENS === "1";
/** A valid ISO timestamp: `RunEvent.parse` requires one, and it must not be wall-clock. */
const FIXED_TS = "1970-01-01T00:00:00.000Z";

const ZERO_USAGE: RunSnapshot["usage"] = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

const PASS_ALL = {
  format: "true",
  lint: "true",
  types: "true",
  test: "true",
  testAffected: "true",
} as const;

const SINGLE_TASKS: readonly ScriptedTask[] = [
  {
    id: "1.1",
    title: "Add a multiply helper",
    repo: "app",
    deps: [],
    touches: ["src/mul.ts"],
    file: "src/mul.ts",
    content: "export const mul = (a: number, b: number) => a * b;\n",
  },
  {
    id: "1.2",
    title: "Add a divide helper",
    repo: "app",
    deps: ["1.1"],
    touches: ["src/div.ts"],
    file: "src/div.ts",
    content: "export const div = (a: number, b: number) => a / b;\n",
  },
];

const SUB_TASKS: readonly ScriptedTask[] = [
  {
    id: "1.1",
    title: "Add the health path to the OpenAPI contract",
    repo: "backend",
    deps: [],
    touches: ["api/openapi.yaml"],
    file: "api/openapi.yaml",
    content: (BACKEND_FILES["api/openapi.yaml"] ?? "").replace("version: 1.0.0", "version: 1.1.0"),
  },
  {
    id: "1.2",
    title: "Add the health handler",
    repo: "backend",
    deps: ["1.1"],
    touches: ["internal/http/**"],
    file: "internal/http/health.go",
    content: "package http\n",
  },
  {
    id: "1.3",
    title: "Add a readiness metric",
    repo: "backend",
    deps: ["1.2"],
    touches: ["internal/metrics/**"],
    file: "internal/metrics/ready.go",
    content: "package metrics\n",
  },
];

type ScenarioKind = "single" | "submodules";

interface Scenario {
  readonly request: string;
  readonly summary: string;
  readonly repos: readonly string[];
  readonly tasks: readonly ScriptedTask[];
  readonly testFiles: Readonly<Record<string, string>>;
}

const SCENARIOS: Readonly<Record<ScenarioKind, Scenario>> = {
  single: {
    request: "Add a health endpoint",
    summary: "Math helpers",
    repos: ["app"],
    tasks: SINGLE_TASKS,
    testFiles: { app: "src/mul.test.ts" },
  },
  submodules: {
    request: "Add a health endpoint",
    summary: "Add a health endpoint and show it in the UI",
    repos: ["backend", "frontend"],
    tasks: SUB_TASKS,
    testFiles: { backend: "internal/http/health_test.go" },
  },
};

interface GoldenCheckpoint {
  readonly name: string;
  readonly uptoSeq: number;
  readonly state: RunSnapshot;
}

interface Golden {
  /** Normalised JSONL, one event per line, with a trailing newline. */
  readonly events: string;
  /** What `events <id>` printed, normalised, without a trailing newline. */
  readonly printed: string;
  readonly checkpoints: readonly GoldenCheckpoint[];
  readonly state: RunSnapshot;
  readonly usage: RunSnapshot["usage"];
}

const captured = new Map<ScenarioKind, Golden>();

const contextFor = (fixture: Fixture): NormaliseContext => ({
  root: fixture.root,
  base: fixture.base,
  repoRoot: REPO_ROOT,
});

function goldenOf(kind: ScenarioKind): Golden {
  const golden = captured.get(kind);
  if (golden === undefined) throw new Error(`the ${kind} scenario did not run`);
  return golden;
}

function fixtureText(kind: ScenarioKind, suffix: string): string {
  return readFileSync(join(EVENTS_DIR, `${kind}.${suffix}`), "utf8");
}

/** Normalises one event line: volatile fields by name, then the shared text normaliser. */
function normaliseEvent(line: string, ctx: NormaliseContext): string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (err: unknown) {
    throw new Error(`golden line is not JSON: ${line.slice(0, 120)}`, { cause: err });
  }
  return JSON.stringify(normaliseValue(value, ctx));
}

function normaliseValue(value: unknown, ctx: NormaliseContext): unknown {
  if (typeof value === "string") return normalise(value, ctx);
  if (Array.isArray(value)) return value.map((entry) => normaliseValue(entry, ctx));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (key === "ts") return [key, FIXED_TS];
        if (key === "durationMs") return [key, 0];
        // Log offsets depend on how many digits a duration took in an earlier log line.
        if (key === "offset" || key === "bytes") return [key, 0];
        if (key === "sessionId") return [key, "<session>"];
        return [key, normaliseValue(entry, ctx)];
      }),
    );
  }
  return value;
}

function normaliseJsonl(text: string, ctx: NormaliseContext): string {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
  return lines.map((line) => normaliseEvent(line, ctx)).join("\n");
}

/** The projection has no timestamps; only hashes and other run-specific strings vary. */
function normaliseSnapshot(snapshot: RunSnapshot, ctx: NormaliseContext): RunSnapshot {
  const text = (value: string): string => normalise(value, ctx);
  const branches: RunSnapshot["branches"] = {};
  for (const [repo, info] of Object.entries(snapshot.branches))
    branches[repo] = { branch: text(info.branch), base: text(info.base) };
  return {
    ...snapshot,
    runId: text(snapshot.runId),
    pausedReason: snapshot.pausedReason === null ? null : text(snapshot.pausedReason),
    branches,
    questions: snapshot.questions.map((question) => ({
      ...question,
      question: text(question.question),
      ...(question.answer === undefined ? {} : { answer: text(question.answer) }),
    })),
    approval:
      snapshot.approval === null
        ? null
        : {
            specHash: text(snapshot.approval.specHash),
            specCommit: text(snapshot.approval.specCommit),
            approver: text(snapshot.approval.approver),
          },
  };
}

/** Mirrors `baseline-capture.ts`: gate overrides and one worker make the ordering stable. */
async function configure(fixture: Fixture, repos: readonly string[]): Promise<void> {
  const file = join(fixture.root, "factory.config.jsonc");
  const overrides = Object.fromEntries(repos.map((repo) => [repo, PASS_ALL]));
  const text = readFileSync(file, "utf8")
    .replace('"overrides": {}', `"overrides": ${JSON.stringify(overrides)}`)
    .replace('"maxAgents": 4', '"maxAgents": 1')
    .replace('"maxGateProcesses": 2', '"maxGateProcesses": 1');
  writeFileSync(file, text);
  await fixtureGit(fixture.root, "commit", "-q", "-am", "chore: configure the factory");
}

function fixtureOf(kind: ScenarioKind): Promise<Fixture> {
  return kind === "single" ? createSingleRepoFixture() : createSubmoduleFixture();
}

/**
 * Drives run → approve --no-continue → resume in-process with an extra sink, so each
 * `task.merged` sees the run file the pipeline just persisted. Returns normalised output.
 */
async function captureGolden(kind: ScenarioKind): Promise<Golden> {
  const scenario = SCENARIOS[kind];
  const fixture = await fixtureOf(kind);
  const ctx = contextFor(fixture);
  const checkpoints: GoldenCheckpoint[] = [];
  const runtime = new ScriptedRuntime(
    factoryScript({
      changeId: ID,
      summary: scenario.summary,
      repos: [...scenario.repos],
      tasks: scenario.tasks,
      testFiles: scenario.testFiles,
    }),
  );

  const capture = (name: string, uptoSeq: number): void => {
    const run = loadRun(fixture.root, ID);
    if (run === undefined) throw new Error(`no run state for ${ID} at checkpoint ${name}`);
    const approval = readApproval(fixture.root, ID);
    const state = projectRunState(run, approval === undefined ? {} : { approval });
    checkpoints.push({ name, uptoSeq, state: normaliseSnapshot(state, ctx) });
  };

  const sink: EventSink = {
    write(event) {
      if (event.type === "task.merged") capture(`after task ${event.data.task.id}`, event.seq);
    },
  };

  try {
    expect((await cli(fixture.root, "init")).code).toBe(ExitCode.Ok);
    await configure(fixture, scenario.repos);
    const p = new Pipeline(fixture.root, loadConfig(fixture.root).config, {
      runtime,
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
    });
    try {
      const id = await intake(p, scenario.request);
      if (id !== ID) throw new Error(`intake produced ${id}, not ${ID}`);
      const result = await design(p, id);
      if (!result.ok) throw new Error(`design did not validate: ${result.issues.join("; ")}`);
      capture("after run", p.events.lastSeq);

      await approve(p, id);
      capture("after approve", p.events.lastSeq);

      await drive(p, id);
      capture("final", p.events.lastSeq);

      const events = `${normaliseJsonl(readFileSync(eventLogPath(fixture.root, ID), "utf8"), ctx)}\n`;
      const printed = normaliseJsonl((await cli(fixture.root, "events", ID)).out, ctx);
      const run = loadRun(fixture.root, ID);
      if (run === undefined) throw new Error(`no final run state for ${ID}`);
      const approval = readApproval(fixture.root, ID);
      const state = normaliseSnapshot(
        projectRunState(run, approval === undefined ? {} : { approval }),
        ctx,
      );
      return { events, printed, checkpoints, state, usage: usageFromLedger(fixture.root, ID) };
    } finally {
      p.progress.stop();
    }
  } finally {
    await runtime.close();
    const active = readActive(fixture.root);
    if (active?.pid === process.pid) await releaseDriver(fixture.root, active.changeId);
    fixture.cleanup();
  }
}

/** Canonical JSON, exactly what the committed fixture must contain. */
function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, canonical(value));
}

function commit(kind: ScenarioKind, golden: Golden): void {
  if (!UPDATE) return;
  mkdirSync(EVENTS_DIR, { recursive: true });
  writeFileSync(join(EVENTS_DIR, `${kind}.jsonl`), golden.events);
  writeJson(join(EVENTS_DIR, `${kind}.checkpoints.json`), golden.checkpoints);
  writeJson(join(EVENTS_DIR, `${kind}.state.json`), golden.state);
  writeJson(join(EVENTS_DIR, `${kind}.usage.json`), golden.usage);
}

function parseGolden(text: string): RunEvent[] {
  const lines = text.trimEnd().split("\n");
  return lines.map((line, index) => {
    try {
      return RunEvent.parse(JSON.parse(line));
    } catch (err: unknown) {
      throw new Error(`golden line ${index + 1} does not parse as a RunEvent`, { cause: err });
    }
  });
}

/** Replays the stored stream through the terminal sink; baseline and replay share one normaliser. */
function replayGolden(kind: ScenarioKind): string[] {
  const lines: string[] = [];
  const progress = new Progress({ out: (line) => lines.push(line), heartbeatMs: 0, changeId: ID });
  const sink = new TerminalSink(progress);
  for (const event of parseGolden(fixtureText(kind, "jsonl"))) sink.write(event);
  progress.stop();
  // The golden normalised event text already; only rendered durations and tokens still vary.
  const ctx: NormaliseContext = { root: "", base: "", repoRoot: "" };
  return lines.map((line) => normalise(line, ctx));
}

/** One command's stdout from a baseline fixture, without its banner and the next one. */
function baselineSection(kind: ScenarioKind, label: string): string[] {
  const lines = readFileSync(join(BASELINE_DIR, `${kind}.stdout.txt`), "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`===== ${label} `));
  if (start === -1) throw new Error(`baseline ${kind} has no ${label} section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("===== "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

beforeAll(async () => {
  for (const kind of ["single", "submodules"] as const) {
    const golden = await captureGolden(kind);
    commit(kind, golden);
    captured.set(kind, golden);
  }
}, 300_000);

describe("event goldens", () => {
  test("the goldens are committed and normalised", () => {
    const forbidden: readonly (readonly [string, RegExp])[] = [
      ["timestamp", /\b(?:2025|2026)-\d{2}-\d{2}\b/],
      ["temp path", /ai-factory-(?:single|submodules)-/],
      ["tmp path", /\/tmp\//],
      ["session id", /\bses_test_/],
      ["pid", /\bpid\b/],
      ["long hash", /\b[0-9a-f]{40,64}\b/],
    ];
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldenOf(kind);
      expect(fixtureText(kind, "jsonl"), kind).toBe(golden.events);
      expect(fixtureText(kind, "checkpoints.json"), kind).toBe(canonical(golden.checkpoints));
      expect(fixtureText(kind, "state.json"), kind).toBe(canonical(golden.state));
      expect(fixtureText(kind, "usage.json"), kind).toBe(canonical(golden.usage));
      expect(golden.events.endsWith("\n"), kind).toBe(true);
      for (const suffix of ["jsonl", "checkpoints.json", "state.json", "usage.json"]) {
        const text = fixtureText(kind, suffix);
        for (const [label, pattern] of forbidden) {
          expect({ kind, suffix, label, match: pattern.exec(text)?.[0] }).toEqual({
            kind,
            suffix,
            label,
            match: undefined,
          });
        }
      }
    }
  });

  test("the goldens are committed and normalised: re-running the capture produces the same bytes", async () => {
    for (const kind of ["single", "submodules"] as const) {
      const first = goldenOf(kind);
      const second = await captureGolden(kind);
      expect(second.events, kind).toBe(first.events);
      expect(second.printed, kind).toBe(first.printed);
      expect(second.checkpoints, kind).toEqual(first.checkpoints);
      expect(second.state, kind).toEqual(first.state);
      expect(second.usage, kind).toEqual(first.usage);
    }
  }, 300_000);
});

describe("reducer parity", () => {
  test("reduce parity is checked at every checkpoint", () => {
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldenOf(kind);
      const events = parseGolden(fixtureText(kind, "jsonl"));
      expect(golden.checkpoints[0]?.name).toBe("after run");
      expect(golden.checkpoints[1]?.name).toBe("after approve");
      expect(golden.checkpoints.at(-1)?.name).toBe("final");
      for (const checkpoint of golden.checkpoints) {
        const reduced = reduce(events.filter((event) => event.seq <= checkpoint.uptoSeq));
        const comparable: RunSnapshot = {
          v: reduced.v,
          runId: reduced.runId,
          lastSeq: 0,
          phase: reduced.phase,
          pausedReason: reduced.pausedReason,
          abortRequested: reduced.abortRequested,
          branches: reduced.branches,
          tasks: reduced.tasks,
          questions: reduced.questions,
          approval: reduced.approval,
          // `pendingApproval` is not part of the projection, so the checkpoint cannot carry it.
          pendingApproval: null,
          usage: ZERO_USAGE,
          gates: {},
        };
        expect(comparable, `${kind}: ${checkpoint.name}`).toEqual(checkpoint.state);
      }
      const mergeCheckpoints = golden.checkpoints
        .map((checkpoint) => checkpoint.name)
        .filter((name) => name.startsWith("after task "));
      const mergedTasks = Object.entries(golden.state.tasks)
        .filter(([, task]) => task.status === "merged")
        .map(([id]) => `after task ${id}`);
      expect(mergeCheckpoints.sort(), kind).toEqual(mergedTasks.sort());
    }
  });

  test("replaying the golden stream equals the persisted state", () => {
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldenOf(kind);
      const events = parseGolden(fixtureText(kind, "jsonl"));
      const final = golden.checkpoints.at(-1);
      if (final === undefined) throw new Error(`${kind} has no final checkpoint`);
      expect(final.state, kind).toEqual(golden.state);
      expect(final.uptoSeq, kind).toBe(events.length);
      expect(reduce(events).lastSeq, kind).toBe(events.length);
    }
  });

  test("usage is counted once and equals the ledger", () => {
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldenOf(kind);
      const reduced = reduce(parseGolden(fixtureText(kind, "jsonl")));
      expect(reduced.usage, kind).toEqual(golden.usage);
    }
  });

  test("a finished run replays completely", () => {
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldenOf(kind);
      const events = parseGolden(fixtureText(kind, "jsonl"));
      expect(
        events.map((event) => event.seq),
        kind,
      ).toEqual(Array.from({ length: events.length }, (_, index) => index + 1));
      expect(new Set(events.map((event) => event.seq)).size, kind).toBe(events.length);
      // `events <id>` prints exactly the stored stream: same normalised bytes.
      expect(golden.printed, kind).toBe(golden.events.trimEnd());
    }
  });
});

describe("baseline parity", () => {
  test("replaying the whole stream through TerminalSink reproduces the baseline resume output", () => {
    for (const kind of ["single", "submodules"] as const) {
      const rendered = replayGolden(kind);
      const start = rendered.findIndex((line) => line.startsWith("▶ context packs"));
      expect({ kind, start: start >= 0 }).toEqual({ kind, start: true });
      // `resume` ends with two CLI report lines, the only output that never was an event.
      const resume = baselineSection(kind, "resume").slice(0, -2);
      expect(rendered.slice(start), kind).toEqual(resume);
      expect(rendered, kind).toContain(
        "  ⚙ [1.1] gates after rebase: format, lint, types, testAffected",
      );
      expect(rendered, kind).toContain("  ✓ [1.1] gates after rebase passed in <duration>");
      expect(rendered, kind).toContain(
        `implement: ${kind === "single" ? "2/2" : "3/3"} merged in <duration>`,
      );
    }
  });

  test("the baseline output is unchanged", async () => {
    const { captureScenario } = await import("./baseline-capture.ts");
    const goldens = {
      single: await captureScenario("single"),
      submodules: await captureScenario("submodules"),
    };
    for (const kind of ["single", "submodules"] as const) {
      const golden = goldens[kind];
      const baseline = (name: string): string =>
        readFileSync(join(BASELINE_DIR, `${kind}.${name}`), "utf8");
      expect(golden.stdout, `${kind} stdout`).toBe(baseline("stdout.txt"));
      expect(golden.stderr, `${kind} stderr`).toBe(baseline("stderr.txt"));
      expect(`${golden.exit}\n`, `${kind} exit`).toBe(baseline("exit.txt"));
    }
    const status: unknown = JSON.parse(readFileSync(join(BASELINE_DIR, "status.json"), "utf8"));
    const statusById: unknown = JSON.parse(
      readFileSync(join(BASELINE_DIR, "status-id.json"), "utf8"),
    );
    expect(goldens.submodules.statusFull).toEqual(status);
    expect(goldens.submodules.statusById).toEqual(statusById);
  }, 300_000);
});
