import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import type { ActiveLock } from "@loomwright/core/state/active";
import { RunState } from "@loomwright/core/state/run";
import { runTui } from "../src/entry.tsx";
import {
  type IntakeContext,
  type IntakeState,
  initialIntake,
  intakeKeys,
  intakePanel,
  QUEUED_NOTE,
} from "../src/intake/dialog.tsx";
import { watchSpawn } from "../src/intake/follow.ts";
import { checkRequestFile, completePath } from "../src/intake/paths.ts";
import type { LaunchAction } from "../src/launch/launcher.ts";
import type { KeyInput } from "../src/model/keys.ts";
import type { TerminalSession } from "../src/session.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";

const ISO = "2026-11-18T10:00:00.000Z";

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

function status(active: ActiveLock | null = null): StatusDocument {
  return { active, driverAlive: active !== null, queue: [], corrupt: [], runs: [] };
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

function statusWithRun(id: string): StatusDocument {
  const run = RunState.parse({
    version: 1,
    id,
    factoryVersion: "0.0.0",
    request: "add a health endpoint",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "design",
    summary: "add a health endpoint",
  });
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [
      {
        ...run,
        usage: {
          total: ZERO_USAGE,
          sessions: 0,
          byAgent: {},
          byStep: {},
          byModel: {},
          retryOverhead: ZERO_USAGE,
          top: [],
          wastedReads: 0,
        },
      },
    ],
  };
}

function context(cwd: string, overrides: Partial<IntakeContext> = {}): IntakeContext {
  return {
    cwd,
    workspace: cwd,
    status: status(),
    ...overrides,
  };
}

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "tui-intake-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function typeText(text: string, ctx: IntakeContext): IntakeState {
  return intakeKeys(initialIntake, text, key(), ctx).state;
}

function fileMode(path: string, ctx: IntakeContext): IntakeState {
  const mode = intakeKeys(initialIntake, "", key({ tab: true }), ctx).state;
  return intakeKeys({ ...mode, path: "" }, path, key(), ctx).state;
}

function panelText(state: IntakeState): string {
  const panel = intakePanel(state, ASCII_GLYPHS);
  return [panel.title, ...panel.lines, panel.notice ?? ""].join("\n");
}

class FakeInput extends EventEmitter {
  readonly isTTY = true;
  isRaw = false;
  readonly #chunks: string[] = [];

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
  }

  setEncoding(): void {}

  ref(): void {}

  unref(): void {}

  resume(): void {}

  pause(): void {}

  read(): string | null {
    return this.#chunks.shift() ?? null;
  }

  press(text: string): void {
    this.#chunks.push(text);
    this.emit("readable");
  }
}

class FakeOutput {
  readonly columns = 80;
  readonly rows = 24;
  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  on(): void {}

  off(): void {}

  text(): string {
    return this.writes.join("");
  }
}

function fakeSession(): TerminalSession {
  return {
    enter: () => {},
    leave: () => {},
    get columns(): number {
      return 80;
    },
    get rows(): number {
      return 24;
    },
    onKey: () => () => {},
    onResize: () => () => {},
    onSignal: () => () => {},
  };
}

