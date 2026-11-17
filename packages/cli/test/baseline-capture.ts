#!/usr/bin/env bun
/**
 * Captures the task-1.1 baseline: the two stub scenarios (`single`, `submodules`), the
 * `status --json` documents and the progress/control inventory. It writes no production code.
 *
 * Run it through the normal test preload, which supplies the stub tool binaries:
 *
 *   bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts
 *   bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts --out /tmp/baseline-2
 *   diff -r packages/cli/test/fixtures/baseline /tmp/baseline-2
 *
 * `thresholds.json` is a one-time measurement: regenerate it deliberately with
 *
 *   bun --preload ./test/setup.ts packages/cli/test/baseline-capture.ts --thresholds
 *
 * A plain capture reuses the committed thresholds document, so a later task cannot lower the
 * recorded pass count by re-running the capture.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  BACKEND_FILES,
  createSingleRepoFixture,
  createSubmoduleFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli, cliWith } from "../../../test/helpers.ts";

export type ScenarioKind = "single" | "submodules";

export interface NormaliseContext {
  /** Fixture workspace root (`<root>`). */
  readonly root: string;
  /** Fixture temp base that holds the workspace and any bare remotes. */
  readonly base: string;
  /** Repository checkout root (`<path>`). */
  readonly repoRoot: string;
}

export interface CallGolden {
  readonly label: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface ScenarioGolden {
  readonly kind: ScenarioKind;
  readonly calls: readonly CallGolden[];
  /** All stdout, each call behind a fixed banner. */
  readonly stdout: string;
  /** All stderr, each call behind the same banner. */
  readonly stderr: string;
  /** Exit code of the last call in the scenario. */
  readonly exit: number;
  readonly statusFull: unknown;
  readonly statusById: unknown;
}

export interface Thresholds {
  readonly capturedAt: string;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly check: "pass" | "fail";
  readonly files: number;
  readonly note: string;
  readonly declaredMinimums: Readonly<Record<string, number>>;
  readonly rule: string;
}

const CHANGE_ID = "add-health";
const BASELINE_DIR = join(import.meta.dir, "fixtures", "baseline");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** The exact top-level keys of `status --json` (`runs` always exists, `workspaceUsage` too). */
export const STATUS_KEYS: readonly string[] = [
  "active",
  "corrupt",
  "driverAlive",
  "queue",
  "runs",
  "workspaceUsage",
];

/** `status <id> --json` omits `workspaceUsage`. */
export const STATUS_BY_ID_KEYS: readonly string[] = [
  "active",
  "corrupt",
  "driverAlive",
  "queue",
  "runs",
];

/** One command row per cross-process action in `inventory.md`. */
export const CONTROL_ACTIONS: readonly string[] = [
  "approve",
  "abort",
  "retry",
  "resume",
  "answer",
  "pause",
];

export const ECHO_ACTIONS: readonly string[] = ["answer", "pause"];

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

const SCENARIO = {
  single: {
    summary: "Math helpers",
    repos: ["app"],
    tasks: SINGLE_TASKS,
    testFiles: { app: "src/mul.test.ts" },
  },
  submodules: {
    summary: "Add a health endpoint and show it in the UI",
    repos: ["backend", "frontend"],
    tasks: SUB_TASKS,
    testFiles: {
      backend: "internal/http/health_test.go",
    },
  },
} as const;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pathVariants(path: string): string[] {
  const variants = new Set<string>();
  try {
    variants.add(realpathSync(path));
  } catch {
    // A fixture that has already been cleaned up has no realpath; the recorded path still works.
  }
  variants.add(path);
  return [...variants].filter((value) => value !== "");
}

/**
 * Pure normaliser: two runs on the same machine differ only in timestamps, temp paths, pids,
 * scripted session ids, hashes, durations, token counts, costs and machine paths.
 */
function normaliseText(text: string, ctx: NormaliseContext): string {
  let out = text;
  for (const dir of pathVariants(ctx.root)) out = out.split(dir).join("<root>");
  for (const dir of pathVariants(ctx.base)) out = out.split(dir).join("<root>");
  for (const dir of pathVariants(ctx.repoRoot)) out = out.split(dir).join("<path>");
  for (const dir of pathVariants(homedir())) out = out.split(dir).join("<path>");

  // Any leftover fixture or template temp directory, including a realpath-resolved spelling.
  out = out.replace(
    /[A-Za-z0-9_./-]*ai-factory-(?:single|submodules|template)-[^\s"'`)]*/g,
    "<root>",
  );

  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>");
  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>");
  out = out.replace(/updated \d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?/g, "updated <time>");
  out = out.replace(/\bpid \d+\b/g, "pid <pid>");
  out = out.replace(/\bses_[A-Za-z0-9_-]+\b/g, "<session>");
  out = out.replace(/\b[0-9a-f]{64}\b/g, "<sha>");
  out = out.replace(/\b[0-9a-f]{40}\b/g, "<sha>");
  out = out.replace(/\b[0-9a-f]{12}\b/g, "<sha12>");
  out = out.replace(/\b(?:\d+h\d+m|\d+m\d+s|\d+(?:\.\d+)?ms|\d+(?:\.\d+)?s)\b/g, "<duration>");
  out = out.replace(/\b\d[\d.,]*[km]?\s+tok(?:en)?s?\b/g, "<tokens>");
  out = out.replace(/\$\d+(?:\.\d+)?/g, "$<cost>");
  // Usage objects in `status --json`: token counts and cost are display data, not state.
  out = out.replace(/"(input|output|reasoning|cacheRead|cacheWrite)": -?\d+/g, '"$1": "<tokens>"');
  out = out.replace(/"cost": -?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, '"cost": "<cost>"');
  out = out.replace(new RegExp(escapeRegExp(hostname()), "g"), "<host>");

  // A last sweep for absolute paths outside the fixture (tool binaries, caches, /dev/null).
  out = out.replace(/(?:^|(?<=[\s"'`(=]))\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]*/g, "<path>");
  return out;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(Object.getOwnPropertyDescriptor(value, key)?.value)]),
    );
  }
  return value;
}

/** A pure-JSON document is re-serialised with sorted keys, so map iteration order cannot drift. */
function canonicalJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return JSON.stringify(sortJson(parsed), null, 2);
  } catch {
    return text;
  }
}

