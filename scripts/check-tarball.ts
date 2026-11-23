/**
 * Checks the packed npm tarball's file list. One list for ci.yml and release.yml:
 * a lazy entry that stops being packed must fail the release, not only CI.
 *
 *   tar -tzf <tarball> > pack-files.txt
 *   bun scripts/check-tarball.ts pack-files.txt
 */
import { readFileSync } from "node:fs";

export const REQUIRED: readonly string[] = [
  "package/dist/cli.js",
  "package/dist/tui.js",
  "package/dist/package.json",
];
export const FORBIDDEN: readonly string[] = ["package/src/", "package/test/", "package/scripts/"];

/** Problems, each naming the offending path; empty when the listing is good. */
export function checkTarball(listing: string): string[] {
  const lines = listing.split(/\r?\n/);
  const problems: string[] = [];
  for (const required of REQUIRED) {
    if (!lines.includes(required)) problems.push(`missing required entry: ${required}`);
  }
  for (const line of lines) {
    if (FORBIDDEN.some((prefix) => line.startsWith(prefix))) {
      problems.push(`unexpected source entry: ${line}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const source = process.argv[2];
  const listing = source === undefined ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  const problems = checkTarball(listing);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    const noun = problems.length === 1 ? "problem" : "problems";
    console.error(`tarball check failed: ${problems.length} ${noun}`);
    process.exit(1);
  }
}
