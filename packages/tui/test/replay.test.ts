import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Factory } from "@loomwright/core/factory";
import { MISSING_IDENTITY } from "../src/approval/overlay.ts";
import {
  activityPaneBodyRows,
  activityPaneKeys,
  openActivityPane,
} from "../src/controls/activity-pane.ts";
import {
  isReadOnly,
  REPLAY_READ_ONLY,
  replayActivityView,
  replayHelpView,
  replayKey,
  replayView,
  runTui,
} from "../src/entry.tsx";
import type { Launcher } from "../src/launch/launcher.ts";
import type { KeyInput } from "../src/model/keys.ts";
import { renderOnceFrame } from "../src/replay/once.ts";
import { readReplayFile, replayModel } from "../src/replay/replay.ts";
import { replayNotice } from "../src/strings.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/tui/approval-gate.jsonl", import.meta.url),
);
const NOW = Date.parse("2026-11-18T10:00:00.000Z");
const SIZE = { ascii: true, columns: 80, rows: 24 } as const;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(name: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "loomwright-replay-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

/** One valid event per object, JSON-escaped as the writer would have written it. */
function replayLines(events: readonly { readonly type: string; readonly data: unknown }[]): string {
  const lines = events.map((entry, index) =>
    JSON.stringify({
      v: 1,
      runId: "add-health",
      seq: index + 1,
      ts: "2026-11-18T10:00:00.000Z",
      ...entry,
    }),
  );
  return `${lines.join("\n")}\n`;
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

/** Any call is a failure: replay must never poll status, list runs or emit a write. */
function unusedFactory(): Factory {
  const fail = (): never => {
    throw new Error("the factory must not be used in replay");
  };
  return {
    status: async () => fail(),
    listRuns: async () => fail(),
    events: () => fail(),
    run: async () => fail(),
    resume: async () => fail(),
    approve: async () => fail(),
    retry: async () => fail(),
    abort: async () => fail(),
    answer: async () => fail(),
    pause: async () => fail(),
  };
}

/** Any call is a failure: replay must never spawn a child. */
function unusedLauncher(): Launcher {
  return {
    launch: async () => {
      throw new Error("the launcher must not be used in replay");
    },
  };
}

function viewOf(load: Awaited<ReturnType<typeof readReplayFile>>) {
  return replayView(load, { now: NOW, ...SIZE });
}

describe("replay shows the recorded screens", () => {
  test("the approval-gate fixture reduces to the run and its overlay", async () => {
    const load = await readReplayFile(FIXTURE);
    expect(load.skipped).toEqual([]);
    expect(load.events).toHaveLength(13);

    const model = replayModel(load, NOW);
    expect(model.snapshot.runId).toBe("add-health");
    expect(model.snapshot.phase).toBe("awaiting-approval");
    expect(model.snapshot.pendingApproval?.specHash).not.toBeNull();

    const view = viewOf(load);
    expect(view.screen).toBe("run");
    expect(view.run?.id).toBe("add-health");
    expect(view.run?.replayed).toBe(true);
    expect(view.panel?.kind).toBe("approval");
    expect(view.panel?.title).toContain("add-health");
    expect(view.panel?.lines.some((line) => line.startsWith("spec hash: <sha>"))).toBe(true);
    expect(view.panel?.notice).toContain("read-only");
  });

  test("an older stream without approval.pending still shows the phase-driven overlay", async () => {
    const path = tempFile(
      "older.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"phase.changed","data":{"from":"design","to":"awaiting-approval"}}',
        "",
      ].join("\n"),
    );
    const view = viewOf(await readReplayFile(path));
    expect(view.panel?.kind).toBe("approval");
    expect(view.panel?.lines).toContain("spec hash: unknown (older stream)");
  });

  test("phase.changed, install and progress lines in the stream appear in the tail", async () => {
    const path = tempFile(
      "activity.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"phase.changed","data":{"from":"intake","to":"design"}}',
        '{"v":1,"runId":"add-health","seq":3,"ts":"2026-11-18T10:00:00.000Z","type":"install.started","data":{"step":"deps","repo":"loomwright","detail":"bun install"}}',
        '{"v":1,"runId":"add-health","seq":4,"ts":"2026-11-18T10:00:00.000Z","type":"install.finished","data":{"step":"deps","repo":"loomwright","durationMs":1200,"detail":"bun install"}}',
        '{"v":1,"runId":"add-health","seq":5,"ts":"2026-11-18T10:00:00.000Z","type":"progress.line","data":{"level":"always","text":"design: 3 capabilities planned"}}',
        "",
      ].join("\n"),
    );

    const view = viewOf(await readReplayFile(path));
    const activity = view.run?.activity ?? [];
    expect(activity.map((line) => line.kind)).toEqual([
      "run",
      "phase",
      "install",
      "install",
      "log",
    ]);
    expect(activity.map((line) => line.step)).toContain("loomwright");
    expect(activity.some((line) => line.text.includes("design"))).toBe(true);
  });

  test("a replayed approval frame does not report a missing git identity", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    expect(view.panel?.kind).toBe("approval");
    const lines = view.panel?.lines ?? [];
    expect(lines.join("\n")).not.toContain(MISSING_IDENTITY);
    expect(lines.some((line) => line.startsWith("identity:"))).toBe(false);
    expect(view.panel?.notice).toContain("read-only");
  });
});