export function normalise(text: string, ctx: NormaliseContext): string {
  return canonicalJson(normaliseText(text, ctx));
}

function normaliseJson(value: unknown, ctx: NormaliseContext): unknown {
  if (typeof value === "string") return normaliseText(value, ctx);
  if (Array.isArray(value)) return value.map((entry) => normaliseJson(entry, ctx));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normaliseJson(entry, ctx)]),
    );
  }
  return value;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${what} is not a JSON object`);
  return Object.fromEntries(Object.entries(value));
}

export function keysOf(document: unknown, what: string): string[] {
  return Object.keys(asRecord(document, what)).sort();
}

function assertKeys(document: unknown, expected: readonly string[], what: string): void {
  const actual = keysOf(document, what);
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n"))
    throw new Error(`${what} keys drifted: got ${actual.join(", ")}; want ${wanted.join(", ")}`);
}

function banner(call: CallGolden): string {
  return `===== ${call.label} (exit ${call.code}) =====`;
}

function render(calls: readonly CallGolden[], stream: "stdout" | "stderr"): string {
  return `${calls.map((call) => `${banner(call)}\n${call[stream]}`).join("\n")}\n`;
}

async function configure(fixture: Fixture, repos: readonly string[]): Promise<void> {
  const file = join(fixture.root, "factory.config.jsonc");
  const overrides = Object.fromEntries(repos.map((repo) => [repo, PASS_ALL]));
  const text = readFileSync(file, "utf8")
    .replace('"overrides": {}', `"overrides": ${JSON.stringify(overrides)}`)
    // One agent and one gate process at a time make the captured ordering deterministic.
    .replace('"maxAgents": 4', '"maxAgents": 1')
    .replace('"maxGateProcesses": 2', '"maxGateProcesses": 1');
  writeFileSync(file, text);
  await fixtureGit(fixture.root, "commit", "-q", "-am", "chore: configure the factory");
}

/** Runs the two stub scenarios exactly as the pipeline tests shape them, and normalises. */
export async function captureScenario(kind: ScenarioKind): Promise<ScenarioGolden> {
  const fixture =
    kind === "single" ? await createSingleRepoFixture() : await createSubmoduleFixture();
  const ctx: NormaliseContext = {
    root: fixture.root,
    base: fixture.base,
    repoRoot: REPO_ROOT,
  };
  const script = SCENARIO[kind];
  const runtime = new ScriptedRuntime(
    factoryScript({
      changeId: CHANGE_ID,
      summary: script.summary,
      repos: [...script.repos],
      tasks: script.tasks,
      testFiles: script.testFiles,
    }),
  );
  const calls: CallGolden[] = [];
  const record = async (
    label: string,
    run: () => Promise<{ code: number; out: string; err: string }>,
  ) => {
    const result = await run();
    calls.push({
      label,
      stdout: normalise(result.out, ctx),
      stderr: normalise(result.err, ctx),
      code: result.code,
    });
  };

  try {
    await record("init", () => cli(fixture.root, "init"));
    await configure(fixture, script.repos);
    await record("run", () => cliWith(runtime, fixture.root, "run", "Add a health endpoint"));
    await record("approve --no-continue", () =>
      cliWith(runtime, fixture.root, "approve", CHANGE_ID, "--no-continue"),
    );
    await record("resume", () => cliWith(runtime, fixture.root, "resume", CHANGE_ID));
    await record("status <id> --json", () => cli(fixture.root, "status", CHANGE_ID, "--json"));
    await record("status --json", () => cli(fixture.root, "status", "--json"));
  } finally {
    fixture.cleanup();
  }

  const byLabel = (label: string): CallGolden => {
    const call = calls.find((entry) => entry.label === label);
    if (call === undefined) throw new Error(`scenario ${kind} did not record ${label}`);
    return call;
  };
  const statusById = normaliseJson(JSON.parse(byLabel("status <id> --json").stdout), ctx);
  const statusFull = normaliseJson(JSON.parse(byLabel("status --json").stdout), ctx);
  assertKeys(statusFull, STATUS_KEYS, "status --json");
  assertKeys(statusById, STATUS_BY_ID_KEYS, "status <id> --json");

  return {
    kind,
    calls,
    stdout: render(calls, "stdout"),
    stderr: render(calls, "stderr"),
    exit: calls.at(-1)?.code ?? 1,
    statusFull,
    statusById,
  };
}

export function verifyInventory(text: string): void {
  const rows = text
    .split("\n")
    .map((line) => /^\| `([a-z]+)`\s+\|/u.exec(line)?.[1])
    .filter((action): action is string => action !== undefined);
  for (const action of CONTROL_ACTIONS) {
    const matches = rows.filter((row) => row === action);
    if (matches.length !== 1)
      throw new Error(`inventory.md must list ${action} exactly once; found ${matches.length}`);
  }
  for (const action of ECHO_ACTIONS) {
    const line = text.split("\n").find((entry) => entry.startsWith(`| \`${action}\``));
    if (line === undefined || !line.includes("none"))
      throw new Error(`inventory.md must map ${action} to none`);
  }
  for (const method of [
    "line",
    "note",
    "agentStarted",
    "agentFinished",
    "activity",
    "gate",
    "gatesDone",
    "install",
    "task",
    "implementSummary",
    "tick",
    "#startHeartbeat",
    "stop",
  ]) {
    if (!text.includes(method)) throw new Error(`inventory.md does not mention Progress.${method}`);
  }
}

