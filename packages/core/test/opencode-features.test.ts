import { describe, expect, test } from "bun:test";
import {
  enabledOpencodeFeatures,
  OPENCODE_FEATURES,
  opencodeRequirement,
} from "../src/opencode-features.ts";
import { compareVersions } from "../src/tools.ts";
import { OPENCODE } from "../src/versions.ts";

describe("opencode base range", () => {
  test("the base range accepts every 2.x minor and stops at 3.0.0", () => {
    expect(OPENCODE).toEqual({
      min: "2.1.2",
      maxExclusive: "3.0.0",
      tested: "2.2.0",
      npmCli: "@opencode/cli",
    });
  });
});

describe("OPENCODE_FEATURES", () => {
  test("mcp.roles declares 2.2.0", () => {
    expect(OPENCODE_FEATURES["mcp.roles"].min).toBe("2.2.0");
    expect(OPENCODE_FEATURES["mcp.roles"].why).toMatch(/direct MCP\/plugin tool exposure/);
  });

  test("no feature asks for an unverified minor", () => {
    for (const feature of Object.values(OPENCODE_FEATURES)) {
      expect(compareVersions(feature.min, OPENCODE.min)).toBeGreaterThanOrEqual(0);
      expect(compareVersions(feature.min, OPENCODE.tested)).toBeLessThanOrEqual(0);
    }
  });
});

describe("opencodeRequirement", () => {
  test("an empty mcp.roles keeps the base floor", () => {
    expect(opencodeRequirement({ mcp: { roles: {} } })).toBeUndefined();
  });

  test("one role with a pattern needs 2.2.0", () => {
    const requirement = opencodeRequirement({
      mcp: { roles: { implementer: ["mantine_*"] } },
    });
    expect(requirement?.min).toBe("2.2.0");
    expect(requirement?.reason).toContain("mcp.roles");
    expect(requirement?.reason).toContain("2.2.0");
  });

  test("an empty pattern list does not enable the feature", () => {
    expect(opencodeRequirement({ mcp: { roles: { implementer: [] } } })).toBeUndefined();
  });
});

describe("enabledOpencodeFeatures", () => {
  test("an empty role map enables nothing", () => {
    expect(enabledOpencodeFeatures({ mcp: { roles: {} } })).toEqual([]);
  });

  test("a non-empty pattern list enables mcp.roles", () => {
    expect(enabledOpencodeFeatures({ mcp: { roles: { implementer: ["mantine_*"] } } })).toEqual([
      "mcp.roles",
    ]);
  });

  test("an empty pattern list enables nothing", () => {
    expect(enabledOpencodeFeatures({ mcp: { roles: { implementer: [] } } })).toEqual([]);
  });
});
