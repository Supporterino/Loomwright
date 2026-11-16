import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { headerLine } from "../scripts/e2e-header.ts";

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

const TRANSCRIPT_HEADER = /^Recorded .+ \(([^)]+?) ([\w.\-+]+)\)\.?$/m;
const LEGACY_HEADER =
  "Recorded 2026-10-26 with `bun scripts/e2e-transcript.ts single` (ai-factory 0.2.0).";

// The version in the header's parenthesis, whatever product recorded it.
function transcriptVersion(text: string): string | undefined {
  return TRANSCRIPT_HEADER.exec(text)?.[2];
}

// Transcripts recorded at or before the rename — or without a parseable version — are historical.
function isHistoricalTranscript(text: string): boolean {
  const version = transcriptVersion(text);
  if (version === undefined) return true;
  try {
    return Bun.semver.order(version, RENAME_VERSION) <= 0;
  } catch {
    // An unparseable version is history, like a missing one.
    return true;
  }
}

// Only docs/e2e/ is gated by the recorded version; every other scanned directory stays strict.
function historyViolation(file: string, text: string): boolean {
  const historical = file.startsWith("docs/e2e/") ? isHistoricalTranscript(text) : true;
  return historical && text.includes("Loomwright");
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

  test("current-facing docs use the new paths", () => {
    const readme = read("README.md");
    expect(readme).toContain("packages/core/src/config/schema.ts");
    expect(readme).toContain("packages/core/test/detect-units.test.ts");
    expect(readme).toContain("packages/cli/test/opencode-runtime.e2e.test.ts");
    expect(readme).toContain("packages/cli/dist/cli.js");
    expect(readme).toContain("packages/core/src/version.ts");
    expect(readme).toContain("packages/protocol");
    expect(readme).not.toMatch(/`src\//);
    expect(readme).not.toMatch(/`test\//);

    const architecture = read("ARCHITECTURE.md");
    expect(architecture).toContain("packages/cli/src/");
    expect(architecture).toContain("packages/cli/dist/cli.js");
    expect(architecture).toContain("packages/core/src/pipeline/");
    expect(architecture).toContain("packages/core/src/plugin/entry.ts");
    expect(architecture).toContain("packages/core/src/migrations/NNN-*.ts");
    expect(architecture).toContain("cli → core → protocol");
    expect(architecture).not.toMatch(/`src\//);

    expect(read("docs/cli.md")).toContain("packages/core/src/exit-codes.ts");

    const plan = read("docs/plan.md");
    expect(plan).toContain("## Modules (`packages/`)");
    expect(plan).toContain("packages/cli/src/");
    expect(plan).toContain("packages/core/src/plugin/entry.ts");
    expect(plan).not.toMatch(/`src\//);
  });

  test("ADR-0043 records the layout and the rule", () => {
    const adr = read("docs/decisions/0043-bun-workspaces.md");
    expect(adr.startsWith("# 0043 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).toContain("packages/protocol");
    expect(adr).toContain("packages/core");
    expect(adr).toContain("packages/cli");
    expect(adr).toContain("cli → core → protocol");
    expect(adr).toContain("packages/core/src/plugin/entry.ts");
    expect(adr).not.toContain("Loomwright");

    const index = read("docs/decisions/README.md");
    expect(index).toContain("| [0043](0043-bun-workspaces.md)");
    expect(index).toContain("Bun workspaces: protocol, core and cli packages");
  });

  test("the recorder's header classifies as current", () => {
    const header = headerLine("single", "1.0.0", "2026-01-01");
    expect(header).toContain("bun scripts/e2e-transcript.ts single");
    expect(header).toContain("(Loomwright 1.0.0)");
    expect(isHistoricalTranscript(header)).toBe(false);
  });

  test("the current ADR stays name-free", () => {
    const files = readdirSync(join(ROOT, "docs/decisions")).filter((name) =>
      name.startsWith("0044-"),
    );
    expect(files).toHaveLength(1);
    const [file] = files;
    if (file === undefined) throw new Error("no 0044 ADR");
    const adr = read("docs/decisions", file);
    expect(adr.startsWith("# 0044 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).not.toContain("Loomwright");
    expect(read("docs/decisions/README.md")).toContain(`| [0044](${file})`);
  });

  test("historical material is untouched", () => {
    expect(read("docs/decisions/0042-fewer-git-processes.md")).toContain(
      "`test/pipeline.test.ts` ran 7,215 git processes",
    );
    const snapshot = read("test/fixtures/install-0.12.0.json");
    expect(snapshot).toContain("# Managed by ai-factory");
    expect(snapshot).not.toContain("packages/");
  });

  test("the plugin output path and id are unchanged", () => {
    const plan = read("docs/plan.md");
    expect(plan).toContain("`.opencode/plugins/factory.js`");
    expect(plan).toContain("`bun scripts/build-plugin.ts`");

    const architecture = read("ARCHITECTURE.md");
    expect(architecture).toContain("packages/core/src/plugin/entry.ts");
    expect(architecture).toContain("`.opencode/plugins/factory.js`");

    const bundle = read("templates/plugin/factory-plugin.txt");
    expect(bundle).toContain("generated from packages/core/src/plugin/entry.ts");
    expect(bundle).toContain('id: "ai-factory"');
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
      expect(historyViolation(file, read(file)), file).toBe(false);
    }
  });

  test("a pre-rename transcript stays historical", () => {
    const text = `${LEGACY_HEADER}\n# E2E: single repo\n`;
    expect(transcriptVersion(text)).toBe("0.2.0");
    expect(isHistoricalTranscript(text)).toBe(true);
    expect(historyViolation("docs/e2e/single.md", text)).toBe(false);
  });

  test("a historical transcript naming the product fails", () => {
    const text = `${LEGACY_HEADER}\nLoomwright\n`;
    expect(historyViolation("docs/e2e/single.md", text)).toBe(true);
  });

  test("a current transcript may name the product", () => {
    const text = `${headerLine("single", "1.0.0", "2026-01-01")}\n\n$ loomwright init\n\nLoomwright\n`;
    expect(isHistoricalTranscript(text)).toBe(false);
    expect(historyViolation("docs/e2e/single.md", text)).toBe(false);
  });

  test("a transcript without a version is history", () => {
    const text = "# E2E: single repo\n\nLoomwright\n";
    expect(transcriptVersion(text)).toBeUndefined();
    expect(historyViolation("docs/e2e/single.md", text)).toBe(true);
    expect(
      isHistoricalTranscript("Recorded 2026-01-01 with `bun scripts/x.ts` (Loomwright main)"),
    ).toBe(true);
  });

  test("decisions, research and audit stay strict", () => {
    const text = `${headerLine("single", "1.0.0", "2026-01-01")}\n\nLoomwright\n`;
    for (const file of [
      "docs/decisions/0099-x.md",
      "docs/research/transcripts.md",
      "docs/audit/report.md",
    ]) {
      expect(historyViolation(file, text), file).toBe(true);
    }
  });

  test("release snapshots after 0.12.0 may name Loomwright", () => {
    expect(isHistoricalSnapshot("test/fixtures/install-0.12.0.json")).toBe(true);
    expect(isHistoricalSnapshot("test/fixtures/install-0.13.0.json")).toBe(false);
  });

  test("the workspace sandbox setting is pinned to off (ADR-0041)", () => {
    const config = read("factory.config.jsonc");
    expect(config).toContain('"security": { "sandbox": "off" }');
    expect(config).toContain("ADR-0041");
  });
});
