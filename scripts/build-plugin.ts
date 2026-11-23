/**
 * Bundles packages/core/src/plugin/entry.ts into one self-contained file (opencode cannot
 * resolve packages from .opencode/plugins/). Output: templates/plugin/factory-plugin.txt,
 * rendered by init into .opencode/plugins/factory.js. A test fails when the committed bundle
 * is stale.
 *
 *   bun run build:plugin
 */
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

export const PLUGIN_OUT = join(REPO_ROOT, "templates", "plugin", "factory-plugin.txt");

const MODULE_LABEL = /^\/\/ (.+\.[cm]?[jt]sx?)$/;

/**
 * Bun prints module labels relative to the working directory and ignores `root` for a single
 * entry point, so rewrite each one against the repository root to keep the bundle byte-stable.
 */
function normalizeLabels(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const label = MODULE_LABEL.exec(line)?.[1];
      return label === undefined ? line : `// ${relative(REPO_ROOT, resolve(label))}`;
    })
    .join("\n");
}

export async function bundlePlugin(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(REPO_ROOT, "packages", "core", "src", "plugin", "entry.ts")],
    root: REPO_ROOT,
    target: "bun",
    format: "esm",
    minify: false,
  });
  if (!result.success || result.outputs[0] === undefined) {
    throw new Error(`plugin build failed:\n${result.logs.join("\n")}`);
  }
  const code = normalizeLabels(await result.outputs[0].text());
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