describe("readReplayFile", () => {
  test("skips a corrupt line and an unknown type without failing the replay", async () => {
    const path = tempFile(
      "mixed.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        "not json",
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"no.such.type","data":{}}',
        "",
      ].join("\n"),
    );

    const load = await readReplayFile(path);
    expect(load.events).toHaveLength(1);
    expect(load.skipped.map((entry) => entry.line)).toEqual([2, 3]);
    expect(load.skipped.every((entry) => entry.reason !== "")).toBe(true);
    expect(replayModel(load, NOW).snapshot.phase).toBe("design");
  });

  test("ignores a trailing partial line without a newline", async () => {
    const path = tempFile(
      "partial.jsonl",
      '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}\n{"v":1',
    );
    const load = await readReplayFile(path);
    expect(load.events).toHaveLength(1);
    expect(load.skipped).toEqual([]);
  });
});

describe("once prints one frame", () => {
  test("renderOnceFrame returns plain text at the requested size", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    const text = await renderOnceFrame(view, SIZE);
    expect(text).not.toContain("\u001b[");
    expect(text).toContain("add-health");
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(SIZE.rows);
    expect(lines.every((line) => line.length <= SIZE.columns)).toBe(true);
  });

  test("runTui writes exactly one frame to out and returns 0", async () => {
    const frames: string[] = [];
    const code = await runTui({
      workspace: null,
      replay: FIXTURE,
      once: true,
      ascii: true,
      columns: SIZE.columns,
      rows: SIZE.rows,
      out: (text) => frames.push(text),
      factory: unusedFactory(),
      launcher: unusedLauncher(),
    });

    expect(code).toBe(0);
    expect(frames).toHaveLength(1);
    expect(frames[0]).not.toContain("\u001b[");
    expect(frames[0]).toContain("add-health");
  });

  test("a crafted --replay file cannot inject terminal controls", async () => {
    const taskPath = tempFile(
      "crafted-task.jsonl",
      replayLines([
        { type: "run.started", data: { phase: "implementing" } },
        {
          type: "task.queued",
          data: {
            task: { id: "\u001b[2Jtask", repo: "rep\u001b]52;c;o\u0007" },
            attempt: 1,
          },
        },
        {
          type: "task.started",
          data: {
            task: { id: "\u001b[2Jtask", repo: "rep\u001b]52;c;o\u0007" },
            attempt: 1,
          },
        },
        {
          type: "agent.started",
          data: {
            step: "\u001b[2Jtask",
            agent: "\u001b[2Jimpl",
            model: "model\u001b]52;c;x\u0007",
          },
        },
        {
          type: "gate.finished",
          data: {
            name: "\u001b[2Jlint",
            type: "lint",
            status: "pass",
            durationMs: 5,
            step: "\u001b[2Jtask",
          },
        },
      ]),
    );
    const taskText = await renderOnceFrame(viewOf(await readReplayFile(taskPath)), SIZE);
    expect(taskText).toContain("[2Jtask");
    expect(taskText).toContain("[2Jlint");
    expect(taskText).not.toContain("\u001b]");
    expect(taskText).not.toContain("\u0007");

    const approvalPath = tempFile(
      "crafted-approval.jsonl",
      replayLines([
        { type: "run.started", data: { phase: "design" } },
        { type: "phase.changed", data: { from: "design", to: "awaiting-approval" } },
        {
          type: "approval.pending",
          data: { specHash: "\u001b]52;c;h\u0007", changeDir: "\u001b[2Jdir" },
        },
      ]),
    );
    const panelText = await renderOnceFrame(viewOf(await readReplayFile(approvalPath)), SIZE);
    expect(panelText).toContain("[2Jdir");
    expect(panelText).toContain("]52;c;h");
    expect(panelText).not.toContain("\u001b]");
    expect(panelText).not.toContain("\u0007");
  });
});

