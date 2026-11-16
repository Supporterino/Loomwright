/**
 * The recorded header format lives here alone: `scripts/e2e-transcript.ts` writes the line and
 * `test/docs.test.ts` classifies every transcript by it, so the two cannot drift.
 */
export function headerLine(layout: string, version: string, date: string): string {
  return `Recorded ${date} with \`bun scripts/e2e-transcript.ts ${layout}\` (Loomwright ${version}).`;
}
