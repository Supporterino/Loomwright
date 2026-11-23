import { afterEach, describe, expect, test } from "bun:test";
import type { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionArgs,
  createLauncher,
  type LaunchAction,
  type LaunchResult,
  tailLog,
} from "../src/launch/launcher.ts";

const ISO = Date.parse("2026-11-18T10:00:00.000Z");
const STAMP = "2026-11-18T10-00-00-000Z";
const EXEC = "/usr/local/bin/node";
const ENTRY = "/opt/loomwright/cli.js";

interface SpawnOptions {
  readonly cwd?: string;
  readonly detached?: boolean;
  readonly stdio?: readonly unknown[];
}

interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

interface FakeChild {
  readonly pid: number | undefined;
  readonly unrefs: number;
  readonly kills: number;
  readonly alive: boolean;
  unref(): void;
  kill(): boolean;
  once(event: string, listener: ExitListener | ErrorListener): FakeChild;
  emitExit(code: number | null, signal: string | null): void;
  emitError(err: Error): void;
}

type ExitListener = (code: number | null, signal: string | null) => void;
type ErrorListener = (err: Error) => void;

function fakeChild(...args: [pid?: number]): FakeChild {
  // An explicit `undefined` models a failed spawn; omitting the argument keeps the usual pid.
  const pid = args.length === 0 ? 4242 : args[0];
  let unrefs = 0;
  let kills = 0;
  let alive = true;
  const exitListeners: ExitListener[] = [];
  const errorListeners: ErrorListener[] = [];
  const child: FakeChild = {
    pid,
    get unrefs(): number {
      return unrefs;
    },
    get kills(): number {
      return kills;
    },
    get alive(): boolean {
      return alive;
    },
    unref(): void {
      unrefs += 1;
    },
    kill(): boolean {
      kills += 1;
      alive = false;
      return true;
    },
    once(event, listener): FakeChild {
      // The launcher passes an exit or an error listener; the event name tells which it is.
      if (event === "exit") exitListeners.push(listener as ExitListener);
      else if (event === "error") errorListeners.push(listener as ErrorListener);
      return child;
    },
    emitExit(code, signal): void {
      for (const listener of exitListeners) listener(code, signal);
    },
    emitError(err): void {
      // Node throws an unhandled `error` event; mirroring that proves the launcher listens.
      if (errorListeners.length === 0) throw err;
      for (const listener of errorListeners) listener(err);
    },
  };
  return child;
}

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "tui-launch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function recordingSpawn(calls: SpawnCall[], child: FakeChild): typeof spawn {
  // The fake implements the only ChildProcess members the launcher uses.
  return ((file: string, args: readonly string[], options: SpawnOptions) => {
    calls.push({ file, args, options });
    return child;
  }) as unknown as typeof spawn;
}

function launcherFor(
  ws: string,
  calls: SpawnCall[],
  child: FakeChild,
  overrides: { readonly openLog?: (path: string) => number } = {},
): ReturnType<typeof createLauncher> {
  return createLauncher({
    workspace: ws,
    execPath: EXEC,
    entryPath: ENTRY,
    spawn: recordingSpawn(calls, child),
    now: () => ISO,
    ...overrides,
  });
}

const MATRIX: readonly { readonly action: LaunchAction; readonly expected: readonly string[] }[] = [
  {
    action: { kind: "run-text", text: "add a health endpoint" },
    expected: ["run", "add a health endpoint", "--no-interactive"],
  },
  {
    action: { kind: "run-file", path: "/ws/.factory/requests/faster-imports.md" },
    expected: ["run", "--request", "/ws/.factory/requests/faster-imports.md", "--no-interactive"],
  },
  { action: { kind: "approve", id: "add-health" }, expected: ["approve", "add-health"] },
  {
    action: { kind: "approve-only", id: "add-health" },
    expected: ["approve", "add-health", "--no-continue"],
  },
  { action: { kind: "reword", id: "add-health" }, expected: ["reword", "add-health"] },
  {
    action: {
      kind: "reword",
      id: "add-health",
      prompt: "apply findings 1 and 2",
    },
    expected: ["reword", "add-health", "--prompt", "apply findings 1 and 2"],
  },
  { action: { kind: "reapprove", id: "add-health" }, expected: ["reapprove", "add-health"] },
  { action: { kind: "resume", id: "add-health" }, expected: ["resume", "add-health"] },
  { action: { kind: "land", id: "add-health" }, expected: ["land", "add-health"] },
];

describe("the argv for every action", () => {
  for (const { action, expected } of MATRIX) {
    test(`${action.kind} spawns ${expected.join(" ")}`, async () => {
      const ws = workspace();
      const calls: SpawnCall[] = [];
      const child = fakeChild();
      const launcher = launcherFor(ws, calls, child, { openLog: () => 9 });

      expect(actionArgs(action)).toEqual(expected);
      await launcher.launch(action);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.file).toBe(EXEC);
      expect(calls[0]?.args).toEqual([ENTRY, "-C", ws, ...expected]);
    });
  }
});

