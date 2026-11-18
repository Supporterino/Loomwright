import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatusDocument } from "@loomwright/core/factory";
import type { ActiveLock } from "@loomwright/core/state/active";
import { RunState } from "@loomwright/core/state/run";
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
import type { KeyInput } from "../src/model/keys.ts";
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
    openError: null,
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

    const outcome = intakeKeys(state, "", key({ return: true }), ctx);
    expect(outcome.submit).toEqual({
      kind: "run-file",
      path: join(ws, ".factory", "requests", "faster-imports.md"),
    });
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
  test("the message and init hint stay inline and the dialog keeps running", () => {
    const ws = workspace();
    const ctx = context(ws, { openError: "loomwright is not installed here" });
    const outcome = intakeKeys(
      typeText("add a health endpoint", ctx),
      "",
      key({ return: true }),
      ctx,
    );

    expect(outcome.submit).toBeUndefined();
    expect(outcome.state.error).toContain("loomwright is not installed here");
    expect(outcome.state.error).toContain("loomwright init");
    expect(panelText(outcome.state)).toContain("loomwright is not installed here");

    const toggled = intakeKeys(outcome.state, "", key({ tab: true }), ctx);
    expect(toggled.state.mode).toBe("file");
  });
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