describe("replay is read-only", () => {
  test("the view-model is replay and all four approval actions are unavailable", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    expect(view.source).toBe("replay");
    expect(isReadOnly(view)).toBe(true);
    expect(view.notice).toContain("read-only");

    const keys = view.panel?.keys.map((hint) => hint.key) ?? [];
    for (const write of ["a", "A", "w", "R"]) expect(keys).not.toContain(write);
  });

  test("replay is read-only on a stream that does not end at the gate", async () => {
    const path = tempFile(
      "implementing.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"phase.changed","data":{"from":"design","to":"implementing"}}',
        "",
      ].join("\n"),
    );
    const view = viewOf(await readReplayFile(path));
    expect(view.panel).toBeNull();
    expect(view.screen).toBe("run");
    expect(await renderOnceFrame(view, SIZE)).toContain(replayNotice);

    const pressed = replayKey(view, "n", key());
    expect(pressed.notice).toBe(REPLAY_READ_ONLY);
    const after = await renderOnceFrame({ ...view, notice: pressed.notice }, SIZE);
    expect(after).toContain(REPLAY_READ_ONLY);
  });

  test("every write key produces the read-only notice and quits only on q or Ctrl-C", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    for (const input of ["n", "a", "A", "w", "R", "r", "x", "t", "l", "Q"]) {
      const outcome = replayKey(view, input, key());
      expect(outcome.quit).toBe(false);
      expect(outcome.notice).toBe(REPLAY_READ_ONLY);
    }
    expect(replayKey(view, "l", key()).notice).toBe(REPLAY_READ_ONLY);
    expect(replayKey(view, "q", key()).quit).toBe(true);
    expect(replayKey(view, "c", key({ ctrl: true })).quit).toBe(true);
  });

  test("replay scrolls the pane but launches nothing", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    // The log navigation keys are not writes: none produces the read-only notice.
    for (const input of ["L", "j", "k", "g", "G", "f"]) {
      const outcome = replayKey(view, input, key());
      expect(outcome.quit, input).toBe(false);
      expect(outcome.notice, input).toBeNull();
    }
    const tab = replayKey(view, "", key({ tab: true }));
    expect(tab.quit).toBe(false);
    expect(tab.notice).toBeNull();
  });

  test("L opens and scrolls the pane with no notice, and the frame stays inside rows", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    const opened = replayKey(view, "L", key());
    expect(opened.notice).toBeNull();
    expect(opened.help).toBeNull();
    expect(opened.quit).toBe(false);

    const run = view.run;
    if (run === null) throw new Error("the replay fixture has no run");
    // The fixture is short; a longer stream proves the pane scrolls and still fits.
    const activity = Array.from({ length: 40 }, (_, index) => ({
      seq: index + 1,
      step: "run",
      kind: "log",
      text: `recorded line ${index + 1}`,
    }));
    const longer = { ...view, run: { ...run, activity } };
    const pane = openActivityPane(longer.run);
    const scrolled = activityPaneKeys(
      longer.run,
      pane,
      "k",
      key(),
      activityPaneBodyRows(SIZE.rows),
    );
    expect(scrolled.state.follow).toBe(false);
    expect(scrolled.state.offset).toBeGreaterThan(0);

    const frame = await renderOnceFrame(
      replayActivityView(longer, scrolled.state, ASCII_GLYPHS),
      SIZE,
    );
    expect(frame).toContain("Activity");
    expect(frame.split("\n").length).toBeLessThanOrEqual(SIZE.rows);
  });

  test("? opens the help panel in replay and Esc closes it", async () => {
    const path = tempFile(
      "implementing.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"phase.changed","data":{"from":"design","to":"implementing"}}',
        "",
      ].join("\n"),
    );
    const view = viewOf(await readReplayFile(path));
    expect(view.footer.map((hint) => hint.key)).toContain("?");

    const pressed = replayKey(view, "?", key());
    expect(pressed.help).toBe(true);
    expect(pressed.quit).toBe(false);
    expect(pressed.notice).toBeNull();

    const help = replayHelpView(view);
    expect(help.panel?.kind).toBe("help");
    expect(help.footer.map((hint) => hint.key)).toEqual(["Esc", "q"]);
    const frame = await renderOnceFrame(help, SIZE);
    expect(frame).toContain("Help");
    expect(frame).toContain("Esc close");

    const closed = replayKey(help, "", key({ escape: true }));
    expect(closed.help).toBe(false);
    expect(closed.quit).toBe(false);
    expect(replayKey(help, "q", key()).quit).toBe(true);
  });

  test("Ctrl-C quits the replay with the help panel open", async () => {
    const path = tempFile(
      "implementing.jsonl",
      [
        '{"v":1,"runId":"add-health","seq":1,"ts":"2026-11-18T10:00:00.000Z","type":"run.started","data":{"phase":"design"}}',
        '{"v":1,"runId":"add-health","seq":2,"ts":"2026-11-18T10:00:00.000Z","type":"phase.changed","data":{"from":"design","to":"implementing"}}',
        "",
      ].join("\n"),
    );
    const view = viewOf(await readReplayFile(path));
    const help = replayHelpView(view);
    expect(help.panel?.kind).toBe("help");
    expect(replayKey(help, "c", key({ ctrl: true })).quit).toBe(true);
  });

  test("the replay approval overlay never advertises ? and ignores it", async () => {
    const view = viewOf(await readReplayFile(FIXTURE));
    expect(view.panel?.kind).toBe("approval");
    expect(view.footer.map((hint) => hint.key)).not.toContain("?");
    expect(replayKey(view, "?", key()).help).toBeNull();
  });
});
