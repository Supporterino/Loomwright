/**
 * Bundles the TUI entry into packages/cli/dist/tui.js, the second entry the CLI loads with a
 * dynamic import so no other command pays Ink's startup cost.
 *
 *   bun run build   (via scripts/build-tui.ts)
 */

import { join } from "node:path";
import type { BunPlugin } from "bun";

export interface TuiBuild {
  readonly path: string;
  readonly bytes: number;
}

/** Ink imports its optional dev-only devtools peer statically; stub it so Node never resolves it. */
const devtoolsStub: BunPlugin = {
  name: "react-devtools-core-stub",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default { initialize() {}, connectToDevTools() {} };",
      loader: "js",
    }));
  },
};

export async function buildTui(
  root = join(import.meta.dir, ".."),
  outdir = join(root, "packages", "cli", "dist"),
): Promise<TuiBuild> {
  const build = await Bun.build({
    entrypoints: [join(root, "packages", "tui", "src", "entry.tsx")],
    target: "node",
    outdir,
    naming: "tui.js",
    plugins: [devtoolsStub],
  });
  const output = build.outputs[0];
  if (!build.success || output === undefined) {
    throw new Error(`tui build failed:\n${build.logs.join("\n")}`);
  }
  return { path: output.path, bytes: output.size };
}

if (import.meta.main) {
  const { path, bytes } = await buildTui();
  console.log(`wrote ${path} (${bytes} bytes)`);
}