export function verifyThresholds(value: unknown): Thresholds {
  const record = asRecord(value, "thresholds.json");
  const { capturedAt, testsPassed, testsFailed, check, files, note, declaredMinimums, rule } =
    record;
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt)))
    throw new Error("thresholds.json: capturedAt is not a date");
  if (typeof testsPassed !== "number" || !Number.isInteger(testsPassed) || testsPassed <= 0)
    throw new Error("thresholds.json: testsPassed must be a positive integer");
  if (testsFailed !== 0) throw new Error("thresholds.json: testsFailed must be 0");
  if (check !== "pass") throw new Error("thresholds.json: check must be pass");
  if (typeof files !== "number" || !Number.isInteger(files) || files <= 0)
    throw new Error("thresholds.json: files must be a positive integer");
  if (typeof note !== "string") throw new Error("thresholds.json: note must be a string");
  if (typeof rule !== "string") throw new Error("thresholds.json: rule must be a string");
  const minimums = asRecord(declaredMinimums, "thresholds.json declaredMinimums");
  const declared: Record<string, number> = {};
  for (const [file, minimum] of Object.entries(minimums)) {
    if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum <= 0)
      throw new Error(`thresholds.json: declared minimum for ${file} is not a positive integer`);
    declared[file] = minimum;
  }
  return {
    capturedAt,
    testsPassed,
    testsFailed,
    check,
    files,
    note,
    declaredMinimums: declared,
    rule,
  };
}

/** Reads the committed per-file minimum table from `test/architecture.test.ts`. */
export function declaredMinimums(): Record<string, number> {
  const source = readFileSync(join(REPO_ROOT, "test", "architecture.test.ts"), "utf8");
  const block = /BASELINE_TEST_CASES[^{]*\{([\s\S]*?)\n\};/u.exec(source)?.[1] ?? "";
  const minimums: Record<string, number> = {};
  for (const match of block.matchAll(/"([^"]+\.test\.ts)":\s*(\d+)/gu)) {
    const file = match[1];
    const minimum = Number(match[2]);
    if (file !== undefined && Number.isInteger(minimum)) minimums[file] = minimum;
  }
  if (Object.keys(minimums).length === 0)
    throw new Error("could not read BASELINE_TEST_CASES from test/architecture.test.ts");
  return minimums;
}

