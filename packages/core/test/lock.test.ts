import { describe, expect, test } from "bun:test";
import { buildLock, LOCK_VERSION, type LockEntry } from "../src/lock/lock.ts";
import { opencodeRequirement } from "../src/opencode-features.ts";
import { OPENCODE, OPENSPEC } from "../src/versions.ts";

function entry(template: string): LockEntry {
  return {
    template,
    templateVersion: "1.0.0",
    mode: "file",
    sha256: "a".repeat(64),
    blob: "b".repeat(40),
  };
}

/** The expression `syncWorkspace` passes as the third argument. */
function effectiveFloor(roles: Record<string, string[]>): string {
  return opencodeRequirement({ mcp: { roles } })?.min ?? OPENCODE.min;
}

describe("buildLock opencode pin", () => {
  test("the lock records the base range", () => {
    const lock = buildLock({});
    expect(lock.tools.opencode).toEqual({
      min: "2.1.2",
      maxExclusive: "3.0.0",
      tested: "2.2.0",
    });
    expect(buildLock({}, {}).tools.opencode).toEqual(lock.tools.opencode);
    expect(lock.lockVersion).toBe(LOCK_VERSION);
  });

  test("the lock records the effective floor", () => {
    const enabled = buildLock({}, {}, effectiveFloor({ implementer: ["mantine_*"] }));
    expect(enabled.tools.opencode.min).toBe("2.2.0");
    const disabled = buildLock({}, {}, effectiveFloor({}));
    expect(disabled.tools.opencode.min).toBe("2.1.2");
  });

  test("an empty mcp.roles keeps the base floor", () => {
    const lock = buildLock({}, {}, effectiveFloor({ implementer: [] }));
    expect(lock.tools.opencode).toEqual({
      min: "2.1.2",
      maxExclusive: "3.0.0",
      tested: "2.2.0",
    });
  });

  test("an overridden opencode floor keeps the ceiling and tested pin", () => {
    expect(buildLock({}, {}, "2.2.0").tools.opencode).toEqual({
      min: "2.2.0",
      maxExclusive: "3.0.0",
      tested: "2.2.0",
    });
    // Not special-cased: the base floor passed explicitly equals the default.
    expect(buildLock({}, {}, "2.1.2").tools.opencode).toEqual(buildLock({}).tools.opencode);
  });

  test("the other pins keep their version-range shape", () => {
    const lock = buildLock({}, {}, "2.2.0");
    expect(lock.tools.git).toEqual({ min: "2.31.0", tested: "2.54.0" });
    expect(lock.tools.openspec).toEqual({
      min: OPENSPEC.min,
      maxExclusive: OPENSPEC.maxExclusive,
      tested: OPENSPEC.tested,
    });
    expect(lock.tools.graphify).toEqual({
      min: "0.9.93",
      maxExclusive: "0.10.0",
      tested: "0.9.93",
    });
  });
});

describe("buildLock addons and managed entries", () => {
  test("addons are unaffected by the opencode floor", () => {
    expect(buildLock({}, {}, "2.2.0").addons).toEqual({});
  });

  test("the managed map is sorted by key", () => {
    const lock = buildLock({ b: entry("b"), a: entry("a"), c: entry("c") });
    expect(Object.keys(lock.managed)).toEqual(["a", "b", "c"]);
  });
});
