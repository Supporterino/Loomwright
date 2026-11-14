/**
 * Copies package.json's version into packages/core/src/version.ts. Changesets only bumps
 * package.json; the CLI and the tests require the two to agree.
 *
 *   bun scripts/sync-version.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION_PATTERN = /export const FACTORY_VERSION = "[^"]+";/;

export function syncVersionText(source: string, version: string): string {
  if (!VERSION_PATTERN.test(source)) {
    throw new Error("packages/core/src/version.ts has no FACTORY_VERSION declaration");
  }
  return source.replace(VERSION_PATTERN, () => `export const FACTORY_VERSION = "${version}";`);
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string") throw new Error("package.json has no version");

  const file = join(root, "packages", "core", "src", "version.ts");
  const before = readFileSync(file, "utf8");
  const after = syncVersionText(before, pkg.version);
  if (after === before) {
    console.log(`packages/core/src/version.ts is already at ${pkg.version}`);
  } else {
    writeFileSync(file, after);
    console.log(`packages/core/src/version.ts -> ${pkg.version}`);
  }
}
