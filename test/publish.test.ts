import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { preparePackage } from "../scripts/prepare-package.ts";
import { syncVersion } from "../scripts/sync-version.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli");

const BASELINE_TARBALL = [
  "package/CHANGELOG.md",
  "package/LICENSE",
  "package/README.md",
  "package/dist/cli.js",
  "package/dist/package.json",
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
    preparePackage(root);

    const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: join(root, "packages/cli"),
      encoding: "utf8",
    });
    if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);

    expect(packPaths(pack.stdout).sort()).toEqual(BASELINE_TARBALL);
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
    expect(build.endsWith("bun scripts/prepare-package.ts")).toBe(true);
    expect(root.scripts.prepack).toBeUndefined();
    expect(root.scripts.prepublishOnly).toBeUndefined();
  });

  test("the generated package files are ignored", () => {
    const ignore = read(ROOT, ".gitignore");
    for (const path of [
      "packages/cli/README.md",
      "packages/cli/LICENSE",
      "packages/cli/templates/",
      "packages/cli/dist/",
    ]) {
      expect(ignore).toContain(path);
    }
  });

  test("the changelog lives in the published package behind a root symlink", () => {
    const link = join(ROOT, "CHANGELOG.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe("packages/cli/CHANGELOG.md");
    expect(readFileSync(link, "utf8")).toBe(read(ROOT, "packages/cli/CHANGELOG.md"));
  });
});
