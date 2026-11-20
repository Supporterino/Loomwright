import { describe, expect, test } from "bun:test";
import {
  type ActivityPaneState,
  activityPaneBodyRows,
  activityPaneKeys,
  activityPanePanel,
  cycleScope,
  openActivityPane,
  paneWindow,
  scopeLines,
} from "../src/controls/activity-pane.ts";
import type { KeyInput } from "../src/model/keys.ts";
import { applyKey } from "../src/model/keys.ts";
import type { ActivityLine, RunDetail, TaskRow, ViewModel } from "../src/model/view-model.ts";
import { lastOffset, sliceWindow } from "../src/model/viewport.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";

function task(id: string, repo: string, selected = false): TaskRow {
  return {
    id,
    title: id,
    repo,
    status: "running",
    attempt: 1,
    failures: 0,
    deps: [],
    selected,
  };
}

function line(
  seq: number,
  step: string,
  kind: string,
  text: string,
  logRef?: string,
): ActivityLine {
  return { seq, step, kind, text, ...(logRef === undefined ? {} : { logRef }) };
}

function activity(count: number): ActivityLine[] {
  return Array.from({ length: count }, (_, index) =>
    line(index + 1, "run", "log", `line ${index + 1}`),
  );
}

function run(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "add-health",
    summary: "Add health endpoints",
    phase: "implementing",
    elapsedMs: 0,
    tokens: 0,
    cost: 0,
    lock: { kind: "idle" },
    tasks: [],
    selectedTaskId: null,
    detail: null,
    activity: [],
    questions: [],
    approval: null,
    specFindings: [],
    pausedReason: null,
    replayed: false,
    reword: { state: "absent", reason: null },
    ...overrides,
  };
}

