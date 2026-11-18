import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyWorkspace } from "../src/strings.ts";
import { renderFrame } from "../src/views/frame.tsx";
import { SIZES, STATES } from "./frame-states.ts";

const framesDir = fileURLToPath(new URL("./fixtures/frames", import.meta.url));

describe("every screen has both sizes", () => {
  for (const [state, make] of Object.entries(STATES)) {
    for (const size of SIZES) {
      const file = join(framesDir, `${state}-${size.columns}x${size.rows}.txt`);
      test(`${state} at ${size.columns}x${size.rows}`, async () => {
        const actual = await renderFrame(make(), size, { ascii: true });
        expect(actual.includes("\u001b[")).toBe(false);
        expect(actual).toMatch(/^[\t\n -~]*$/u);
        expect(actual.split("\n").length).toBeLessThanOrEqual(size.rows);
        if (process.env.UPDATE_FRAMES === "1") {
          mkdirSync(framesDir, { recursive: true });
          writeFileSync(file, `${actual}\n`);
          return;
        }
        const expected = readFileSync(file, "utf8").replace(/\n$/u, "");
        expect(actual, `${state} ${size.columns}x${size.rows}`).toBe(expected);
      });
    }
  }
});

describe("an empty workspace frame", () => {
  test("says no changes exist and names n", async () => {
    const text = await renderFrame(STATES["no-runs"](), { columns: 80, rows: 24 }, { ascii: true });
    expect(text).toContain(emptyWorkspace);
    expect(text).toContain("n");
  });
});
