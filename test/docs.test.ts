import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { headerLine } from "../scripts/e2e-header.ts";

const ROOT = join(import.meta.dir, "..");
const RENAME_VERSION = "0.12.0";

/** Runs git in the repository root and returns trimmed stdout. */
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const CHANGE_ID = "fix-correctness-and-guard-gaps";
const CHANGE_DIR = `openspec/changes/${CHANGE_ID}`;

/**
 * The commit before the change added its proposal. The historical-file assertion compares
 * against it so a later ADR or index row cannot accidentally look like a change to history.
 */
function changeBase(): string {
  // `--full-history` disables path-limited history simplification: on a pull-request merge ref
  // git otherwise walks only the parent that differs for this path and never reaches the commit
  // that added it. Locally on a linear branch the flag changes nothing.
  const added = git(
    "log",
    "--full-history",
    "--diff-filter=A",
    "--format=%H",
    "--",
    `${CHANGE_DIR}/proposal.md`,
  )
    .split("\n")
    .filter(Boolean);
  const first = added[added.length - 1];
  if (first === undefined) throw new Error("the change proposal is not in history");
  return git("rev-parse", `${first}^`);
}

/**
 * The change's own last commit: the newest commit carrying its `Change-Id`, or for a squash
 * landing the newest that touched its directory. Bounding the range here keeps a later change
 * that edits an ADR from looking like a change to history.
 */
