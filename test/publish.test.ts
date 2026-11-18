import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FACTORY_VERSION } from "@loomwright/core/version";
import { bundlePlugin } from "../scripts/build-plugin.ts";
import { buildTui } from "../scripts/build-tui.ts";
import { preparePackage } from "../scripts/prepare-package.ts";
import { syncVersion } from "../scripts/sync-version.ts";
import { writeDistPackage } from "../scripts/write-dist-package.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli");

const BASELINE_TARBALL = [
  "package/CHANGELOG.md",
  "package/LICENSE",
  "package/README.md",
  "package/dist/cli.js",
  "package/dist/package.json",
  "package/dist/tui.js",
  "package/package.json",
  "package/templates/addons/ponytail/LICENSE",
];

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "loomwright-package-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): string {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packPaths(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  const result = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!isRecord(result) || !Array.isArray(result.files)) {
    throw new Error("npm pack returned no file list");
  }
  return result.files.map((entry: unknown): string => {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new Error("npm pack returned a file entry without a path");
    }
    return entry.path.startsWith("package/") ? entry.path : `package/${entry.path}`;
  });
}

describe("published package", () => {
  test("preparePackage copies the shipped files and only writes inside packages/cli", () => {
    const root = tempRoot();
    write(root, "README.md", "# Readme\n");
    write(root, "LICENSE", "MIT\n");
    write(root, "templates/addons/ponytail/LICENSE", "Ponytail licence\n");
    write(root, "packages/cli/README.md", "stale\n");

    const written = preparePackage(root);

    expect(written).toHaveLength(3);
    for (const path of written) {
      expect(path.startsWith(join(root, "packages", "cli"))).toBe(true);
    }
    expect(read(root, "packages/cli/README.md")).toBe("# Readme\n");
    expect(read(root, "packages/cli/LICENSE")).toBe("MIT\n");
    expect(read(root, "packages/cli/templates/addons/ponytail/LICENSE")).toBe("Ponytail licence\n");
  });

  test("the tarball file list matches the baseline", () => {
    const root = tempRoot();
    for (const file of ["README.md", "LICENSE", "templates/addons/ponytail/LICENSE"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(root, file));
    }
    mkdirSync(join(root, "packages", "cli"), { recursive: true });
    copyFileSync(join(CLI, "package.json"), join(root, "packages/cli/package.json"));
    copyFileSync(join(CLI, "CHANGELOG.md"), join(root, "packages/cli/CHANGELOG.md"));
    write(root, "packages/cli/dist/cli.js", "// bundle\n");
    write(root, "packages/cli/dist/package.json", '{ "type": "module" }\n');
    write(root, "packages/cli/dist/tui.js", "// tui bundle\n");
    preparePackage(root);

    const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: join(root, "packages/cli"),
      encoding: "utf8",
      timeout: 60_000,
    });
    if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);

    expect(packPaths(pack.stdout).sort()).toEqual(BASELINE_TARBALL);
  });

  test("packing from packages/cli without a prior build reaches dist/cli.js", () => {
    const root = tempRoot();
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { build: "bun scripts/build.ts" },
      }),
    );
    write(
      root,
      "scripts/build.ts",
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'mkdirSync("packages/cli/dist", { recursive: true });',
        'writeFileSync("packages/cli/dist/cli.js", "// bundle\\n");',
        'writeFileSync("packages/cli/dist/package.json", \'{ "type": "module" }\\n\');',
        "",
      ].join("\n"),
    );
    mkdirSync(join(root, "packages", "cli"), { recursive: true });
    copyFileSync(join(CLI, "package.json"), join(root, "packages/cli/package.json"));
    write(root, "packages/cli/README.md", "# Readme\n");
    write(root, "packages/cli/LICENSE", "MIT\n");
    const bundle = join(root, "packages", "cli", "dist", "cli.js");
    expect(existsSync(bundle)).toBe(false);

    const pack = spawnSync("npm", ["pack", "--dry-run"], {
      cwd: join(root, "packages/cli"),
      encoding: "utf8",
      timeout: 60_000,
    });
    if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);

    expect(existsSync(bundle)).toBe(true);
  });

  test("publishing from packages/cli runs the root gate first", () => {
    const manifest: unknown = JSON.parse(read(ROOT, "packages/cli/package.json"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) {
      throw new Error("packages/cli/package.json has no scripts object");
    }
    expect(manifest.scripts.prepack).toBe("cd ../.. && bun run build");
    expect(manifest.scripts.prepublishOnly).toBe("cd ../.. && bun run check");
  });

  test("the version flag and both binaries still work", () => {
    const manifest: unknown = JSON.parse(read(ROOT, "packages/cli/package.json"));
    if (!isRecord(manifest)) throw new Error("packages/cli/package.json is not an object");
    expect(manifest.bin).toEqual({
      loomwright: "./dist/cli.js",
      "ai-factory": "./dist/cli.js",
    });

    const run = spawnSync(process.execPath, [join(CLI, "src", "bin.ts"), "--version"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(FACTORY_VERSION);
  });

  test("sync-version keeps the version file in lockstep", () => {
    const root = tempRoot();
    write(root, "packages/cli/package.json", '{ "name": "@loomwright/cli", "version": "2.3.4" }');
    write(root, "packages/core/src/version.ts", 'export const FACTORY_VERSION = "1.0.0";\n');

    const first = syncVersion(root);
    expect(first).toEqual({
      file: join(root, "packages/core/src/version.ts"),
      version: "2.3.4",
      changed: true,
    });
    expect(read(root, "packages/core/src/version.ts")).toBe(
      'export const FACTORY_VERSION = "2.3.4";\n',
    );

    const second = syncVersion(root);
    expect(second.changed).toBe(false);
    expect(second.version).toBe("2.3.4");
  });

  test("the build writes the CLI bundle and the plugin bundle", () => {
    const root: unknown = JSON.parse(read(ROOT, "package.json"));
    if (!isRecord(root) || !isRecord(root.scripts)) {
      throw new Error("package.json has no scripts object");
    }
    const build = root.scripts.build;
    if (typeof build !== "string") throw new Error("package.json has no build script");
    expect(build.startsWith("bun scripts/build-plugin.ts")).toBe(true);
    expect(build).toContain("bun build packages/cli/src/bin.ts --target=node");
    expect(build).toContain("--outfile packages/cli/dist/cli.js");
    expect(build).toContain("bun scripts/build-tui.ts");
    expect(build.indexOf("bun scripts/build-tui.ts")).toBeLessThan(
      build.indexOf("bun scripts/write-dist-package.ts"),
    );
    expect(build).toContain("bun scripts/write-dist-package.ts");
    expect(build.endsWith("bun scripts/prepare-package.ts")).toBe(true);
    expect(root.scripts.prepack).toBeUndefined();
    expect(root.scripts.prepublishOnly).toBeUndefined();
  });

  test("the build bundles a self-contained CLI and the plugin without writing tracked files", async () => {
    // Freshness of the committed plugin bundle is asserted in test/plugin.test.ts; here only
    // that bundling is in-memory, so a parallel reader never sees a rewritten tracked file.
    const tracked = read(ROOT, "templates/plugin/factory-plugin.txt");
    await bundlePlugin();
    expect(read(ROOT, "templates/plugin/factory-plugin.txt")).toBe(tracked);

    const dir = tempRoot();
    const build = await Bun.build({
      entrypoints: [join(CLI, "src", "bin.ts")],
      target: "node",
      outdir: dir,
      naming: "cli.js",
    });
    if (!build.success || build.outputs[0] === undefined) {
      throw new Error(`CLI build failed:\n${build.logs.join("\n")}`);
    }
    const bundle = join(dir, "cli.js");
    expect(build.outputs[0].path).toBe(bundle);
    write(dir, "package.json", '{ "type": "module" }\n');

    // The bundle carries its own sources: it runs outside the checkout.
    const run = spawnSync(process.execPath, [bundle, "--version"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(FACTORY_VERSION);
  });

  test("the dist package writer works from a clean tree", () => {
    const root = tempRoot();
    const target = join(root, "packages", "cli", "dist", "package.json");
    expect(existsSync(dirname(target))).toBe(false);

    writeDistPackage(target);

    expect(readFileSync(target, "utf8")).toBe('{ "type": "module" }\n');
  });

  test("a second run of the dist package writer is a no-op success", () => {
    const root = tempRoot();
    const target = join(root, "packages", "cli", "dist", "package.json");
    writeDistPackage(target);

    writeDistPackage(target);

    expect(readFileSync(target, "utf8")).toBe('{ "type": "module" }\n');
  });

  test("the redundant packages/cli/dist line is gone from .gitignore", () => {
    const lines = read(ROOT, ".gitignore").split("\n");
    for (const path of [
      "packages/cli/README.md",
      "packages/cli/LICENSE",
      "packages/cli/templates/",
    ]) {
      expect(lines).toContain(path);
    }
    expect(lines.filter((line) => line === "dist/")).toHaveLength(1);
    expect(lines).not.toContain("packages/cli/dist/");
  });

  test("the dist output is still ignored", () => {
    for (const path of ["packages/cli/dist/cli.js", "packages/cli/README.md"]) {
      const ignored = spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT });
      expect(ignored.status).toBe(0);
    }
  });

  test("the changelog lives in the published package behind a root symlink", () => {
    const link = join(ROOT, "CHANGELOG.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe("packages/cli/CHANGELOG.md");
    expect(readFileSync(link, "utf8")).toBe(read(ROOT, "packages/cli/CHANGELOG.md"));
  });

  test("the second entry exists and is lazy", async () => {
    const dir = tempRoot();
    const build = await Bun.build({
      entrypoints: [join(CLI, "src", "bin.ts")],
      target: "node",
      outdir: dir,
      naming: "cli.js",
    });
    if (!build.success || build.outputs[0] === undefined) {
      throw new Error(`CLI build failed:\n${build.logs.join("\n")}`);
    }
    write(dir, "package.json", '{ "type": "module" }\n');
    write(dir, "tui.js", 'throw new Error("tui loaded");\n');

    const run = spawnSync(process.execPath, [join(dir, "cli.js"), "--version"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(FACTORY_VERSION);

    // The CLI bundle must not carry the Ink graph: those modules live only in tui.js.
    const cliText = readFileSync(join(dir, "cli.js"), "utf8");
    expect(cliText).not.toContain("react-reconciler");
    expect(cliText).not.toContain("yoga-layout");
  });

  test("the build's second entry runs without the source tree", async () => {
    const dir = tempRoot();
    const cli = await Bun.build({
      entrypoints: [join(CLI, "src", "bin.ts")],
      target: "node",
      outdir: dir,
      naming: "cli.js",
    });
    if (!cli.success) throw new Error(`CLI build failed:\n${cli.logs.join("\n")}`);
    await buildTui(ROOT, dir);
    write(dir, "package.json", '{ "type": "module" }\n');

    expect(existsSync(join(dir, "cli.js"))).toBe(true);
    expect(existsSync(join(dir, "tui.js"))).toBe(true);

    const replay = join(ROOT, "test", "fixtures", "tui", "approval-gate.jsonl");
    const run = spawnSync(
      process.execPath,
      [join(dir, "cli.js"), "tui", "--replay", replay, "--once"],
      { cwd: dir, encoding: "utf8", timeout: 60_000 },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("add-health");
    expect(run.stdout).toContain("Approval");
    expect(run.stdout).toContain("replay: read-only");
    expect(run.stdout).not.toContain("\u001b[");
  });
});
