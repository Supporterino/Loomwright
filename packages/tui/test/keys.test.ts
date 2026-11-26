import { describe, expect, test } from "bun:test";
import { applyKey } from "../src/model/keys.ts";
import type { ViewModel } from "../src/model/view-model.ts";

function view(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    source: "live",
    screen: "run",
    columns: 80,
    rows: 24,
    twoPane: false,
    list: [],
    selectedRunId: "add-health",
    run: null,
    panel: null,
    footer: [],
    notice: null,
    listWindow: { offset: 0, size: 0, total: 0 },
    taskWindow: { offset: 0, size: 0, total: 0 },
    ...overrides,
  };
}

describe("keys", () => {
  test("on the run screen d opens the diff and l still lands", () => {
    const runView = view();
    expect(applyKey(runView, "d")).toEqual({ kind: "open-diff" });
    expect(applyKey(runView, "l")).toEqual({ kind: "land" });
  });

  test("on the list screen d opens nothing", () => {
    expect(applyKey(view({ screen: "list" }), "d")).toEqual({ kind: "none" });
  });

  test("a panel owns every key, so d opens nothing while it is open", () => {
    const panel = {
      kind: "help" as const,
      title: "Help",
      lines: [],
      keys: [],
      notice: null,
    };
    expect(applyKey(view({ panel }), "d")).toEqual({ kind: "none" });
  });

  test("q and ? are unaffected", () => {
    expect(applyKey(view(), "q")).toEqual({ kind: "quit" });
    expect(applyKey(view(), "?")).toEqual({ kind: "help" });
    expect(applyKey(view({ screen: "list" }), "q")).toEqual({ kind: "quit" });
    expect(applyKey(view({ screen: "list" }), "?")).toEqual({ kind: "help" });
  });
});
