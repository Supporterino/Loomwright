import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolRequirement, ToolStatus } from "../src/tools.ts";
import { checkTool, checkTools, TOOL_SPECS } from "../src/tools.ts";

const VERSIONS = ["2.1.1", "2.1.2", "2.2.0", "2.2.7", "2.3.0", "2.99.0", "3.0.0"] as const;

const ROLES: ToolRequirement = {
  min: "2.2.0",
  reason: "mcp.roles needs opencode >= 2.2.0: direct MCP/plugin tool exposure",
};

/** `checkTool` against a stub that prints `opencode v<version>`, with the env override restored. */
describe("checkTool opencode version gates", () => {
  const saved = process.env.AI_FACTORY_OPENCODE_BIN;
  const stubs = new Map<string, string>();
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "factory-tools-"));
    for (const version of VERSIONS) {
      const script = join(root, `opencode-${version}.sh`);
      writeFileSync(script, `#!/bin/sh\necho "opencode v${version}"\n`);
      chmodSync(script, 0o755);
      stubs.set(version, script);
    }
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.AI_FACTORY_OPENCODE_BIN;
    else process.env.AI_FACTORY_OPENCODE_BIN = saved;
    rmSync(root, { recursive: true, force: true });
  });

  function stub(version: string): string {
    const script = stubs.get(version);
    if (script === undefined) throw new Error(`no stub for opencode ${version}`);
    return script;
  }

  async function check(version: string, requirement?: ToolRequirement): Promise<ToolStatus> {
    process.env.AI_FACTORY_OPENCODE_BIN = stub(version);
    try {
      return await checkTool("opencode", root, requirement);
    } finally {
      if (saved === undefined) delete process.env.AI_FACTORY_OPENCODE_BIN;
      else process.env.AI_FACTORY_OPENCODE_BIN = saved;
    }
  }

  async function checkAll(
    version: string,
    requirements?: Partial<Record<"opencode", ToolRequirement>>,
  ): Promise<ToolStatus[]> {
    process.env.AI_FACTORY_OPENCODE_BIN = stub(version);
    try {
      return requirements === undefined
        ? await checkTools(["opencode"], root)
        : await checkTools(["opencode"], root, requirements);
    } finally {
      if (saved === undefined) delete process.env.AI_FACTORY_OPENCODE_BIN;
      else process.env.AI_FACTORY_OPENCODE_BIN = saved;
    }
  }

  test("the floor is still 2.1.2", async () => {
    expect(await check("2.1.2")).toEqual({ tool: "opencode", ok: true, version: "2.1.2" });
  });

  test("every 2.x minor is accepted", async () => {
    for (const version of ["2.2.0", "2.2.7", "2.3.0", "2.99.0"]) {
      expect(await check(version)).toEqual({ tool: "opencode", ok: true, version });
    }
  });

  test("a version below the floor is rejected", async () => {
    const status = await check("2.1.1");
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("2.1.1 < 2.1.2");
    expect(status.fix).toContain("@opencode/cli@2.2.0");
  });

  test("3.0.0 is the next breaking gate", async () => {
    const status = await check("3.0.0");
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("newer than supported");
    expect(status.problem).toContain("< 3.0.0");
  });

  test("doctor fails an unmet feature floor and the problem names the feature", async () => {
    const status = await check("2.1.2", ROLES);
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("2.1.2 < 2.2.0");
    expect(status.problem).toContain("mcp.roles");
  });

  test("init refuses an opencode below a feature floor but accepts the inclusive floor", async () => {
    expect(await check("2.2.0", ROLES)).toEqual({
      tool: "opencode",
      ok: true,
      version: "2.2.0",
    });
  });

  test("a ceiling rejection appends no feature reason", async () => {
    const status = await check("3.0.0", ROLES);
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("< 3.0.0");
    expect(status.problem).not.toContain("mcp.roles");
  });

  test("checkTools maps requirements by tool name", async () => {
    const withRequirement = await checkAll("2.1.2", { opencode: ROLES });
    expect(withRequirement).toHaveLength(1);
    const status = withRequirement[0];
    if (status === undefined || status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("2.1.2 < 2.2.0");
    expect(await checkAll("2.1.2")).toEqual([{ tool: "opencode", ok: true, version: "2.1.2" }]);
  });
});

const OPENSPEC_VERSIONS = ["1.14.3", "2.2.0", "2.99.0", "3.0.0"] as const;

/** `checkTool` against a stub that prints `openspec <version>`, with the env override restored. */
describe("checkTool openspec version gates", () => {
  // test/setup.ts pins this to the real devDependency; restore that exact value, never delete it.
  const saved = process.env.AI_FACTORY_OPENSPEC_BIN;
  const stubs = new Map<string, string>();
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "factory-openspec-"));
    for (const version of OPENSPEC_VERSIONS) {
      const script = join(root, `openspec-${version}.sh`);
      writeFileSync(script, `#!/bin/sh\necho "openspec ${version}"\n`);
      chmodSync(script, 0o755);
      stubs.set(version, script);
    }
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.AI_FACTORY_OPENSPEC_BIN;
    else process.env.AI_FACTORY_OPENSPEC_BIN = saved;
    rmSync(root, { recursive: true, force: true });
  });

  function stub(version: string): string {
    const script = stubs.get(version);
    if (script === undefined) throw new Error(`no stub for openspec ${version}`);
    return script;
  }

  async function check(version: string): Promise<ToolStatus> {
    process.env.AI_FACTORY_OPENSPEC_BIN = stub(version);
    try {
      return await checkTool("openspec", root);
    } finally {
      if (saved === undefined) delete process.env.AI_FACTORY_OPENSPEC_BIN;
      else process.env.AI_FACTORY_OPENSPEC_BIN = saved;
    }
  }

  test("a 2.x install is accepted", async () => {
    expect(await check("2.2.0")).toEqual({ tool: "openspec", ok: true, version: "2.2.0" });
    expect(await check("2.99.0")).toEqual({ tool: "openspec", ok: true, version: "2.99.0" });
  });

  test("3.0.0 is the next breaking gate", async () => {
    const status = await check("3.0.0");
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("expected a rejection");
    expect(status.problem).toContain("newer than supported");
    expect(status.problem).toContain("< 3.0.0");
  });

  test("a 1.x install still passes", async () => {
    expect(await check("1.14.3")).toEqual({ tool: "openspec", ok: true, version: "1.14.3" });
  });

  test("the install hint names the tested pin", () => {
    expect(TOOL_SPECS.openspec.install).toBe("npm install --global @fission-ai/openspec@2.2.0");
  });
});
