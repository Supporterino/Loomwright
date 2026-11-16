/**
 * Writes packages/cli/dist/package.json so the standalone CLI bundle is treated as ESM even
 * when it is executed outside the package root (for example from the CI artifact, which only
 * contains dist/).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeDistPackage(out: string): void {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `{ "type": "module" }\n`);
}

if (import.meta.main) {
  const out = join(import.meta.dir, "..", "packages", "cli", "dist", "package.json");
  writeDistPackage(out);
  console.log(`wrote ${out}`);
}