function viewOf(runDetail: RunDetail): ViewModel {
  return {
    source: "live",
    screen: "run",
    columns: 80,
    rows: 24,
    twoPane: false,
    list: [],
    selectedRunId: runDetail.id,
    run: runDetail,
    panel: null,
    footer: [],
    notice: null,
    listWindow: { offset: 0, size: 0, total: 0 },
    taskWindow: { offset: 0, size: 0, total: 0 },
  };
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

const RUN_SCOPE: ActivityPaneState = { scope: "run", taskId: null, offset: 0, follow: false };

describe("the scoped activity pane", () => {
  test("L opens the run log and follows", () => {
    const detail = run({ activity: activity(25) });
    const state = openActivityPane(detail);
    expect(state).toEqual({ scope: "run", taskId: null, offset: 0, follow: true });
    expect(applyKey(viewOf(detail), "L")).toEqual({ kind: "open-activity" });

    // Follow pins the window to the newest lines.
    expect(paneWindow(state, detail.activity.length, 10).offset).toBe(
      lastOffset(detail.activity.length, 10),
    );

    const panel = activityPanePanel({
      run: detail,
      state,
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(panel.title).toBe("Activity - run");
    expect(panel.keys).toContainEqual({ key: "f", label: "follow on", enabled: true });
    expect(panel.lines.filter((row) => row.trim() !== "")).toHaveLength(
      Math.min(activityPaneBodyRows(24), detail.activity.length),
    );
  });

  test("L is inert on the list screen", () => {
    const detail = run();
    const list = { ...viewOf(detail), screen: "list" as const, run: null };
    expect(applyKey(list, "L")).toEqual({ kind: "none" });
  });

  test("Tab reaches task and repo scope", () => {
    const detail = run({
      tasks: [task("first", "app", true), task("test-first", "app"), task("second", "api")],
      selectedTaskId: "first",
      activity: [
        line(1, "run", "run", "run line"),
        line(2, "first", "agent", "first line"),
        line(3, "review:app", "agent", "app review"),
        line(4, "second", "agent", "api line"),
      ],
    });
    const opened = openActivityPane(detail);
    expect(opened).toEqual({ scope: "task", taskId: "first", offset: 0, follow: true });
    const taskPanel = activityPanePanel({
      run: detail,
      state: opened,
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(taskPanel.title).toBe("Activity - first");
    expect(taskPanel.lines.filter((row) => row.trim() !== "")).toEqual([
      "first - agent - first line",
      "review:app - agent - app review",
    ]);

    const repo = cycleScope(detail, opened);
    expect(repo.scope).toBe("repo");
    expect(repo.taskId).toBe("first");
    const repoPanel = activityPanePanel({
      run: detail,
      state: repo,
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(repoPanel.title).toBe("Activity - app");
    expect(repoPanel.lines.filter((row) => row.trim() !== "")).toEqual([
      "first - agent - first line",
      "review:app - agent - app review",
    ]);

    const backToRun = cycleScope(detail, repo);
    expect(backToRun).toEqual({ ...repo, scope: "run", taskId: null });
    const runPanel = activityPanePanel({
      run: detail,
      state: backToRun,
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(runPanel.lines.filter((row) => row.trim() !== "")).toHaveLength(4);
    expect(cycleScope(detail, backToRun)).toEqual({ ...backToRun, scope: "task", taskId: "first" });
  });

  test("Tab reaches task and repo scope: a run with no tasks stays on the run", () => {
    const detail = run();
    const state = openActivityPane(detail);
    expect(cycleScope(detail, state)).toEqual(state);
  });

  test("Tab reaches task and repo scope: a task with no repo skips the repo scope", () => {
    const detail = run({ tasks: [task("solo", "")], selectedTaskId: "solo" });
    const state = openActivityPane(detail);
    expect(state.scope).toBe("task");
    expect(cycleScope(detail, state).scope).toBe("run");
  });

  test("paging and first and last", () => {
    const detail = run({ activity: activity(200) });
    const down = activityPaneKeys(detail, RUN_SCOPE, "", key({ pageDown: true }), 10);
    expect(down.state.offset).toBe(10);
    const up = activityPaneKeys(detail, down.state, "", key({ pageUp: true }), 10);
    expect(up.state.offset).toBe(0);

    const j = activityPaneKeys(detail, RUN_SCOPE, "j", key(), 10);
    expect(j.state.offset).toBe(1);
    const k = activityPaneKeys(detail, j.state, "k", key(), 10);
    expect(k.state.offset).toBe(0);

    const first = activityPaneKeys(detail, { ...RUN_SCOPE, offset: 100 }, "g", key(), 10);
    expect(first.state.offset).toBe(0);
    const last = activityPaneKeys(detail, RUN_SCOPE, "G", key(), 10);
    expect(last.state.offset).toBe(190);
    expect(last.state.offset).toBeLessThanOrEqual(200 - 10);

    // Clamped at both ends.
    expect(
      activityPaneKeys(detail, { ...RUN_SCOPE, offset: 190 }, "j", key(), 10).state.offset,
    ).toBe(190);
    expect(activityPaneKeys(detail, RUN_SCOPE, "k", key(), 10).state.offset).toBe(0);
  });

  test("arrows scroll one line and turn follow off", () => {
    const detail = run({ activity: activity(50) });
    const state: ActivityPaneState = { ...RUN_SCOPE, follow: true };
    const down = activityPaneKeys(detail, state, "", key({ downArrow: true }), 10);
    expect(down.state.follow).toBe(false);
    expect(down.state.offset).toBe(lastOffset(50, 10));
    const up = activityPaneKeys(detail, state, "", key({ upArrow: true }), 10);
    expect(up.state.offset).toBe(lastOffset(50, 10) - 1);
  });

  test("follow off keeps the viewport", () => {
    const detail = run({ activity: activity(120) });
    const off: ActivityPaneState = { scope: "run", taskId: null, offset: 50, follow: false };
    const before = paneWindow(off, 100, 10);
    const after = paneWindow(off, 120, 10);
    expect(before.offset).toBe(50);
    expect(after.offset).toBe(50);
    expect(sliceWindow(activity(120), after)).toEqual(sliceWindow(activity(100), before));

    // Follow on pins to the newest line after the log grows.
    const on: ActivityPaneState = { ...off, follow: true };
    expect(paneWindow(on, 100, 10).offset).toBe(90);
    expect(paneWindow(on, 120, 10).offset).toBe(110);

    const toggled = activityPaneKeys(detail, off, "f", key(), 10);
    expect(toggled.state.follow).toBe(true);
    expect(toggled.state.offset).toBe(110);
    expect(paneWindow(toggled.state, 120, 10).offset).toBe(110);
  });

  test("Esc returns to the view the pane was opened from", () => {
    const detail = run({ tasks: [task("first", "app", true)], selectedTaskId: "first" });
    const state = openActivityPane(detail);
    const outcome = activityPaneKeys(detail, state, "", key({ escape: true }), 10);
    expect(outcome.close).toBe(true);
    expect(outcome.state).toBe(state);
  });

  test("the activity pane lists only the scope's lines and names the scope", () => {
    const detail = run({
      tasks: [task("first", "app"), task("second", "api")],
      activity: [
        line(1, "run", "run", "run line"),
        line(2, "first", "agent", "first tool", ".factory/logs/first.log"),
        line(3, "review:app", "agent", "app review"),
        line(4, "second", "agent", "api line"),
      ],
    });
    const runPanel = activityPanePanel({
      run: detail,
      state: RUN_SCOPE,
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(runPanel.lines.filter((row) => row.trim() !== "")).toEqual([
      "run - run - run line",
      "first - agent - > .factory/logs/first.log first tool",
      "review:app - agent - app review",
      "second - agent - api line",
    ]);
    expect(scopeLines(detail, RUN_SCOPE)).toHaveLength(4);

    const taskPanel = activityPanePanel({
      run: detail,
      state: { scope: "task", taskId: "first", offset: 0, follow: false },
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(taskPanel.lines.filter((row) => row.trim() !== "")).toEqual([
      "first - agent - > .factory/logs/first.log first tool",
      "review:app - agent - app review",
    ]);

    const repoPanel = activityPanePanel({
      run: detail,
      state: { scope: "repo", taskId: "first", offset: 0, follow: false },
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(repoPanel.title).toBe("Activity - app");
    expect(repoPanel.lines.filter((row) => row.trim() !== "")).toEqual([
      "first - agent - > .factory/logs/first.log first tool",
      "review:app - agent - app review",
    ]);
  });

  test("replay scrolls the pane but launches nothing", () => {
    const detail = run({ replayed: true, activity: activity(30) });
    const state = openActivityPane(detail);
    const scrolled = activityPaneKeys(detail, state, "G", key(), 10);
    expect(scrolled.state.offset).toBe(lastOffset(30, 10));
    const outcome = activityPaneKeys(detail, state, "j", key(), 10);
    expect("launch" in outcome).toBe(false);
    expect("write" in outcome).toBe(false);
    expect(outcome.state.follow).toBe(false);
  });
});