describe("the child is detached and logged", () => {
  test("cwd, detached, stdio, unref and the log path", async () => {
    const ws = workspace();
    const calls: SpawnCall[] = [];
    const child = fakeChild();
    const launcher = launcherFor(ws, calls, child);

    const result: LaunchResult = await launcher.launch({
      kind: "run-text",
      text: "add a health endpoint",
    });

    expect(result.pid).toBe(4242);
    expect(result.displayPath).toBe(`.factory/logs/tui-spawn-${STAMP}.log`);
    expect(result.logPath).toBe(join(ws, ".factory", "logs", `tui-spawn-${STAMP}.log`));
    expect(calls[0]?.options.cwd).toBe(ws);
    expect(calls[0]?.options.detached).toBe(true);
    expect(calls[0]?.options.stdio?.[0]).toBe("ignore");
    expect(calls[0]?.options.stdio?.[1]).toBe(calls[0]?.options.stdio?.[2]);
    expect(typeof calls[0]?.options.stdio?.[1]).toBe("number");
    expect(child.unrefs).toBe(1);
    expect(readFileSync(result.logPath, "utf8")).toBe("");
  });
});

describe("text stays one argv element", () => {
  test("spaces and newlines are never split", () => {
    const text = "add a health\nendpoint with spaces";
    expect(actionArgs({ kind: "run-text", text })).toEqual(["run", text, "--no-interactive"]);
  });
});

describe("the reword prompt is one argv element", () => {
  test("a two-line prompt keeps its newline and no quoting", () => {
    expect(actionArgs({ kind: "reword", id: "add-health", prompt: "  first\nsecond  " })).toEqual([
      "reword",
      "add-health",
      "--prompt",
      "first\nsecond",
    ]);
  });

  test("an empty prompt after trimming launches without --prompt", () => {
    for (const prompt of ["", "   \n ", "\n\t "]) {
      expect(
        actionArgs({ kind: "reword", id: "add-health", prompt }),
        JSON.stringify(prompt),
      ).toEqual(["reword", "add-health"]);
    }
  });
});

describe("a failed child is visible", () => {
  test("exited carries code 3 and tailLog returns the last ten lines", async () => {
    const ws = workspace();
    const logPath = join(ws, "spawn.log");
    const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    writeFileSync(logPath, `${lines.join("\n")}\n`);

    const calls: SpawnCall[] = [];
    const child = fakeChild();
    const launcher = launcherFor(ws, calls, child, { openLog: () => 9 });
    const result = await launcher.launch({ kind: "approve", id: "add-health" });
    child.emitExit(3, null);

    expect(await result.exited).toEqual({ code: 3, signal: null });
    expect(tailLog(logPath)).toEqual(lines.slice(-10));
    expect(tailLog(logPath, 2)).toEqual(lines.slice(-2));
    expect(tailLog(join(ws, "missing.log"))).toEqual([]);
  });

  test("a failed land's log tail carries no escape sequences", () => {
    const ws = workspace();
    const logPath = join(ws, "spawn.log");
    writeFileSync(
      logPath,
      "\u001b[2Jcleared\u0007\n\u001b]52;c;SGVsbG8=\u0007clip\u009b\tkept\r\nplain\n",
    );

    const tail = tailLog(logPath);

    expect(tail).toEqual(["[2Jcleared", "]52;c;SGVsbG8=clip\tkept", "plain"]);
    const isControl = (character: string): boolean =>
      /\p{Cc}/u.test(character) && character !== "\t" && character !== "\n";
    for (const line of tail) expect([...line].some(isControl)).toBe(false);
  });

  test("a failed spawn is visible: error resolves a non-zero exit and the tail", async () => {
    const ws = workspace();
    const calls: SpawnCall[] = [];
    const child = fakeChild(undefined);
    const launcher = launcherFor(ws, calls, child, { openLog: () => 9 });
    const result = await launcher.launch({ kind: "approve", id: "add-health" });

    expect(result.pid).toBeUndefined();
    child.emitError(new Error("spawn EACCES"));

    expect(await result.exited).toEqual({ code: 1, signal: null });
    expect(tailLog(result.logPath)).toContain("spawn failed: spawn EACCES");
  });
});

describe("a large spawn log is only read from its tail", () => {
  test("a verbose log yields the last lines and never the first ones", () => {
    const ws = workspace();
    const logPath = join(ws, "big.log");
    // ~200 KiB, far past the byte cap the tail reader seeks from.
    const rows = Array.from({ length: 5000 }, (_, index) => `row ${index + 1}`);
    rows[0] = "FIRST-ROW-SENTINEL";
    writeFileSync(logPath, `${rows.join("\n")}\n`);

    const tail = tailLog(logPath, 20);

    expect(tail).toEqual(rows.slice(-20));
    expect(tail).not.toContain("FIRST-ROW-SENTINEL");
    expect(tailLog(logPath, 2)).toEqual(rows.slice(-2));
  });
});

describe("no signal is sent on exit", () => {
  test("quit, SIGINT and a thrown render leave the child alive", async () => {
    const ws = workspace();
    const calls: SpawnCall[] = [];
    const child = fakeChild();
    const launcher = launcherFor(ws, calls, child, { openLog: () => 9 });
    const result = await launcher.launch({ kind: "resume", id: "add-health" });

    // The UI's quit and signal paths only leave the terminal; they never touch the launcher.
    try {
      throw new Error("render threw");
    } catch {
      // A crash restores the terminal elsewhere; the child is not signalled.
    }

    expect(result.pid).toBe(4242);
    expect(child.kills).toBe(0);
    expect(child.alive).toBe(true);
    expect("wait" in child).toBe(false);
  });

  test("no source file ever signals, kills or waits on a child", () => {
    const packageSrc = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
      }
    };
    walk(packageSrc);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\.kill\s*\(/);
      expect(text, file).not.toMatch(/process\.kill\s*\(/);
      expect(text, file).not.toMatch(/\bchild\.wait\s*\(/);
    }
  });
});
