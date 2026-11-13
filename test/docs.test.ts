import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RENAME_VERSION = "0.12.0";

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

// Only snapshots written before the rename are historical; later releases may use the new name.
function isHistoricalSnapshot(file: string): boolean {
  const version = /^test\/fixtures\/install-(.+)\.json$/.exec(file)?.[1];
  return version !== undefined && Bun.semver.order(version, RENAME_VERSION) <= 0;
}

describe("documentation", () => {
  test("the README header carries the brand", () => {
    const header = read("README.md").split("\n").slice(0, 15).join("\n");
    expect(header).toContain("brand/icons/mark-on-light-512.png");
    expect(header).toContain("# Loomwright");
    expect(header).toContain("Spec in. Woven software out.");
    expect(header).toContain("brand/BRAND.md");
    expect(header).toContain("Renamed from ai-factory");
  });

  test("README commands use the new package and binary", () => {
    const readme = read("README.md");
    expect(readme).toContain("bunx @loomwright/cli init");
    expect(readme).toContain("npx @loomwright/cli init");
    expect(readme).not.toContain("@loomwright/cli@0.3.0");
    expect(readme).toContain("loomwright doctor");
    expect(readme).toContain("@loomwright/cli@<new> update");
    expect(readme).toContain("@loomwright/cli@<new> rollback");
    expect(readme).toContain("deprecated alias");
  });

  test("the CLI reference names the new package", () => {
    const cli = read("docs/cli.md");
    expect(cli.split("\n\n")[1]).toContain("`loomwright [-C <dir>] <command> [options]`");
    expect(cli.split("\n\n")[1]).toContain("`@loomwright/cli`");
    expect(cli).not.toMatch(/^ai-factory /m);
  });

  test("the architecture and plan name Loomwright", () => {
    const architecture = read("ARCHITECTURE.md");
    expect(architecture.split("\n").slice(0, 5).join("\n")).toContain("Loomwright is a CLI");
    expect(architecture).toContain("subgraph cli[Loomwright CLI]");
    expect(read("docs/plan.md").startsWith("# Loomwright v1 build plan")).toBe(true);
  });

  test("the fleet update example uses the new package", () => {
    const fleet = read("docs/fleet-update.sh");
    expect(fleet).toMatch(/bunx "@loomwright\/cli@\$\{version\}"/);
    expect(fleet).toContain("loomwright rollback");
  });
});

describe("compatibility surface", () => {
  test("the replay snapshot stays historical", () => {
    const snapshot = read("test/fixtures/install-0.12.0.json");
    expect(snapshot).toContain("# Managed by ai-factory");
    expect(snapshot).toContain("<!-- ai-factory:start");
    expect(snapshot).not.toContain("Loomwright");
  });

  test("past changelog entries are preserved", () => {
    const changelog = read("CHANGELOG.md");
    const start = changelog.indexOf("## 0.12.0");
    const end = changelog.indexOf("\n## ", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const section = changelog.slice(start, end === -1 ? undefined : end);
    expect(section).toContain(
      "Reviewers and contract reviewers are now told to set `file` to the change's spec path",
    );
    expect(section).not.toContain("Loomwright");
  });

  test("historical docs do not mention Loomwright", () => {
    const files = [
      ...filesUnder("docs/decisions"),
      ...filesUnder("docs/research"),
      ...filesUnder("docs/e2e"),
      ...filesUnder("docs/audit"),
      ...filesUnder("test/fixtures").filter(isHistoricalSnapshot),
    ];
    for (const file of files) {
      expect(read(file), file).not.toContain("Loomwright");
    }
  });

  test("release snapshots after 0.12.0 may name Loomwright", () => {
    expect(isHistoricalSnapshot("test/fixtures/install-0.12.0.json")).toBe(true);
    expect(isHistoricalSnapshot("test/fixtures/install-0.13.0.json")).toBe(false);
  });
});
