import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, posix, relative, sep } from "node:path";

export interface ImportEdge {
  /** Repo-relative POSIX path. */
  file: string;
  specifier: string;
}

export interface Violation {
  file: string;
  specifier: string;
  rule: string;
  message: string;
}

type PackageName = "cli" | "core" | "protocol";

const repoRoot = join(import.meta.dir, "..");
const skippedDirectories = new Set(["node_modules", "dist", "graphify-out"]);
// Test files at the 1.1 baseline: the move keeps them all and adds this suite.
const BASELINE_TEST_FILES = 52;
// Declarations per test file at the same baseline: a moved file keeps its cases.
// Keyed by basename because the move changes directories; renaming a file updates its row.
const BASELINE_TEST_CASES: Record<string, number> = {
  "adopt.test.ts": 9,
  "artifacts.test.ts": 6,
  "auth-sync.test.ts": 9,
  "clarify.test.ts": 8,
  "cli-usage.test.ts": 3,
  "completion.test.ts": 13,
  "config.test.ts": 16,
  "context-v3.test.ts": 13,
  "contract-gate.test.ts": 6,
  "contracts.test.ts": 8,
  "detect-command.test.ts": 10,
  "detect-units.test.ts": 6,
  "detect.test.ts": 4,
  "docs.test.ts": 10,
  "doctor.test.ts": 8,
  "gaps.test.ts": 5,
  "gates-extra.test.ts": 4,
  "gates-resolve.test.ts": 21,
  "gates-run.test.ts": 12,
  "git.test.ts": 14,
  "graph.test.ts": 6,
  "handoff.test.ts": 3,
  "hardening.test.ts": 5,
  "hooks.test.ts": 5,
  "init.test.ts": 17,
  "land.test.ts": 7,
  "managed.test.ts": 2,
  "opencode-activity.test.ts": 1,
  "opencode-runtime.e2e.test.ts": 2,
  "opencode-runtime.test.ts": 2,
  "pipeline.test.ts": 28,
  "plugin.test.ts": 21,
  "policy-lists.test.ts": 7,
  "policy-lockfiles.test.ts": 11,
  "ponytail.test.ts": 14,
  "progress.test.ts": 9,
  "quick.test.ts": 3,
  "rate-limit.test.ts": 4,
  "rebrand.test.ts": 8,
  "release-notes.test.ts": 3,
  "release-scripts.test.ts": 6,
  "render.test.ts": 12,
  "review-loop.test.ts": 6,
  "reword.test.ts": 11,
  "sandbox.test.ts": 5,
  "scheduler.test.ts": 22,
  "shell-policy.test.ts": 6,
  "state-commands.test.ts": 6,
  "tasks.test.ts": 10,
  "update.test.ts": 12,
  "usage.test.ts": 3,
  "workspace-usage.test.ts": 9,
};
const TEST_DECLARATION = /^\s*(?:test|it)(?:\.(?:each|skip|only|todo|concurrent|failing))*\s*\(/gm;

function declaredTests(source: string): number {
  return source.match(TEST_DECLARATION)?.length ?? 0;
}

function toRepoPath(absolute: string): string {
  return relative(repoRoot, absolute).split(sep).join("/");
}

function packageOf(file: string): PackageName | undefined {
  const match = /^packages\/([^/]+)\//.exec(file);
  const name = match?.[1];
  if (name === "cli" || name === "core" || name === "protocol") return name;
  return undefined;
}

function ownedPackage(specifier: string): PackageName | undefined {
  const match = /^@loomwright\/(cli|core|protocol)(?:\/|$)/.exec(specifier);
  const name = match?.[1];
  if (name === "cli" || name === "core" || name === "protocol") return name;
  return undefined;
}

function isTestFile(file: string): boolean {
  return /^packages\/[^/]+\/test\//.test(file);
}

/** Text assets under root `templates/` that packages may import across the boundary. */
function isTemplateTextAsset(resolved: string): boolean {
  if (!resolved.startsWith("templates/")) return false;
  // The ponytail add-on ships its license as a text asset without an extension.
  if (posix.basename(resolved) === "LICENSE") return true;
  const extension = posix.extname(resolved).toLowerCase();
  return extension === ".md" || extension === ".txt";
}

/** Shared root `test/` support a package test may import: setup, helpers and fixtures. */
function isRootTestSupport(resolved: string): boolean {
  return (
    resolved === "test/setup.ts" ||
    resolved === "test/helpers.ts" ||
    resolved.startsWith("test/fixtures/")
  );
}

function forbiddenRule(from: PackageName, to: PackageName): string | undefined {
  if (from === to) return undefined;
  switch (from) {
    case "cli":
      return to === "protocol" ? "cli-to-protocol" : undefined;
    case "core":
      return to === "cli" ? "core-to-cli" : undefined;
    case "protocol":
      return `protocol-to-${to}`;
    default: {
      const unhandled: never = from;
      throw new Error(`unhandled package: ${String(unhandled)}`);
    }
  }
}

/** Extracts every static or dynamic module specifier from a source file. */
export function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

/** Pure dependency-rule checker: cli → core → protocol, no relative escapes. */
export function checkImports(files: readonly ImportEdge[]): Violation[] {
  const violations: Violation[] = [];
  for (const { file, specifier } of files) {
    const from = packageOf(file);
    if (from === undefined) continue;

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
      const insidePackage = resolved.startsWith(`packages/${from}/`);
      const rootTemplates = isTemplateTextAsset(resolved);
      // Shared fixtures and setup stay at the root, so package tests may reach those only.
      const rootTestAssets = isTestFile(file) && isRootTestSupport(resolved);
      if (insidePackage || rootTemplates || rootTestAssets) continue;
      violations.push({
        file,
        specifier,
        rule: "escape",
        message: `${file} imports ${specifier}, which resolves outside packages/${from}/`,
      });
      continue;
    }

    const to = ownedPackage(specifier);
    if (to === undefined) continue;
    const rule = forbiddenRule(from, to);
    if (rule === undefined) continue;
    violations.push({
      file,
      specifier,
      rule,
      message: `${file} imports ${specifier}: ${from} may not depend on ${to}`,
    });
  }
  return violations;
}

function typescriptFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      typescriptFiles(path, found);
    } else if (entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

function edgesOf(files: readonly string[]): ImportEdge[] {
  return files.flatMap((absolute) => {
    const file = toRepoPath(absolute);
    const source = readFileSync(absolute, "utf8");
    return importSpecifiers(source).map((specifier) => ({ file, specifier }));
  });
}

describe("dependency rule", () => {
  test("allowed edges are accepted", () => {
    const edges: ImportEdge[] = [
      { file: "packages/cli/src/main.ts", specifier: "@loomwright/core/policy" },
      { file: "packages/core/src/runtime/opencode.ts", specifier: "@loomwright/protocol" },
    ];
    expect(checkImports(edges)).toEqual([]);
  });

  test("core importing cli is rejected", () => {
    const violations = checkImports([
      { file: "packages/core/src/x.ts", specifier: "@loomwright/cli/main" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["core-to-cli"]);
  });

  test("protocol importing core is rejected", () => {
    const violations = checkImports([
      { file: "packages/protocol/src/index.ts", specifier: "@loomwright/core/errors" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["protocol-to-core"]);
  });

  test("cli importing protocol directly is rejected", () => {
    const violations = checkImports([
      { file: "packages/cli/src/x.ts", specifier: "@loomwright/protocol" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["cli-to-protocol"]);
  });

  test("a relative import that escapes its package is rejected", () => {
    const violations = checkImports([
      { file: "packages/core/src/x.ts", specifier: "../../../cli/src/main.ts" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["escape"]);
  });

  test("root templates text imports are allowed", () => {
    const edges: ImportEdge[] = [
      {
        file: "packages/core/src/render/workspace.ts",
        specifier: "../../../../templates/agents/architect.md",
      },
    ];
    expect(checkImports(edges)).toEqual([]);
  });

  test("a non-text import from root templates is rejected", () => {
    const violations = checkImports([
      { file: "packages/core/src/x.ts", specifier: "../../../templates/x.ts" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["escape"]);
  });

  test("package tests may reach the shared root test support", () => {
    const allowed = checkImports([
      {
        file: "packages/cli/test/completion.test.ts",
        specifier: "../../../test/fixtures/workspaces.ts",
      },
    ]);
    expect(allowed).toEqual([]);

    const escaped = checkImports([
      {
        file: "packages/cli/src/completion.ts",
        specifier: "../../../test/fixtures/workspaces.ts",
      },
    ]);
    expect(escaped.map((violation) => violation.rule)).toEqual(["escape"]);
  });

  test("package tests may not reach another root suite", () => {
    const violations = checkImports([
      { file: "packages/cli/test/x.test.ts", specifier: "../../../test/docs.test.ts" },
    ]);
    expect(violations.map((violation) => violation.rule)).toEqual(["escape"]);
  });

  test("the real tree obeys the rule", () => {
    const edges = edgesOf(typescriptFiles(join(repoRoot, "packages")));
    expect(checkImports(edges)).toEqual([]);
  });
});

describe("tests follow the packages", () => {
  test("moved tests sit with their package", () => {
    for (const file of [
      "packages/core/test/tasks.test.ts",
      "packages/core/test/gates-resolve.test.ts",
      "packages/cli/test/cli-usage.test.ts",
      "packages/cli/test/completion.test.ts",
    ]) {
      expect(existsSync(join(repoRoot, file))).toBe(true);
    }
    expect(existsSync(join(repoRoot, "src"))).toBe(false);
  });

  test("shared fixtures and setup stay at the root", () => {
    for (const file of ["test/setup.ts", "test/helpers.ts", "test/fixtures/workspaces.ts"]) {
      expect(existsSync(join(repoRoot, file))).toBe(true);
    }
    expect(readFileSync(join(repoRoot, "bunfig.toml"), "utf8")).toContain(
      'preload = ["./test/setup.ts"]',
    );
    const testFiles = [
      ...typescriptFiles(join(repoRoot, "test")),
      ...typescriptFiles(join(repoRoot, "packages")),
    ].filter((file) => file.endsWith(".test.ts"));
    expect(testFiles.length).toBeGreaterThanOrEqual(BASELINE_TEST_FILES);

    const declared = new Map<string, number>();
    for (const file of testFiles) {
      declared.set(basename(file), declaredTests(readFileSync(file, "utf8")));
    }
    const shortfalls = Object.entries(BASELINE_TEST_CASES)
      .filter(([file, minimum]) => (declared.get(file) ?? 0) < minimum)
      .map(([file, minimum]) => `${file}: ${declared.get(file) ?? 0} < ${minimum}`);
    expect(shortfalls).toEqual([]);

    const baselineTotal = Object.values(BASELINE_TEST_CASES).reduce((sum, n) => sum + n, 0);
    const total = [...declared.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThanOrEqual(baselineTotal);
  });
});
