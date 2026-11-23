import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection } from "../scripts/changelog-section.ts";
import { checkTarball } from "../scripts/check-tarball.ts";
import { syncVersionText } from "../scripts/sync-version.ts";

const CI_WORKFLOW = readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
const RELEASE_WORKFLOW = readFileSync(
  join(import.meta.dir, "../.github/workflows/release.yml"),
  "utf8",
);
const E2E_WORKFLOW = readFileSync(join(import.meta.dir, "../.github/workflows/e2e.yml"), "utf8");

const CHANGELOG = `# Changelog

## 0.3.0

### Minor Changes

- Add a thing.

## 0.2.0

### Added

- Older thing.
`;

describe("release scripts", () => {
  test("changelogSection returns the section without its heading", () => {
    expect(changelogSection(CHANGELOG, "0.3.0")).toBe("### Minor Changes\n\n- Add a thing.");
    expect(changelogSection(CHANGELOG, "0.2.0")).toBe("### Added\n\n- Older thing.");
  });

  test("changelogSection rejects missing and empty sections", () => {
    expect(() => changelogSection(CHANGELOG, "9.9.9")).toThrow("no section");
    expect(() => changelogSection("## 1.0.0\n\n## 0.9.0\n", "1.0.0")).toThrow("is empty");
  });

  test("syncVersionText rewrites only FACTORY_VERSION", () => {
    const source = `/** Version. */\nexport const FACTORY_VERSION = "0.2.0";\nexport const NAME = "0.2.0";\n`;
    expect(syncVersionText(source, "0.3.0")).toBe(
      `/** Version. */\nexport const FACTORY_VERSION = "0.3.0";\nexport const NAME = "0.2.0";\n`,
    );
    expect(() => syncVersionText("export const NAME = 'x';", "1.0.0")).toThrow(
      "no FACTORY_VERSION",
    );
  });
});

describe("release workflows", () => {
  test("sync-version keeps the version file in lockstep and the release plan checks the new package", () => {
    expect(RELEASE_WORKFLOW).toContain('npm view "@loomwright/cli@$VERSION"');
    expect(RELEASE_WORKFLOW).toContain("require('./packages/cli/package.json')");
    expect(RELEASE_WORKFLOW).toContain("packages/core/src/version.ts");
    expect(RELEASE_WORKFLOW).not.toContain("@supporterino/ai-factory");
    expect(RELEASE_WORKFLOW).not.toContain("git diff --exit-code -- src/version.ts");
  });

  test("CI packs and smoke-tests the new paths: pack from the package root", () => {
    expect(CI_WORKFLOW).toContain("working-directory: packages/cli");
    expect(CI_WORKFLOW).toContain('node: ["20.3.0", "22", "24"]');
  });

  test("CI packs and smoke-tests the new paths: artifact uses the new dist paths", () => {
    expect(CI_WORKFLOW).toContain("packages/cli/dist/cli.js");
    expect(CI_WORKFLOW).toContain("packages/cli/dist/tui.js");
    expect(CI_WORKFLOW).toContain("packages/cli/dist/package.json");
    expect(CI_WORKFLOW).not.toMatch(/^\s+dist\/cli\.js$/m);
    expect(CI_WORKFLOW).not.toMatch(/^\s+dist\/package\.json$/m);
  });

  test("CI packs and smoke-tests the new paths: the replay smoke runs per node", () => {
    expect(CI_WORKFLOW).toContain("name: tui-replay");
    expect(CI_WORKFLOW).toContain("path: test/fixtures/tui/approval-gate.jsonl");
    expect(CI_WORKFLOW).toContain(
      "node dist/cli.js tui --replay dist/approval-gate.jsonl --once > /dev/null",
    );
  });

  test("both workflows use the one tarball check", () => {
    for (const workflow of [CI_WORKFLOW, RELEASE_WORKFLOW]) {
      expect(workflow).toContain("bun scripts/check-tarball.ts");
      expect(workflow).not.toContain('grep -qx "package/dist/');
    }
  });

  test("a good tarball listing passes", () => {
    const listing = [
      "package/dist/cli.js",
      "package/dist/tui.js",
      "package/dist/package.json",
      "package/README.md",
    ].join("\n");
    expect(checkTarball(listing)).toEqual([]);
  });

  test("a missing lazy entry fails", () => {
    const listing = ["package/dist/cli.js", "package/dist/package.json"].join("\n");
    expect(checkTarball(listing)).toContain("missing required entry: package/dist/tui.js");
  });

  test("source files fail", () => {
    const listing = [
      "package/dist/cli.js",
      "package/dist/tui.js",
      "package/dist/package.json",
      "package/src/main.ts",
    ].join("\n");
    const problems = checkTarball(listing);
    expect(problems.some((problem) => problem.includes("package/src/main.ts"))).toBe(true);
  });

  test("the e2e workflow runs the moved runtime test", () => {
    expect(E2E_WORKFLOW).toContain("bun test packages/cli/test/opencode-runtime.e2e.test.ts");
    expect(E2E_WORKFLOW).toContain('AI_FACTORY_E2E: "1"');
    expect(E2E_WORKFLOW).toContain('opencode: ["2.1.2", "2.2.0"]');
  });

  test("the tarball smoke test runs the new binary", () => {
    expect(CI_WORKFLOW).toContain('"$PREFIX/bin/loomwright" --version');
    expect(RELEASE_WORKFLOW).toContain('"$PREFIX/bin/loomwright" --version');
  });

  test("trusted publishing is untouched", () => {
    expect(RELEASE_WORKFLOW).toMatch(/^\s+environment: npm$/m);
    expect(RELEASE_WORKFLOW).toMatch(/^\s+id-token: write$/m);
    expect(RELEASE_WORKFLOW).toContain("--provenance --access public");
  });
});