/** The run list only reads; every write method fails so a stray control call is visible. */
function readOnlyFactory(): Factory {
  const fail = (): never => {
    throw new Error("the run list must not write");
  };
  return {
    status: async () => status(),
    listRuns: async () => [],
    events: async function* () {},
    run: async () => fail(),
    resume: async () => fail(),
    approve: async () => fail(),
    retry: async () => fail(),
    abort: async () => fail(),
    answer: async () => fail(),
    pause: async () => fail(),
  };
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("text intake", () => {
  test("typed text submits one run-text action and the panel shows the spawn log", () => {
    const ws = workspace();
    const ctx = context(ws);
    const typed = typeText("add a health endpoint", ctx);
    const outcome = intakeKeys(typed, "", key({ return: true }), ctx);

    expect(outcome.submit).toEqual({ kind: "run-text", text: "add a health endpoint" });
    expect(outcome.state.submitting).toBe(true);

    const spawned: IntakeState = {
      ...outcome.state,
      spawned: {
        logPath: join(ws, ".factory", "logs", "tui-spawn-x.log"),
        displayPath: ".factory/logs/tui-spawn-x.log",
        tail: ["run started"],
      },
    };
    expect(panelText(spawned)).toContain(".factory/logs/tui-spawn-x.log");
  });

  test("a pasted multi-line chunk is kept verbatim and Ctrl-J adds a newline", () => {
    const ws = workspace();
    const ctx = context(ws);
    const typed = intakeKeys(initialIntake, "first\nsecond", key(), ctx).state;
    const newline = intakeKeys(typed, "j", key({ ctrl: true }), ctx).state;
    expect(newline.text).toBe("first\nsecond\n");
  });
});

describe("a blank request is rejected", () => {
  test("whitespace only stays open with an inline message and no submit", () => {
    const ws = workspace();
    const ctx = context(ws);
    const typed = typeText("   \n\t ", ctx);
    const outcome = intakeKeys(typed, "", key({ return: true }), ctx);

    expect(outcome.submit).toBeUndefined();
    expect(outcome.state.error).toBe("the request is empty");
    expect(outcome.state.submitting).toBe(false);
    expect(panelText(outcome.state)).toContain("the request is empty");
  });
});

describe("file intake validates", () => {
  test("preview is twenty lines, and the panel shows absolute path and bytes", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".factory", "requests"), { recursive: true });
    const content = `${Array.from({ length: 25 }, (_, index) => `request line ${index + 1}`).join("\n")}\n`;
    writeFileSync(join(ws, ".factory", "requests", "faster-imports.md"), content);

    const check = checkRequestFile(".factory/requests/faster-imports.md", ws);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.file.absolute).toBe(join(ws, ".factory", "requests", "faster-imports.md"));
    expect(check.file.bytes).toBe(Buffer.byteLength(content));
    expect(check.file.preview).toHaveLength(20);
    expect(check.file.preview[0]).toBe("request line 1");

    const ctx = context(ws);
    const state = fileMode(".factory/requests/faster-imports.md", ctx);
    expect(state.file).not.toBeNull();
    const text = panelText(state);
    expect(text).toContain(check.file.absolute);
    expect(text).toContain(`${check.file.bytes} bytes`);
    expect(text).toContain("preview (20 lines)");
    expect(text).toContain("request line 1");
    // The chosen file replaces the completion list and every preview line is rendered.
    const lines = intakePanel(state, ASCII_GLYPHS).lines;
    expect(lines).toContain("  | request line 20");
    expect(lines.some((line) => line.startsWith("  - "))).toBe(false);

    const outcome = intakeKeys(state, "", key({ return: true }), ctx);
    expect(outcome.submit).toEqual({
      kind: "run-file",
      path: join(ws, ".factory", "requests", "faster-imports.md"),
    });
  });

  test("file intake validates a huge file from a bounded head", () => {
    const ws = workspace();
    const path = join(ws, "huge.md");
    // One line far longer than the head proves the preview is not decoded from the whole file.
    const content = `first line\n${"x".repeat(2 * 1024 * 1024)}`;
    writeFileSync(path, content);

    const check = checkRequestFile(path, ws);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.file.bytes).toBe(Buffer.byteLength(content));
    expect(check.file.preview[0]).toBe("first line");
    const previewBytes = Buffer.byteLength(check.file.preview.join("\n"));
    expect(previewBytes).toBeLessThanOrEqual(64 * 1024);
    expect(previewBytes).toBeLessThan(content.length);
  });

  test("a short terminal trims the preview and names the shown count", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".factory", "requests"), { recursive: true });
    const content = `${Array.from({ length: 25 }, (_, index) => `request line ${index + 1}`).join("\n")}\n`;
    writeFileSync(join(ws, ".factory", "requests", "faster-imports.md"), content);

    const state = fileMode(".factory/requests/faster-imports.md", context(ws));
    const lines = intakePanel(state, ASCII_GLYPHS, 24).lines;
    expect(lines).toContain("preview (16 of 20 lines):");
    expect(lines).toContain("  | request line 16");
    expect(lines).not.toContain("  | request line 17");
  });

  test("reads under .factory are limited to .factory/requests/*.md", () => {
    const ws = workspace();
    const requests = join(ws, ".factory", "requests");
    mkdirSync(requests, { recursive: true });
    mkdirSync(join(ws, ".factory", "events"), { recursive: true });
    mkdirSync(join(ws, ".factory", "runs"), { recursive: true });
    writeFileSync(join(requests, "faster-imports.md"), "# faster imports\n");
    writeFileSync(join(requests, "notes.txt"), "notes\n");
    writeFileSync(
      join(ws, ".factory", "events", "run-1.jsonl"),
      '{"seq":1,"type":"run.started"}\n',
    );
    writeFileSync(join(ws, ".factory", "runs", "run-1.json"), "{}\n");
    writeFileSync(join(ws, ".factory", "active.json"), "{}\n");

    // The lock, the run state, the event log and anything else there is neither listed nor read.
    const blocked = [
      ".factory",
      ".factory/",
      ".factory/events/",
      ".factory/events/run-1.jsonl",
      ".factory/runs/run-1.json",
      ".factory/active.json",
      ".factory/requests/../events/run-1.jsonl",
    ];
    for (const path of blocked) {
      expect(completePath(path, ws)).toEqual([]);
      const check = checkRequestFile(path, ws);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toContain("not a .factory/requests/*.md file");
    }

    // A non-md file under requests may be listed, but it is never previewed.
    expect(completePath(".factory/requests/notes.txt", ws).map((item) => item.path)).toEqual([
      ".factory/requests/notes.txt",
    ]);
    const notes = checkRequestFile(".factory/requests/notes.txt", ws);
    expect(notes.ok).toBe(false);
    if (!notes.ok) expect(notes.reason).toContain("not a .factory/requests/*.md file");

    const allowed = checkRequestFile(".factory/requests/faster-imports.md", ws);
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.file.preview).toEqual(["# faster imports", ""]);

    // Typing the event log in the dialog previews nothing and Enter refuses to launch it.
    const ctx = context(ws);
    const state = fileMode(".factory/events/run-1.jsonl", ctx);
    expect(state.file).toBeNull();
    expect(state.candidates).toEqual([]);
    const outcome = intakeKeys(state, "", key({ return: true }), ctx);
    expect(outcome.submit).toBeUndefined();
    expect(outcome.state.error).toContain("not a .factory/requests/*.md file");
  });

  test("nonexistent, directory, unreadable and empty files are rejected in place", () => {
    const ws = workspace();
    const ctx = context(ws);
    const cases: { path: string; reason: string }[] = [
      { path: join(ws, "missing.md"), reason: "does not exist" },
      { path: ws, reason: "is a directory" },
    ];

    const empty = join(ws, "empty.md");
    writeFileSync(empty, "   \n\t\n");
    cases.push({ path: empty, reason: "is empty" });

    const unreadable = join(ws, "unreadable.md");
    writeFileSync(unreadable, "a request\n");
    chmodSync(unreadable, 0o000);
    cases.push({ path: unreadable, reason: "is not readable" });

    try {
      for (const item of cases) {
        const state = fileMode(item.path, ctx);
        const outcome = intakeKeys(state, "", key({ return: true }), ctx);
        expect(outcome.submit).toBeUndefined();
        expect(outcome.state.error).toContain(item.reason);
      }
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  test(".factory/requests/*.md rank first, and ~, . and .. complete", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".factory", "requests"), { recursive: true });
    writeFileSync(join(ws, ".factory", "requests", "zeta.md"), "# zeta\n");
    writeFileSync(join(ws, ".factory", "requests", "alpha.md"), "# alpha\n");
    writeFileSync(join(ws, ".factory", "requests", "notes.txt"), "notes\n");
    writeFileSync(join(ws, "readme.txt"), "readme\n");

    const ranked = completePath(".factory/requests/", ws);
    expect(ranked.slice(0, 2).map((candidate) => candidate.path)).toEqual([
      ".factory/requests/alpha.md",
      ".factory/requests/zeta.md",
    ]);
    expect(ranked.at(-1)?.path).toBe(".factory/requests/notes.txt");

    const dot = completePath(".", ws);
    expect(dot.some((candidate) => candidate.absolute === join(ws, "readme.txt"))).toBe(true);

    const parent = completePath("..", ws);
    expect(parent.every((candidate) => candidate.path.startsWith("../"))).toBe(true);

    const home = completePath("~", ws);
    expect(home.every((candidate) => candidate.path.startsWith("~/"))).toBe(true);
  });
});

