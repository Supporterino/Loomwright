import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendJsonc, parseJsonc, setJsonc } from "@loomwright/core/config/jsonc";
import { parseConfigText } from "@loomwright/core/config/load";
import { FactoryConfig, type FactoryConfigInput, modelFor } from "@loomwright/core/config/schema";
import { ConfigError } from "@loomwright/core/errors";
import { FACTORY_VERSION, PACKAGE_NAME, runVersion } from "@loomwright/core/version";
import { PONYTAIL } from "@loomwright/core/versions";
import { PROTOCOL_VERSION } from "@loomwright/protocol";
import { cli } from "./helpers.ts";

const MODELS = {
  orchestrator: "anthropic/claude-sonnet-5-5",
  architect: "anthropic/claude-opus-5-5",
  reviewer: "anthropic/claude-opus-5-5",
  implementer: "anthropic/claude-sonnet-5-5",
  tester: "anthropic/claude-sonnet-5-5",
  explorer: "anthropic/claude-haiku-5-5",
};

const submodules = (): FactoryConfigInput => ({
  schemaVersion: 2,
  layout: "submodules",
  repos: [
    { name: "ai", path: ".", role: "orchestration", languages: [] },
    { name: "backend", path: "repos/backend", languages: ["go"], defaultBranch: "main" },
    { name: "frontend", path: "repos/frontend", languages: ["typescript", "react"] },
  ],
  models: MODELS,
  contracts: [
    { kind: "openapi", provider: "backend", path: "api/openapi.yaml", consumers: ["frontend"] },
  ],
  gates: { overrides: { backend: { testAffected: "go test -race {packages}" } } },
});

