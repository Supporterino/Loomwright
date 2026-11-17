import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { FACTORY_VERSION } from "@loomwright/core/version";
import {
  CONTROL_ACTIONS,
  captureAll,
  declaredMinimums,
  ECHO_ACTIONS,
  type NormaliseContext,
  normalise,
  STATUS_BY_ID_KEYS,
  STATUS_KEYS,
  verifyInventory,
  verifyThresholds,
} from "./baseline-capture.ts";

const baseline = join(import.meta.dir, "fixtures", "baseline");
const repoRoot = join(import.meta.dir, "..", "..", "..");
const temporary: string[] = [];

function directory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function read(name: string): string {
  return readFileSync(join(baseline, name), "utf8");
}

function json(name: string): unknown {
  const parsed: unknown = JSON.parse(read(name));
  return parsed;
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${what} is not an object`);
  return Object.fromEntries(Object.entries(value));
}

function sortedKeys(value: unknown, what: string): string[] {
  return Object.keys(objectOf(value, what)).sort();
}

describe("baseline: the two stub scenarios are captured", () => {
  test("the two stub scenarios are captured: deterministic bytes, no timestamps, temp paths or pids", async () => {
    const first = directory("baseline-first-");
    const second = directory("baseline-second-");
    await captureAll(first);
    await captureAll(second);

    const names = readdirSync(first).sort();
    expect(names).toEqual(readdirSync(second).sort());
    for (const name of names) {
      expect(readFileSync(join(second, name), "utf8")).toBe(
        readFileSync(join(first, name), "utf8"),
      );
    }

    for (const name of [
      "single.stdout.txt",
      "single.stderr.txt",
      "single.exit.txt",
      "submodules.stdout.txt",
      "submodules.stderr.txt",
      "submodules.exit.txt",
    ]) {
      expect(names).toContain(name);
    }
    for (const name of ["single.exit.txt", "submodules.exit.txt"]) {
      const code = Number(read(name).trim());
      expect(Number.isInteger(code)).toBe(true);
    }
    expect(read("single.stdout.txt")).toContain("===== run (exit 0) =====");
    expect(read("single.stdout.txt")).toContain("===== resume (exit 0) =====");

    // Every normalised class is gone: no timestamp, temp path, pid, session, hash, duration,
    // token count, cost or machine path survives in the golden bytes.
    const forbidden: readonly (readonly [string, RegExp])[] = [
      ["timestamp", /\d{4}-\d{2}-\d{2}/],
      ["temp path", /ai-factory-(?:single|submodules|template)-/],
      ["private path", /\/private\//],
      ["home path", /\/Users\//],
      ["pid", /\bpid \d+/],
      ["session id", /\bses_test_/],
      ["full hash", /\b[0-9a-f]{40,64}\b/],
      ["short hash", /\b[0-9a-f]{12}\b/],
      ["duration", /\b\d+(?:\.\d+)?(?:ms|s)\b/],
      ["token count", /\b\d[\d.,]*[km]?\s+tok(?:en)?s?\b/],
      ["cost", /\$\d/],
    ];
    for (const name of names.filter(
      (entry) => !entry.endsWith(".md") && entry !== "thresholds.json",
    )) {
      const text = readFileSync(join(first, name), "utf8");
      for (const [label, pattern] of forbidden) {
        expect({ name, label, match: pattern.exec(text)?.[0] }).toEqual({
          name,
          label,
          match: undefined,
        });
      }
    }
  }, 180_000);

  test("the normaliser rewrites every volatile class in one pass", () => {
    const root = join(tmpdir(), "ai-factory-single-abc", "app");
    const ctx: NormaliseContext = {
      root,
      base: join(tmpdir(), "ai-factory-single-abc"),
      repoRoot,
    };
    const input = [
      `at ${root} and ${join(homedir(), "code")}`,
      "2026-11-17T10:42:00.000Z",
      "pid 4242",
      "ses_test_7",
      "a".repeat(64),
      "b".repeat(40),
      "c".repeat(12),
      "in 0ms and 1.2s and 2m14s",
      "12.3k tok · $0.42",
      "updated 10:42:00",
      "/usr/local/bin/bun",
      `loomwright ${FACTORY_VERSION} in /tmp/x`,
      `committed 0123456789ab chore(factory): init v${FACTORY_VERSION}`,
      `"factoryVersion": "${FACTORY_VERSION}"`,
    ].join("\n");
    const out = normalise(input, ctx);
    expect(out).toContain("<root>");
    expect(out).toContain("<path>");
    expect(out).toContain("<ts>");
    expect(out).toContain("pid <pid>");
    expect(out).toContain("<session>");
    expect(out).toContain("<sha>");
    expect(out).toContain("<sha12>");
    expect(out).toContain("<duration>");
    expect(out).toContain("<tokens>");
    expect(out).toContain("$<cost>");
    expect(out).toContain("updated <time>");
    expect(out).toContain(`loomwright <version> in`);
    expect(out).toContain("chore(factory): init <version>");
    expect(out).toContain('"factoryVersion": "<version>"');
    expect(out).not.toContain(FACTORY_VERSION);
    expect(out).not.toContain(homedir());
    expect(out).not.toContain("ses_test_");
  });

  test("the goldens are committed and normalised: no factory version survives a release bump", () => {
    for (const name of [
      "single.stdout.txt",
      "submodules.stdout.txt",
      "status.json",
      "status-id.json",
    ]) {
      expect(read(name), name).not.toContain(FACTORY_VERSION);
    }
    expect(read("single.stdout.txt")).toContain("loomwright <version> in <root>");
    expect(read("submodules.stdout.txt")).toContain("chore(factory): init <version>");
    expect(read("status.json")).toContain('"factoryVersion": "<version>"');
    expect(read("status-id.json")).toContain('"factoryVersion": "<version>"');
  });

  test("the normaliser sorts JSON keys so map iteration order cannot drift", () => {
    const ctx: NormaliseContext = { root: "/tmp/x", base: "/tmp", repoRoot };
    expect(normalise('{"b":1,"a":{"d":2,"c":3}}', ctx)).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}',
    );
  });
});

describe("baseline: the status compatibility contract is captured", () => {
  test("the status compatibility contract is captured with the exact top-level keys", () => {
    expect(sortedKeys(json("status.json"), "status.json")).toEqual([...STATUS_KEYS].sort());
    expect(sortedKeys(json("status-id.json"), "status-id.json")).toEqual(
      [...STATUS_BY_ID_KEYS].sort(),
    );
    expect(sortedKeys(json("status-id.json"), "status-id.json")).not.toContain("workspaceUsage");
    const full = objectOf(json("status.json"), "status.json");
    expect(Array.isArray(full.runs)).toBe(true);
    expect(Array.isArray(full.corrupt)).toBe(true);
  });
});

describe("baseline: the print and mutation inventory is recorded", () => {
  test("the print and mutation inventory is recorded with one row per control action", () => {
    const inventory = read("inventory.md");
    verifyInventory(inventory);
    for (const action of CONTROL_ACTIONS) {
      const rows = inventory.split("\n").filter((line) => line.startsWith(`| \`${action}\``));
      expect(rows).toHaveLength(1);
    }
    for (const action of ECHO_ACTIONS) {
      const row = inventory.split("\n").find((line) => line.startsWith(`| \`${action}\``));
      expect(row).toContain("none");
    }
    // The three inventories the later tasks wire into the event stream are present.
    expect(inventory).toContain("## 2. Every `Progress` call site");
    expect(inventory).toContain("## 3. Every `p.out(...)` banner");
    expect(inventory).toContain("## 4. Every run-state mutation");
  });
});

describe("baseline: the test count is fixed before the first edit", () => {
  test("the test count is fixed before the first edit and no later task may lower it", () => {
    const thresholds = verifyThresholds(json("thresholds.json"));
    expect(Number.isInteger(thresholds.testsPassed)).toBe(true);
    expect(thresholds.testsPassed).toBeGreaterThan(0);
    expect(thresholds.testsFailed).toBe(0);
    expect(thresholds.check).toBe("pass");
    expect(thresholds.rule).toContain("No later task may lower");
    const minimums = declaredMinimums();
    for (const [file, minimum] of Object.entries(thresholds.declaredMinimums)) {
      expect(minimums[file]).toBe(minimum);
    }
    expect(minimums["pipeline.test.ts"]).toBe(28);
  });
});
