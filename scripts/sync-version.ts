/**
 * Copies packages/cli/package.json's version into packages/core/src/version.ts. Changesets
 * only bumps the published manifest; the CLI and the tests require the two to agree.
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

export interface SyncVersionResult {
  readonly file: string;
  readonly version: string;
  readonly changed: boolean;
}

/** Rewrites FACTORY_VERSION in packages/core/src/version.ts from packages/cli/package.json. */
export function syncVersion(root: string): SyncVersionResult {
  const manifest = join(root, "packages", "cli", "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("packages/cli/package.json has no version");

  const file = join(root, "packages", "core", "src", "version.ts");
  const before = readFileSync(file, "utf8");
  const after = syncVersionText(before, pkg.version);
  if (after === before) return { file, version: pkg.version, changed: false };
  writeFileSync(file, after);
  return { file, version: pkg.version, changed: true };
}

if (import.meta.main) {
  const { version, changed } = syncVersion(join(import.meta.dir, ".."));
  const relative = join("packages", "core", "src", "version.ts");
  console.log(changed ? `${relative} -> ${version}` : `${relative} is already at ${version}`);
}
