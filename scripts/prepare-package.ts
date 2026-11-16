/**
 * Copies the repository-level files the published package ships into packages/cli, so
 * `npm pack` in packages/cli produces the same tarball as before the workspace split.
 * These copies are build artifacts: packing with `npm pack --ignore-scripts` and no prior
 * build produces a short tarball (README.md, LICENSE and the ponytail licence missing).
 *
 *   bun run build
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

interface PackageFile {
  readonly from: string;
  readonly to: string;
}

const FILES: readonly PackageFile[] = [
  { from: "README.md", to: join("packages", "cli", "README.md") },
  { from: "LICENSE", to: join("packages", "cli", "LICENSE") },
  {
    from: join("templates", "addons", "ponytail", "LICENSE"),
    to: join("packages", "cli", "templates", "addons", "ponytail", "LICENSE"),
  },
];

/** Copies the shipped files and returns their absolute paths, inside packages/cli. */
export function preparePackage(root: string): string[] {
  const written: string[] = [];
  for (const file of FILES) {
    const target = join(root, file.to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file.from), target);
    written.push(target);
  }
  return written;
}

if (import.meta.main) {
  for (const file of preparePackage(join(import.meta.dir, ".."))) console.log(`wrote ${file}`);
}