function changeTip(): string {
  const [trailer] = git(
    "log",
    "--extended-regexp",
    "--format=%H",
    `--grep=^Change-Id: ${CHANGE_ID}$`,
  )
    .split("\n")
    .filter(Boolean);
  if (trailer !== undefined) return trailer;
  const [touching] = git("log", "--full-history", "--format=%H", "--", CHANGE_DIR)
    .split("\n")
    .filter(Boolean);
  if (touching === undefined) throw new Error("the change is not in history");
  return touching;
}

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
const E2E_TRANSCRIPTS: ReadonlyArray<readonly [file: string, layout: string]> = [
  ["docs/e2e/single.md", "single"],
  ["docs/e2e/submodules.md", "submodules"],
];

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

  test("the re-recorded transcripts are current", () => {
    for (const [file, layout] of E2E_TRANSCRIPTS) {
      const text = read(file);
      const header = text.split("\n").find((line) => line.startsWith("Recorded ")) ?? "";
      expect(header, file).toContain(`bun scripts/e2e-transcript.ts ${layout}`);
      const version = transcriptVersion(text);
      expect(version, file).toBeDefined();
      if (version === undefined) continue;
      expect(Bun.semver.order(version, RENAME_VERSION), file).toBeGreaterThan(0);
      expect(isHistoricalTranscript(text), file).toBe(false);
      expect(historyViolation(file, text), file).toBe(false);
      expect(text, file).toContain("Loomwright");
      expect(text, file).toContain("$ loomwright");
    }
  });

  test("the real tree passes", () => {
    const files = [
      ...filesUnder("docs/decisions"),
      ...filesUnder("docs/research"),
      ...filesUnder("docs/audit"),
      ...filesUnder("docs/e2e"),
      ...filesUnder("test/fixtures").filter(isHistoricalSnapshot),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(historyViolation(file, read(file)), file).toBe(false);
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

  test("ADR-0045 records the opencode feature floors", () => {
    const adr = read("docs/decisions/0045-opencode-feature-floors.md");
    expect(adr.startsWith("# 0045 — opencode feature version floors")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).toContain(">= 2.1.2 < 3.0.0");
    expect(adr).toContain("mcp.roles");
    expect(adr).not.toContain("Loomwright");
    expect(read("docs/decisions/README.md")).toContain("| [0045](0045-opencode-feature-floors.md)");
  });

  test("ADR-0046 records the event stream", () => {
    const adr = read("docs/decisions/0046-typed-event-stream.md");
    expect(adr.startsWith("# 0046 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).not.toContain("Loomwright");
    expect(read("docs/decisions/README.md")).toContain("| [0046](0046-typed-event-stream.md)");
  });

  test("ADR-0050 records the immediate answer path", () => {
    const adr = read("docs/decisions/0050-answer-without-driver.md");
    expect(adr.startsWith("# 0050 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).toContain("ADR-0046");
    expect(adr).toContain("a live follower drops the late duplicate");
    expect(adr).not.toContain("Loomwright");
    expect(read("docs/decisions/README.md")).toContain("| [0050](0050-answer-without-driver.md)");
  });

  test("the ADR exists and is indexed (ADR-0049)", () => {
    const adr = read("docs/decisions/0049-package-runner-aliases.md");
    expect(adr.startsWith("# 0049 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).toContain("npx");
    expect(adr).toContain("pnpx");
    expect(adr).toContain("routed, not blocked");
    expect(adr).not.toContain("Loomwright");
    expect(read("docs/decisions/README.md")).toContain("| [0049](0049-package-runner-aliases.md)");
  });

  test("docs/events.md covers the contract", () => {
    const events = read("docs/events.md");
    for (const topic of [
      "v",
      "seq",
      "event families",
      "truncated",
      "redact",
      "single writer",
      "fromSeq",
      "tailEvents",
      "pause",
      "additive evolution checklist",
    ])
      expect(events).toContain(topic);
    expect(events).toContain("loomwright events");
    expect(events).toContain("--json");
    expect(events).toContain("status --watch");
    expect(events).toContain("8 KiB");
    expect(events).toContain("additive");
    expect(events).toContain("live driver");
    expect(events).toContain("persisted immediately");
    expect(events).toContain("drops the late duplicate");
    // `answer` uses the inbox only for a live driver and is persisted immediately otherwise.
    expect(events).toContain("uses the inbox only while a live driver");
    // The missing-run exception: an answer for a run id with no run file keeps the inbox write.
    expect(events).toContain("the one exception: that missing-run case keeps the inbox write");
    expect(events).toContain("leaves the file");
    expect(read("docs/cli.md")).toContain("docs/events.md");
  });

  test("the architecture and README mention the event stream", () => {
    const architecture = read("ARCHITECTURE.md");
    expect(architecture).toContain(".factory/events/");
    expect(architecture).toContain(".factory/events/<id>.jsonl");
    expect(architecture).toContain(".factory/commands/");
    expect(architecture).toContain("live-driver");
    expect(architecture).toContain("packages/core/src/events/");
    expect(read("README.md")).toContain("loomwright events");
  });

  test("the docs describe the 2.x range and the mcp.roles floor", () => {
    const readme = read("README.md");
    expect(readme).toContain("2.x (≥ 2.1.2, < 3.0.0; tested 2.2.0)");
    expect(readme).toContain("`mcp.roles` needs 2.2.0");
    const cli = read("docs/cli.md");
    expect(cli).toContain("`mcp.roles` needs 2.2.0");
    expect(cli).toContain(
      "The opencode floor is the higher of the base floor and the enabled features' floors",
    );
    expect(cli).toContain("a lock whose opencode floor is behind the config is a warning");
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

  test("the README rows describe the override precedence", () => {
    const readme = read("README.md");
    const scriptsRow = readme.split("\n").find((l) => l.startsWith("| `gates.scripts`"));
    expect(scriptsRow).toBeDefined();
    expect(scriptsRow).toContain("replaces the script lookup");
    expect(scriptsRow).toContain("write-mode script warning");

    const doctorRow = readme
      .split("\n")
      .find((l) => l.includes("`doctor` / `gate`: `no format gate`"));
    expect(doctorRow).toBeDefined();
    expect(doctorRow).toContain("replaces the script lookup");
    expect(doctorRow).toContain("write-mode script warning");
  });

  test("the CLI reference describes the override precedence", () => {
    const cli = read("docs/cli.md");

    const doctorBullet = cli.split("\n").find((l) => l.startsWith("- **Gates:**"));
    expect(doctorBullet).toBeDefined();
    expect(doctorBullet).toContain("skips the write-mode script warning");
    expect(doctorBullet).toContain("replaces the script lookup");

    const gateBullet = cli.split("\n").find((l) => l.startsWith("- Gates resolve as"));
    expect(gateBullet).toBeDefined();
    expect(gateBullet).toContain("replaces the script lookup");
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

  test("the pre-rename transcripts are re-recorded, not kept", () => {
    for (const [file] of E2E_TRANSCRIPTS) {
      const text = read(file);
      const version = transcriptVersion(text);
      expect(version, file).toBeDefined();
      if (version === undefined) continue;
      expect(Bun.semver.order(version, RENAME_VERSION), file).toBeGreaterThan(0);
      expect(text, file).toContain("(Loomwright ");
      expect(isHistoricalTranscript(text), file).toBe(false);
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

  test("the ADR says superseded and the setting stays off (ADR-0041)", () => {
    const config = read("factory.config.jsonc");
    expect(config).toContain('"security": { "sandbox": "off" }');
    expect(config).toContain("ADR-0041");

    const adr = read("docs/decisions/0041-unsandboxed-workspace.md");
    expect(adr).toContain("The nesting guard supersedes this exception");
    expect(adr).toContain("manual, post-landing edit of the protected `factory.config.jsonc`");
    expect(adr).not.toContain("Loomwright");
  });

  test("ADR-0026 names the off-macOS residual", () => {
    const adr = read("docs/decisions/0026-hardening-and-sandbox.md");
    expect(adr).toContain("heuristic");
    expect(adr).toContain("glob expansion and other-language source scans");
    expect(adr).toContain(
      "the shell parser and the edit-scope check are the only backstop on hosts without a sandbox",
    );
    expect(adr).not.toContain("Loomwright");
  });

  test("the named ADRs are corrected", () => {
    const named: ReadonlyArray<readonly [file: string, sections: readonly string[]]> = [
      ["0026-hardening-and-sandbox.md", ["**Context.**", "**Decision.**", "**Consequences.**"]],
      ["0041-unsandboxed-workspace.md", ["**Context.**", "**Decision.**", "**Consequences.**"]],
      ["0047-tui.md", ["## Context", "## Decision", "## Consequences"]],
      ["0049-package-runner-aliases.md", ["## Context", "## Decision", "## Consequences"]],
    ];
    for (const [file, sections] of named) {
      const adr = read("docs/decisions", file);
      expect(adr.length, file).toBeGreaterThan(0);
      for (const section of sections) expect(adr, file).toContain(section);
      expect(adr, file).not.toContain("Loomwright");
    }
  });

  test("every other historical file keeps its text", () => {
    const base = changeBase();
    const historical = git(
      "ls-tree",
      "-r",
      "--name-only",
      base,
      "--",
      "docs/decisions",
      "docs/research",
      "docs/audit",
    )
      .split("\n")
      .filter((file) => file.length > 0 && file !== "docs/decisions/README.md");
    expect(historical.length).toBeGreaterThan(0);

    // 0049 is new, so it is not in the base tree; the named-ADR test above covers it.
    const changed = git("diff", "--name-only", base, changeTip(), "--", ...historical)
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(changed).toEqual([
      "docs/decisions/0026-hardening-and-sandbox.md",
      "docs/decisions/0041-unsandboxed-workspace.md",
      "docs/decisions/0047-tui.md",
    ]);
  });
});

describe("terminal UI documentation", () => {
  test("the docs cover the UI", () => {
    const tui = read("docs/tui.md");
    for (const heading of [
      "# The terminal UI",
      "## The run list",
      "## The run view",
      "## Findings and reword",
      "## The activity log",
      "## Layout",
      "## Keys",
      "## Starting a change",
      "## Approving",
      "## Questions and answers",
      "## Flags",
      "## Accessibility",
      "## Replay",
    ])
      expect(tui).toContain(heading);
    expect(tui).toContain("recorded — applies at the next step");
    expect(tui).toContain("`l`");
    expect(tui).toContain("`L`");
    expect(tui).toContain("`w`");
    expect(tui).toContain("every run event");
    expect(tui).toContain("full-height");

    // The long actions are detached children; answer, abort and retry are in-process writes.
    expect(tui).toContain("detached CLI children");
    expect(tui).toContain("in-process");

    const readme = read("README.md");
    expect(readme).toContain("## Watching and driving from the terminal");
    expect(readme).toContain("loomwright tui");
    expect(readme).toContain("recorded — applies at the next step");
    expect(readme).toContain("in-process");
    expect(readme).toContain("`l`");
    expect(readme).toContain("docs/tui.md");

    const cli = read("docs/cli.md");
    expect(cli).toContain("## tui");
    expect(cli).toContain("loomwright tui [--replay <file>] [--once] [--ascii]");
    expect(cli).toContain("status --watch");
    expect(cli).toContain("events --follow");
    expect(cli).toContain("in-process");
    expect(cli).toContain("`l`");
    expect(cli).toContain("docs/tui.md");
  });

  test("the size is measured, not estimated, and the ADR is valid and indexed", () => {
    const adr = read("docs/decisions/0047-tui.md");
    expect(adr.startsWith("# 0047 — ")).toBe(true);
    expect(adr).toContain("## Context");
    expect(adr).toContain("## Decision");
    expect(adr).toContain("## Consequences");
    expect(adr).toContain("Ink **6.4.0**");
    expect(adr).toContain("React **19.3.1**");
    expect(adr).toContain("approval.pending");
    expect(adr).toContain("--replay");
    expect(adr).not.toContain("about 1 MB");
    expect(adr).toMatch(/\d{1,3}(,\d{3})* bytes/);
    expect(adr).toContain("bun run build");
    expect(adr).toContain("wc -c");
    expect(adr).not.toContain("Loomwright");

    const next = read("docs/decisions/0048-tui-scroll-log-and-reword.md");
    expect(next.startsWith("# 0048 — ")).toBe(true);
    expect(next).toContain("## Context");
    expect(next).toContain("## Decision");
    expect(next).toContain("## Consequences");
    expect(next).toContain("Ink 6.4.0");
    expect(next).toContain("React 19.3.1");
    expect(next).not.toContain("[");
    expect(next).not.toContain("Loomwright");

    const index = read("docs/decisions/README.md");
    expect(index).toContain("| [0047](0047-tui.md)");
    expect(index).toContain("| [0048](0048-tui-scroll-log-and-reword.md)");
  });

  test("the keys are documented", () => {
    const tui = read("docs/tui.md");
    const hints: ReadonlyArray<readonly [key: string, label: string]> = [
      ["n", "new change"],
      ["Tab", "file mode"],
      ["Tab", "text mode"],
      ["Tab", "scope"],
      ["a", "approve and run"],
      ["A", "approve only"],
      ["w", "reword"],
      ["R", "reapprove"],
      ["r", "resume"],
      ["x", "abort"],
      ["t", "retry task"],
      ["d", "diff"],
      ["l", "land"],
      ["Q", "questions"],
      ["PgUp/PgDn", "page"],
      ["g/G", "ends"],
      ["f", "follow on"],
      ["Ctrl-J", "newline"],
      ["Esc", "collapse"],
      ["?", "help"],
      ["q", "quit"],
    ];
    for (const [key] of hints)
      for (const part of key.split("/")) expect(tui).toContain(`\`${part}\``);
    expect(tui).toContain("`L`");

    // `q` quits from the list, the run view, help and the approval overlay; an open panel or a
    // text field owns the key, so the table must not promise "Everywhere".
    const quitRow = tui.split("\n").find((line) => line.startsWith("| `q`"));
    expect(quitRow).toContain("Run list, run view, help and the approval overlay");

    // The footer is built from these pure hints, so checking them covers the rendered footer.
    const sources = [
      read("packages/tui/src/model/view-model.ts"),
      read("packages/tui/src/intake/dialog.tsx"),
      read("packages/tui/src/approval/overlay.ts"),
      read("packages/tui/src/controls/activity-pane.ts"),
    ].join("\n");
    for (const [key, label] of hints)
      if (key === "f") expect(sources).toContain('keyHint("f"');
      else expect(sources).toContain(`keyHint("${key}", "${label}")`);
    expect(read("packages/tui/src/help.ts")).toContain("L open the activity log");

    // The honest answer wording is shared with the questions pane.
    expect(read("packages/tui/src/strings.ts")).toContain("recorded — applies at the next step");
    expect(tui).toContain("never claims the answer was applied");
  });

  test("the docs describe the task-scoped log and the done diff", () => {
    const tui = read("docs/tui.md");
    expect(tui).toContain("A task's scope is its own step lines only");
    expect(tui).toContain("`Tab` moves to the repo scope");
    expect(tui).toContain("`d diff`");
    expect(tui).toContain("before `l land`");
    expect(tui).toContain("Diff — <id>");
    expect(tui).toContain("answer, diff\nand land are disabled");
  });

  test("the report lists the follow-ups", () => {
    const tui = read("docs/tui.md").toLowerCase();
    for (const followUp of ["web ui", "daemon", "remote nodes", "mouse", "themes", "pause"])
      expect(tui).toContain(followUp);
  });
});
