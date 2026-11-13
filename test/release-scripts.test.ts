import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection } from "../scripts/changelog-section.ts";
import { syncVersionText } from "../scripts/sync-version.ts";

const CI_WORKFLOW = readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
const RELEASE_WORKFLOW = readFileSync(
  join(import.meta.dir, "../.github/workflows/release.yml"),
  "utf8",
);

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
  test("the release plan checks the new package", () => {
    expect(RELEASE_WORKFLOW).toContain('npm view "@loomwright/cli@$VERSION"');
    expect(RELEASE_WORKFLOW).not.toContain("@supporterino/ai-factory");
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
