import { describe, expect, test } from "bun:test";
import {
  clampOffset,
  firstOffset,
  followOffset,
  lastOffset,
  moveBy,
  nextOffset,
  pageSize,
  sliceWindow,
  window,
  windowTitle,
} from "../src/model/viewport.ts";

const RUNS = 60;
const EIGHTY_BY_TWENTY_FOUR = 22;
const ONE_TWENTY_BY_FORTY = 38;

describe("clamp", () => {
  test("clamps at both ends and for degenerate sizes", () => {
    expect(clampOffset(-3, 60, 9)).toBe(0);
    expect(clampOffset(999, 60, 9)).toBe(51);
    expect(clampOffset(4, 3, 9)).toBe(0);
    expect(clampOffset(4, 10, 0)).toBe(0);
  });
});

describe("exhaustive windows", () => {
  for (const [name, size] of [
    ["80x24", EIGHTY_BY_TWENTY_FOUR],
    ["120x40", ONE_TWENTY_BY_FORTY],
  ] as const) {
    test(`a 60-run list keeps the frame still at ${name}`, () => {
      for (let offset = 0; offset <= RUNS; offset += 1) {
        const clamped = clampOffset(offset, RUNS, size);
        expect(clamped).toBeGreaterThanOrEqual(0);
        expect(clamped).toBeLessThanOrEqual(Math.max(0, RUNS - size));

        const w = window(offset, RUNS, size);
        expect(w.total).toBe(RUNS);
        expect(w.offset).toBeLessThanOrEqual(RUNS);
        expect(w.offset + w.size).toBeLessThanOrEqual(RUNS + size);
        expect(w.size).toBe(size);

        const lines = Array.from({ length: RUNS }, (_, index) => index);
        expect(sliceWindow(lines, w)).toHaveLength(Math.min(size, RUNS - offset));
      }
    });
  }
});

describe("resize", () => {
  test("resize re-clamps the offset and recomputes the title", () => {
    const small = window(lastOffset(RUNS, EIGHTY_BY_TWENTY_FOUR), RUNS, EIGHTY_BY_TWENTY_FOUR);
    const selection = 40;
    expect(windowTitle("runs", small)).toBe("runs 39-60/60");
    expect(selection).toBeGreaterThanOrEqual(small.offset);
    expect(selection).toBeLessThan(small.offset + small.size);

    const resized = nextOffset(small.offset, selection, RUNS, ONE_TWENTY_BY_FORTY);
    const large = window(resized, RUNS, ONE_TWENTY_BY_FORTY);
    expect(large.offset).toBe(RUNS - ONE_TWENTY_BY_FORTY);
    expect(selection).toBeGreaterThanOrEqual(large.offset);
    expect(selection).toBeLessThan(large.offset + large.size);
    expect(windowTitle("runs", large)).toBe("runs 23-60/60");
  });
});

describe("selection after a data change", () => {
  test("follow off leaves the offset alone when rows are appended", () => {
    const before = followOffset(50, 100, 10, false);
    const after = followOffset(before, 120, 10, false);
    expect(after).toBe(before);
  });

  test("follow on lands on the new last row when rows are appended", () => {
    expect(followOffset(50, 100, 10, true)).toBe(90);
    expect(followOffset(50, 120, 10, true)).toBe(110);
  });

  test("rows removed below the offset clamp it and keep the selection visible", () => {
    const clamped = nextOffset(110, 112, 115, 10);
    expect(clamped).toBe(105);
    expect(112).toBeGreaterThanOrEqual(clamped);
    expect(112).toBeLessThan(clamped + 10);
  });
});

describe("follow", () => {
  test("follow off keeps the viewport and follow on pins to the newest row", () => {
    expect(followOffset(0, 100, 10, true)).toBe(90);
    expect(followOffset(90, 100, 10, true)).toBe(90);
    expect(followOffset(50, 100, 10, false)).toBe(50);
    expect(followOffset(999, 100, 10, false)).toBe(90);
  });

  test("new events arriving do not move a follow-off offset", () => {
    const offset = followOffset(50, 100, 10, false);
    const afterArrival = followOffset(offset, 130, 10, false);
    expect(afterArrival).toBe(offset);
  });
});

describe("paging", () => {
  test("a page move keeps the selection in the window", () => {
    const size = 10;
    const length = 30;
    let offset = firstOffset(length);
    offset = moveBy(offset, pageSize(size), length, size);
    expect(offset).toBe(10);
    offset = moveBy(offset, pageSize(size), length, size);
    expect(offset).toBe(20);
    offset = moveBy(offset, pageSize(size), length, size);
    expect(offset).toBe(20);
    expect(offset).toBe(lastOffset(length, size));

    offset = moveBy(offset, -pageSize(size), length, size);
    offset = moveBy(offset, -pageSize(size), length, size);
    expect(offset).toBe(0);

    expect(moveBy(offset, length, length, size)).toBe(lastOffset(length, size));
    expect(firstOffset(length)).toBe(0);
    expect(pageSize(0)).toBe(1);
  });

  test("paging and first and last stay inside [0, lines - height]", () => {
    const height = 10;
    const lines = 200;
    let offset = moveBy(0, pageSize(height), lines, height);
    expect(offset).toBe(10);
    offset = moveBy(offset, lines, lines, height);
    expect(offset).toBe(lastOffset(lines, height));
    offset = firstOffset(lines);
    expect(offset).toBe(0);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(lines - height);
    expect(lastOffset(lines, height)).toBeLessThanOrEqual(lines - height);
  });
});

describe("titles", () => {
  test("show no window when the list fits", () => {
    expect(windowTitle("runs", window(0, 9, 9))).toBeNull();
  });

  test("the title names the window only when needed", () => {
    expect(windowTitle("runs", window(0, 60, 9))).toBe("runs 1-9/60");
    expect(windowTitle("runs", window(2, 12, 9))).toBe("runs 3-11/12");
  });
});