describe("no double submit", () => {
  test("a second Enter while submitting is ignored", () => {
    const ws = workspace();
    const ctx = context(ws);
    const first = intakeKeys(
      typeText("add a health endpoint", ctx),
      "",
      key({ return: true }),
      ctx,
    );
    const second = intakeKeys(first.state, "", key({ return: true }), ctx);
    expect(first.submit).toBeDefined();
    expect(second.submit).toBeUndefined();
    expect(second.state.submitting).toBe(true);
  });
});

describe("an active change is called out", () => {
  test("the note names the draft and the queue and never says it starts", () => {
    const ws = workspace();
    const active: ActiveLock = {
      changeId: "another-change",
      pid: 99,
      host: "host",
      since: ISO,
    };
    const ctx = context(ws, { status: status(active) });
    const outcome = intakeKeys(
      typeText("add a health endpoint", ctx),
      "",
      key({ return: true }),
      ctx,
    );

    expect(outcome.submit).toBeDefined();
    expect(outcome.state.queuedNote).toBe(QUEUED_NOTE);
    expect(outcome.state.queuedNote).toContain(".factory/drafts/<id>");
    expect(outcome.state.queuedNote).toContain("queued after approval");
    expect(outcome.state.queuedNote).not.toContain("starts");
    expect(panelText(outcome.state)).toContain("queued after approval");
  });
});