function runScript(command: readonly string[]): { code: number; out: string } {
  const result = spawnSync(command[0] ?? "bun", command.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** One-time measurement: the full test pass count and the `bun run check` verdict. */
export function measureThresholds(): Thresholds {
  const tests = runScript(["bun", "run", "test"]);
  const passed = Number(/^\s*(\d+)\s+pass\s*$/mu.exec(tests.out)?.[1] ?? "0");
  const failed = Number(/^\s*(\d+)\s+fail\s*$/mu.exec(tests.out)?.[1] ?? "0");
  const files = Number(/Ran \d+ tests across (\d+) files/u.exec(tests.out)?.[1] ?? "0");
  if (tests.code !== 0 || passed <= 0 || failed !== 0)
    throw new Error(`bun run test was not green:\n${tests.out.slice(-4000)}`);
  const check = runScript(["bun", "run", "check"]);
  if (check.code !== 0) throw new Error(`bun run check was not green:\n${check.out.slice(-4000)}`);
  return {
    capturedAt: new Date().toISOString(),
    testsPassed: passed,
    testsFailed: failed,
    check: "pass",
    files,
    note: "Captured before the first source edit of add-typed-event-stream. Later tasks may add tests and files but must not lower testsPassed, the declared minimums, or leave bun run check red.",
    declaredMinimums: declaredMinimums(),
    rule: "No later task may lower testsPassed, the declared per-file test minimums, or leave `bun run check` red.",
  };
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** The repo's formatter owns JSON/Markdown layout; the gate would otherwise reject raw JSON. */
function formatDir(dir: string): void {
  const biome = join(REPO_ROOT, "node_modules", ".bin", "biome");
  for (const name of readdirSync(dir).filter((entry) => /\.(?:json|md)$/u.test(entry))) {
    const file = join(dir, name);
    // A synthetic in-repo path gives the temp output the same formatter config as the commit.
    const stdinPath = join(REPO_ROOT, "packages", "cli", "test", "fixtures", "baseline", name);
    const result = spawnSync(
      biome,
      ["format", `--stdin-file-path=${stdinPath}`, `--config-path=${REPO_ROOT}`],
      { input: readFileSync(file), encoding: "buffer", env: process.env },
    );
    if (result.status !== 0)
      throw new Error(`biome format ${name} failed:\n${result.stderr?.toString() ?? ""}`);
    writeFileSync(file, result.stdout ?? Buffer.alloc(0));
  }
}

function readCommitted<T>(file: string, verify: (value: unknown) => T): T {
  const path = join(BASELINE_DIR, file);
  if (!existsSync(path))
    throw new Error(`missing ${path}; capture the baseline first (see the script header)`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return verify(parsed);
}

/** Captures every baseline artefact into `outDir`. `--thresholds` re-measures the thresholds. */
export async function captureAll(
  outDir: string,
  options: { readonly thresholds?: Thresholds } = {},
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const thresholds = options.thresholds ?? readCommitted("thresholds.json", verifyThresholds);
  const inventory = readFileSync(join(BASELINE_DIR, "inventory.md"), "utf8");
  verifyInventory(inventory);

  const goldens = [await captureScenario("single"), await captureScenario("submodules")];
  for (const golden of goldens) {
    writeFileSync(join(outDir, `${golden.kind}.stdout.txt`), golden.stdout);
    writeFileSync(join(outDir, `${golden.kind}.stderr.txt`), golden.stderr);
    writeFileSync(join(outDir, `${golden.kind}.exit.txt`), `${golden.exit}\n`);
  }
  const submodules = goldens.find((golden) => golden.kind === "submodules");
  if (submodules === undefined) throw new Error("the submodules scenario did not run");
  writeJson(join(outDir, "status.json"), submodules.statusFull);
  writeJson(join(outDir, "status-id.json"), submodules.statusById);
  writeFileSync(join(outDir, "inventory.md"), inventory);
  writeJson(join(outDir, "thresholds.json"), thresholds);
  formatDir(outDir);
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a directory`);
  return value;
}

async function main(argv: readonly string[]): Promise<void> {
  const out = argValue(argv, "--out") ?? BASELINE_DIR;
  const thresholds = argv.includes("--thresholds") ? measureThresholds() : undefined;
  await captureAll(out, thresholds === undefined ? {} : { thresholds });
  console.log(`baseline captured in ${out}`);
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
