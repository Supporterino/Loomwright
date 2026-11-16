/**
 * Bundles packages/core/src/plugin/entry.ts into one self-contained file (opencode cannot
 * resolve packages from .opencode/plugins/). Output: templates/plugin/factory-plugin.txt,
 * rendered by init into .opencode/plugins/factory.js. A test fails when the committed bundle
 * is stale.
 *
 *   bun run build:plugin
 */
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PLUGIN_OUT = join(import.meta.dir, "..", "templates", "plugin", "factory-plugin.txt");

export async function bundlePlugin(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "packages", "core", "src", "plugin", "entry.ts")],
    target: "bun",
    format: "esm",
    minify: false,
  });
  if (!result.success || result.outputs[0] === undefined) {
    throw new Error(`plugin build failed:\n${result.logs.join("\n")}`);
  }
  const code = await result.outputs[0].text();
  return `// Loomwright opencode plugin — generated from packages/core/src/plugin/entry.ts; do not edit.\n${code}`;
}

/** Writes through a temp file and a rename, so a parallel reader never sees a partial bundle. */
export function writePluginBundle(code: string, out: string): void {
  const tmp = `${out}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, code);
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
  }
}

if (import.meta.main) {
  writePluginBundle(await bundlePlugin(), PLUGIN_OUT);
  console.log(`wrote ${PLUGIN_OUT}`);
}