function issues(input: unknown): string[] {
  const res = FactoryConfig.safeParse(input);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("FactoryConfig schema", () => {
  test("applies documented defaults", () => {
    const cfg = FactoryConfig.parse(submodules());
    expect(cfg.gates.maxRetries).toBe(3);
    expect(cfg.gates.scripts.testAffected).toBe("test:affected");
    expect(cfg.parallel).toEqual({ maxAgents: 4, maxGateProcesses: 2, withinRepo: "worktrees" });
    expect(cfg.tokens).toEqual({
      mode: "report",
      contextPackMaxTokens: 8000,
      gateOutputMaxLines: 80,
    });
    expect(cfg.addons.ponytail).toEqual({
      enabled: true,
      ref: `${PONYTAIL.tag}@${PONYTAIL.commit}`,
      roles: ["implementer", "reviewer"],
      level: "full",
      shortcutComments: "report",
    });
    expect(cfg.logs).toEqual({ retentionDays: 14, redact: true });
    expect(cfg.artifacts).toEqual({ mode: "local", reports: true, approvals: true, usage: true });
    expect(cfg.graph.exclude).toContain("graphify-out/**");
    expect(cfg.repos[1]?.role).toBe("code");
    expect(cfg.unmanaged).toEqual([]);
  });

  test("contractReviewer falls back to reviewer", () => {
    const cfg = FactoryConfig.parse(submodules());
    expect(modelFor(cfg, "contractReviewer")).toBe(MODELS.reviewer);
    expect(
      modelFor(
        FactoryConfig.parse({ ...submodules(), models: { ...MODELS, contractReviewer: "x/y" } }),
        "contractReviewer",
      ),
    ).toBe("x/y");
  });

  test("rejects unknown keys and bad values", () => {
    expect(issues({ ...submodules(), extra: 1 })).toEqual([': Unrecognized key: "extra"']);
    expect(issues({ ...submodules(), schemaVersion: 5 })[0]).toStartWith("schemaVersion:");
    expect(issues({ ...submodules(), models: { ...MODELS, implementer: "sonnet" } })).toEqual([
      'models.implementer: expected "provider/model"',
    ]);
    const badLang = submodules();
    badLang.repos[1] = { name: "backend", path: "repos/backend", languages: ["cobol" as "go"] };
    expect(issues(badLang)[0]).toStartWith("repos.1.languages.0:");
  });

  test("rejects paths that escape the workspace", () => {
    for (const path of ["../x", "/abs", "a/../../b", "a\\b"]) {
      const cfg = submodules();
      cfg.repos[1] = { name: "backend", path, languages: ["go"] };
      expect(issues(cfg).some((i) => i.startsWith("repos.1.path:"))).toBe(true);
    }
  });

  test("cross-field rules", () => {
    const dupe = submodules();
    dupe.repos.push({ name: "backend", path: "repos/b2", languages: [] });
    expect(issues(dupe)).toContain('repos.3.name: duplicate repo name "backend"');

    const noOrch = submodules();
    noOrch.repos[0] = { name: "ai", path: ".", languages: [] };
    expect(issues(noOrch)).toContain(
      'repos: submodules layout needs exactly one "orchestration" repo with path "."',
    );

    const badContract = submodules();
    badContract.contracts = [
      { kind: "openapi", provider: "ai", path: "x.yaml", consumers: ["backend", "nope"] },
    ];
    expect(issues(badContract)).toEqual([
      'contracts.0.provider: unknown code repo "ai"',
      'contracts.0.consumers.1: unknown code repo "nope"',
    ]);

    const selfConsumer = submodules();
    selfConsumer.contracts = [
      { kind: "openapi", provider: "backend", path: "x.yaml", consumers: ["backend"] },
    ];
    expect(issues(selfConsumer)).toEqual([
      "contracts.0.consumers.0: a provider cannot consume its own contract",
    ]);

    const badOverride = submodules();
    badOverride.gates = { overrides: { ghost: { lint: "x" } } };
    expect(issues(badOverride)).toEqual(['gates.overrides.ghost: unknown code repo "ghost"']);
  });

  test("single layout needs exactly one code repo at '.'", () => {
    const single: FactoryConfigInput = {
      schemaVersion: 2,
      layout: "single",
      repos: [{ name: "app", path: ".", languages: ["typescript"] }],
      models: MODELS,
    };
    expect(issues(single)).toEqual([]);
    expect(issues({ ...single, repos: [{ name: "app", path: "sub", languages: [] }] })).toEqual([
      'repos: single layout needs exactly one repo with path "."',
    ]);
    expect(
      issues({
        ...single,
        repos: [{ name: "app", path: ".", role: "orchestration", languages: [] }],
      }),
    ).toEqual(['repos: single layout has no "orchestration" repo']);
  });
});

describe("JSONC config text", () => {
  const TEXT = `{
  // Layout of the workspace
  "schemaVersion": 2,
  "layout": "single", /* detected */
  "repos": [
    { "name": "app", "path": ".", "languages": ["typescript"] }, // the only repo
  ],
  "models": ${JSON.stringify(MODELS)},
}
`;

  test("parses comments and trailing commas", () => {
    expect(parseConfigText(TEXT, "factory.config.jsonc").repos[0]?.name).toBe("app");
  });

  test("reports syntax errors with line and column", () => {
    try {
      parseConfigText('{\n  "layout": "single"\n  "x": 1\n}', "f.jsonc");
      throw new Error("expected a ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).details).toEqual(["3:3 CommaExpected"]);
    }
  });

  test("reports schema errors per field", () => {
    expect(() => parseConfigText('{"schemaVersion": 2}', "f.jsonc")).toThrow(ConfigError);
  });

  test("targeted edits keep comments", () => {
    let out = setJsonc(TEXT, ["repos", 0, "languages"], ["typescript", "react"]);
    out = appendJsonc(out, ["repos"], { name: "lib", path: "lib", languages: [] });
    expect(out).toContain("// Layout of the workspace");
    expect(out).toContain("/* detected */");
    expect(out).toContain("// the only repo");
    expect(parseJsonc(out).value).toMatchObject({
      repos: [{ languages: ["typescript", "react"] }, { name: "lib" }],
    });
  });
});

interface PackageJson {
  name: string;
  version?: string;
  description?: string;
  private?: boolean;
  workspaces?: string[];
  bin?: Record<string, string>;
  files?: string[];
  engines?: Record<string, string>;
  publishConfig?: { access: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  repository?: { url: string };
  homepage?: string;
  bugs?: { url: string };
  exports?: Record<string, string>;
}

const readManifest = (path: string): PackageJson =>
  // Parsed repository metadata, shaped as the spec pins it.
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as PackageJson;

const packageJson = (): PackageJson => readManifest("../packages/cli/package.json");
const rootPackageJson = (): PackageJson => readManifest("../package.json");

test("package metadata exposes both binaries and PACKAGE_NAME matches package.json", () => {
  const pkg = packageJson();
  expect(pkg.version).toBe(FACTORY_VERSION);
  expect(pkg.name).toBe(PACKAGE_NAME);
  expect(pkg.name).toBe("@loomwright/cli");
  expect(pkg.bin).toEqual({
    loomwright: "./dist/cli.js",
    "ai-factory": "./dist/cli.js",
  });
  expect(pkg.description ?? "").toContain("Loomwright");
});

test("the deprecated alias keeps existing scripts working", () => {
  const pkg = packageJson();
  expect(pkg.bin?.["ai-factory"]).toBe(pkg.bin?.loomwright);
  expect(Object.keys(pkg.bin ?? {})).toEqual(["loomwright", "ai-factory"]);
});

test("runVersion names the new package", () => {
  expect(runVersion("1.2.3")).toBe("npx @loomwright/cli@1.2.3");
});

test("the version flag prints only the version", async () => {
  const res = await cli(process.cwd(), "--version");
  expect(res.out).toBe(FACTORY_VERSION);
  expect(res.out).not.toContain("Loomwright");
  expect(res.out).not.toContain("ai-factory");
});

test("the repository URLs point at the Loomwright repository", () => {
  const pkg = packageJson();
  expect(pkg.repository?.url).toBe("git+https://github.com/Supporterino/Loomwright.git");
  expect(pkg.homepage).toBe("https://github.com/Supporterino/Loomwright#readme");
  expect(pkg.bugs?.url).toBe("https://github.com/Supporterino/Loomwright/issues");
});

test("the root manifest declares the workspaces and publishes nothing", () => {
  const pkg = rootPackageJson();
  expect(pkg.private).toBe(true);
  expect(pkg.workspaces).toEqual(["packages/*"]);
  expect(pkg).not.toHaveProperty("bin");
  expect(pkg).not.toHaveProperty("files");
  expect(pkg).not.toHaveProperty("publishConfig");
});

test("the root manifest keeps the root scripts and devDependencies", () => {
  const pkg = rootPackageJson();
  expect(pkg.scripts?.build).toBeDefined();
  expect(pkg.scripts?.check).toBeDefined();
  expect(pkg.scripts?.test).toBe("bun test --timeout 60000 --parallel");
  expect(pkg.devDependencies?.typescript).toBeDefined();
  expect(pkg.devDependencies?.["@types/bun"]).toBeDefined();
  expect(pkg.devDependencies?.["@loomwright/core"]).toBe("workspace:*");
  expect(pkg.devDependencies?.["@loomwright/protocol"]).toBe("workspace:*");
});

test("the bundle entry is unchanged", () => {
  const pkg = rootPackageJson();
  expect(pkg.scripts?.build).toContain("packages/cli/src/bin.ts");
  expect(pkg.scripts?.build).toContain("packages/cli/dist/cli.js");
  expect(pkg.scripts?.dev).toBe("bun packages/cli/src/bin.ts");
});

test("the three package identities are correct", () => {
  const protocol = readManifest("../packages/protocol/package.json");
  const core = readManifest("../packages/core/package.json");
  const cli = packageJson();
  expect([protocol.name, core.name, cli.name]).toEqual([
    "@loomwright/protocol",
    "@loomwright/core",
    "@loomwright/cli",
  ]);
  expect(protocol.private).toBe(true);
  expect(core.private).toBe(true);
  expect(cli.private).toBeUndefined();
  expect(cli.version).toBe(FACTORY_VERSION);
});

const MODULE_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;

function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function protocolSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...protocolSources(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("protocol stays a leaf package: version 1 and no engine imports", () => {
  expect(PROTOCOL_VERSION).toBe(1);
  const srcDir = fileURLToPath(new URL("../packages/protocol/src/", import.meta.url));
  const files = protocolSources(srcDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const resolved = resolve(dirname(file), specifier);
        expect(relative(srcDir, resolved).startsWith("..")).toBe(false);
      } else {
        // The protocol leaf may import zod and nothing else.
        expect(specifier).toBe("zod");
      }
    }
  }
});

test("core exposes subpath exports", () => {
  const core = readManifest("../packages/core/package.json");
  expect(core.exports?.["./*"]).toBe("./src/*.ts");
  expect(core.exports?.["."]).toBeUndefined();
  // `@loomwright/core/policy/permissions` resolves straight to its module; no barrel is needed.
  expect(existsSync(new URL("../packages/core/src/index.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../packages/core/src/policy/permissions.ts", import.meta.url))).toBe(
    true,
  );
});

test("the published CLI identity is unchanged", () => {
  const pkg = packageJson();
  expect(pkg.bin).toEqual({
    loomwright: "./dist/cli.js",
    "ai-factory": "./dist/cli.js",
  });
  expect(pkg.files).toEqual([
    "dist",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "templates/addons/ponytail/LICENSE",
  ]);
  expect(pkg.engines).toEqual({ node: ">=20.3", bun: ">=1.3.0" });
  expect(pkg.publishConfig).toEqual({ access: "public" });
  expect(pkg.dependencies?.["@loomwright/core"]).toBeUndefined();
  expect(pkg.dependencies?.["@loomwright/protocol"]).toBeUndefined();
});

test("Changesets sees package changes", () => {
  const config = JSON.parse(
    readFileSync(new URL("../.changeset/config.json", import.meta.url), "utf8"),
  ) as { changedFilePatterns?: string[] };
  expect(config.changedFilePatterns).toContain("packages/**");
  // Private packages cannot be published, so a bump only touches the CLI package.
  expect(readManifest("../packages/core/package.json").private).toBe(true);
  expect(readManifest("../packages/protocol/package.json").private).toBe(true);
  expect(readManifest("../packages/cli/package.json").private).toBeUndefined();
});

test("the published manifest does not own the gates", () => {
  const pkg = packageJson();
  expect(pkg.scripts?.["format:check"]).toBeUndefined();
  expect(pkg.scripts?.lint).toBeUndefined();
  expect(pkg.scripts?.typecheck).toBeUndefined();
  expect(pkg.scripts?.test).toBeUndefined();
});

test("gate scripts keep their exact definitions", () => {
  const pkg = rootPackageJson();
  expect(pkg.scripts?.["format:check"]).toBe("biome format .");
  expect(pkg.scripts?.lint).toBe("biome check .");
  expect(pkg.scripts?.typecheck).toBe("tsc --noEmit");
  expect(pkg.scripts?.test).toBe("bun test --timeout 60000 --parallel");
  expect(pkg.scripts?.["test:serial"]).toBe("bun test --timeout 60000");
});

test("no new retention knob is added", () => {
  const config = parseConfigText(
    readFileSync(new URL("../factory.config.jsonc", import.meta.url), "utf8"),
    "factory.config.jsonc",
  );
  expect(Object.keys(config.logs).sort()).toEqual(["redact", "retentionDays"]);
  expect(Object.keys(config)).not.toContain("events");

  const schema = readFileSync(
    new URL("../packages/core/src/config/schema.ts", import.meta.url),
    "utf8",
  );
  // The only retention setting is the log tree's; the event log follows it, never a new knob.
  expect(schema.match(/retentionDays/g)?.length).toBe(1);
  expect(schema).not.toMatch(/events\s*:/);
});

test("protected configuration is checked for moved paths", () => {
  const text = readFileSync(new URL("../factory.config.jsonc", import.meta.url), "utf8");
  const config = parseConfigText(text, "factory.config.jsonc");
  // No instructions point at the removed root `src/`; nothing in the file needs an edit.
  expect(config.instructions.workspace).toEqual([]);
  expect(config.instructions.repos).toEqual({});
  expect(config.graph.exclude).toContain("**/dist/**");
  expect(config.gates.overrides).toEqual({});
});
