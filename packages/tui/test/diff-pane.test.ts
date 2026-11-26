import { describe, expect, test } from "bun:test";
import type { ChangeDiff } from "@loomwright/core/pipeline/diff";
import {
  diffLines,
  diffPaneBodyRows,
  diffPaneKeys,
  diffPanePanel,
  openDiffPane,
} from "../src/controls/diff-pane.ts";
import type { KeyInput } from "../src/model/keys.ts";
import { lastOffset } from "../src/model/viewport.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";

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

const PATCH = [
  "diff --git a/src/health.ts b/src/health.ts",
  "index 1111111..2222222 100644",
  "--- a/src/health.ts",
  "+++ b/src/health.ts",
  "@@ -1 +1,2 @@",
  "+ok",
  "",
].join("\n");

const DIFF: ChangeDiff = {
  id: "add-health",
  repos: [
    {
      repo: "app",
      path: "app",
      target: "main",
      branch: "change/add-health",
      status: "diff",
      files: [{ path: "src/health.ts", added: 10, deleted: 1 }],
      patch: PATCH,
    },
    {
      repo: "api",
      path: "api",
      target: "main",
      branch: "change/add-health",
      status: "missing",
      files: [],
      patch: "",
    },
  ],
};

function longDiff(count: number): ChangeDiff {
  const patch = Array.from({ length: count }, (_, index) => `+line ${index + 1}`).join("\n");
  return {
    id: "add-health",
    repos: [
      {
        repo: "app",
        path: "app",
        target: "main",
        branch: "change/add-health",
        status: "diff",
        files: [],
        patch,
      },
    ],
  };
}

describe("the diff pane", () => {
  test("diffLines flattens each repo's header and patch, and a missing repo has no patch", () => {
    expect(diffLines(DIFF)).toEqual([
      "app: main <- change/add-health (diff)",
      "diff --git a/src/health.ts b/src/health.ts",
      "index 1111111..2222222 100644",
      "--- a/src/health.ts",
      "+++ b/src/health.ts",
      "@@ -1 +1,2 @@",
      "+ok",
      "api: no change branch",
    ]);
  });

  test("diffLines strips terminal controls from patch lines", () => {
    const diff: ChangeDiff = {
      id: "add-health",
      repos: [
        {
          repo: "app",
          path: "app",
          target: "main",
          branch: "change/add-health",
          status: "diff",
          files: [],
          patch: "+clear \u001b[2J\n+clip \u001b]52;c;YWJj\u0007",
        },
      ],
    };
    expect(diffLines(diff)).toEqual([
      "app: main <- change/add-health (diff)",
      "+clear [2J",
      "+clip ]52;c;YWJj",
    ]);
  });

  test("openDiffPane keeps the id, flattens the lines and starts at the top", () => {
    const state = openDiffPane(DIFF);
    expect(state.id).toBe("add-health");
    expect(state.lines).toEqual(diffLines(DIFF));
    expect(state.offset).toBe(0);
  });

  test("the panel titles the change and shows the patch at the ASCII dash", () => {
    const state = openDiffPane(DIFF);
    const panel = diffPanePanel({ state, glyphs: ASCII_GLYPHS, rows: 24 });
    expect(panel.kind).toBe("diff");
    expect(panel.title).toBe("Diff - add-health");
    expect(panel.keys).toEqual([
      { key: "j/k", label: "scroll", enabled: true },
      { key: "PgUp/PgDn", label: "page", enabled: true },
      { key: "g/G", label: "ends", enabled: true },
      { key: "Esc", label: "back", enabled: true },
    ]);
    const body = panel.lines.filter((line) => line.trim() !== "");
    expect(body).toEqual(diffLines(DIFF));
    expect(panel.lines).toHaveLength(diffPaneBodyRows(24));
  });

  test("a missing repo renders no change branch", () => {
    const panel = diffPanePanel({
      state: openDiffPane(DIFF),
      glyphs: ASCII_GLYPHS,
      rows: 24,
    });
    expect(panel.lines).toContain("api: no change branch");
    expect(panel.lines.some((line) => line.includes("api: main"))).toBe(false);
  });

  test("the panel's line count equals diffPaneBodyRows for 24 and 40 rows", () => {
    expect(diffPaneBodyRows(24)).toBe(19);
    expect(diffPaneBodyRows(40)).toBe(35);
    for (const rows of [24, 40]) {
      const panel = diffPanePanel({ state: openDiffPane(DIFF), glyphs: ASCII_GLYPHS, rows });
      expect(panel.lines).toHaveLength(diffPaneBodyRows(rows));
    }
  });

  test("the diff pane scrolls and closes", () => {
    const diff = longDiff(100);
    const opened = openDiffPane(diff);
    const size = diffPaneBodyRows(24);

    const page = diffPaneKeys(opened, "", key({ pageDown: true }), size);
    expect(page.state.offset).toBe(size);
    const back = diffPaneKeys(page.state, "", key({ pageUp: true }), size);
    expect(back.state.offset).toBe(0);

    const j = diffPaneKeys(opened, "j", key(), size);
    expect(j.state.offset).toBe(1);
    const k = diffPaneKeys(j.state, "k", key(), size);
    expect(k.state.offset).toBe(0);

    const end = diffPaneKeys(opened, "G", key(), size);
    expect(end.state.offset).toBe(lastOffset(opened.lines.length, size));
    const start = diffPaneKeys({ ...end.state, offset: 50 }, "g", key(), size);
    expect(start.state.offset).toBe(0);

    // Clamped at both ends.
    expect(diffPaneKeys({ ...opened, offset: 0 }, "k", key(), size).state.offset).toBe(0);
    expect(
      diffPaneKeys({ ...opened, offset: lastOffset(opened.lines.length, size) }, "G", key(), size)
        .state.offset,
    ).toBe(lastOffset(opened.lines.length, size));

    const closed = diffPaneKeys(opened, "", key({ escape: true }), size);
    expect(closed.close).toBe(true);
    expect(closed.state).toBe(opened);

    // An inert key leaves the state untouched.
    expect(diffPaneKeys(opened, "z", key(), size).state).toBe(opened);
  });

  test("the diff pane scrolls and closes: the window stays inside the rows", () => {
    const diff = longDiff(100);
    const opened = openDiffPane(diff);
    const size = diffPaneBodyRows(24);
    const scrolled = diffPaneKeys(opened, "G", key(), size).state;
    const panel = diffPanePanel({ state: scrolled, glyphs: ASCII_GLYPHS, rows: 24 });
    expect(panel.lines).toHaveLength(size);
    expect(panel.lines.filter((line) => line.trim() !== "")).toHaveLength(size);
    expect(panel.lines).toContain("+line 100");
    expect(panel.lines).not.toContain("+line 1");
  });
});