describe("the workspace is not installed", () => {
  test("the rejection shows the message and init hint inline, and the UI keeps running", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const realStdout = Object.getOwnPropertyDescriptor(process, "stdout");
    const launches: LaunchAction[] = [];
    let opens = 0;
    let settled = false;
    try {
      Object.defineProperty(process, "stdin", { value: input, configurable: true });
      Object.defineProperty(process, "stdout", { value: output, configurable: true });
      const code = runTui({
        workspace: "/workspace",
        once: false,
        ascii: true,
        columns: 80,
        rows: 24,
        out: () => {},
        env: {},
        isTTY: false,
        // Ink only writes the last frame when CI is set; this test reads the live screen.
        frames: true,
        factory: readOnlyFactory(),
        // The first open rejects exactly as Factory.open does before `loomwright init`.
        open: async () => {
          opens += 1;
          if (opens === 1) throw new Error("loomwright is not installed here");
          return readOnlyFactory();
        },
        launcher: {
          launch: async (action) => {
            launches.push(action);
            return {
              pid: undefined,
              logPath: "/workspace/.factory/logs/tui-spawn-test.log",
              displayPath: ".factory/logs/tui-spawn-test.log",
              exited: Promise.resolve({ code: 0, signal: null }),
            };
          },
        },
        session: fakeSession(),
      }).then((value) => {
        settled = true;
        return value;
      });
      // A failed drive must not also surface as an unhandled rejection from the TUI.
      void code.catch(() => {});

      await waitFor(() => input.isRaw, "raw mode");
      await waitFor(() => output.text().includes("n new change"), "the run list");
      input.press("n");
      await waitFor(() => output.text().includes("New change"), "the intake dialog");
      input.press("add a health endpoint");
      await waitFor(
        () => output.text().includes("request: add a health endpoint"),
        "the typed request",
      );
      input.press("\r");

      await waitFor(
        () => output.text().includes("loomwright is not installed here — run `loomwright init`"),
        "the inline rejection",
      );
      expect(launches).toHaveLength(0);
      expect(settled).toBe(false);

      // Once init has run the same Enter reaches the launcher instead of repeating the stale message.
      input.press("\r");
      await waitFor(() => launches.length === 1, "the retry launch");
      expect(launches[0]).toEqual({ kind: "run-text", text: "add a health endpoint" });

      input.press("\u0003");
      await waitFor(() => settled, "the quit");
      expect(await code).toBe(0);
    } finally {
      if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
      if (realStdout !== undefined) Object.defineProperty(process, "stdout", realStdout);
    }
  }, 30_000);
});

describe("the spawn watch opens the run view", () => {
  test("shows the spawn log tail until run.started appears, then reports the new run", () => {
    const logPath = join("/ws", ".factory", "logs", "tui-spawn-x.log");
    let reads = 0;
    const readTail = (path: string): readonly string[] => {
      reads += 1;
      expect(path).toBe(logPath);
      return ["run submitted", "waiting for the driver"];
    };

    const before = watchSpawn(new Set<string>(), status(), logPath, readTail);
    expect(before.started).toBeNull();
    expect(before.tail).toEqual(["run submitted", "waiting for the driver"]);
    expect(reads).toBe(1);

    const after = watchSpawn(new Set<string>(), statusWithRun("add-health-2"), logPath, readTail);
    expect(after.started).toBe("add-health-2");
    expect(after.tail).toEqual([]);
    // Once the run exists the dialog is about to close, so the log is no longer read.
    expect(reads).toBe(1);
  });

  test("a run that was already listed is not mistaken for the spawn", () => {
    const existing = statusWithRun("add-health");
    const watch = watchSpawn(new Set(["add-health"]), existing, "/spawn.log", () => ["tail"]);
    expect(watch.started).toBeNull();
    expect(watch.tail).toEqual(["tail"]);
  });
});

describe("the mode is named in the title", () => {
  test("Tab toggles text and file, and the title follows", () => {
    const ws = workspace();
    const ctx = context(ws);
    expect(intakePanel(initialIntake, ASCII_GLYPHS).title).toContain("New change");
    expect(intakePanel(initialIntake, ASCII_GLYPHS).title).toContain("text");

    const file = intakeKeys(initialIntake, "", key({ tab: true }), ctx).state;
    expect(intakePanel(file, ASCII_GLYPHS).title).toContain("file");

    const back = intakeKeys(file, "", key({ tab: true }), ctx).state;
    expect(intakePanel(back, ASCII_GLYPHS).title).toContain("text");
  });
});
