import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseJsonc } from "@loomwright/core/config/jsonc";
import { loadConfig } from "@loomwright/core/config/load";
import { DEFAULT_GRAPH_EXCLUDE } from "@loomwright/core/config/schema";
import { ExitCode } from "@loomwright/core/exit-codes";
import { readLock } from "@loomwright/core/lock/lock";
import {
  graphExcludeDefaults,
  V1_GRAPH_EXCLUDE,
} from "@loomwright/core/migrations/001-graph-exclude-defaults";
import { artifactsV4 } from "@loomwright/core/migrations/003-artifacts";
import { migrateConfigText } from "@loomwright/core/migrations/index";
import { claimActive, releaseActive } from "@loomwright/core/state/active";
import { loadRun } from "@loomwright/core/state/run";
import { FACTORY_VERSION } from "@loomwright/core/version";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  createSingleRepoFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli, cliWith, gitOut, type Run } from "../../../test/helpers.ts";

const SNAPSHOT = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../test/fixtures/install-0.1.0.json"), "utf8"),
) as {
  version: string;
  files: Record<string, string>;
};

describe("config migrations", () => {
  const v1 = `// my comment
{
  "schemaVersion": 1,
  "graph": { "exclude": ${JSON.stringify(V1_GRAPH_EXCLUDE)} }
}
`;

  test("001 replaces the old default excludes, keeps comments, bumps the version", () => {
    const out = graphExcludeDefaults.migrate(v1);
    expect(out).toContain("// my comment");
    expect(parseJsonc(out).value).toEqual({
      schemaVersion: 2,
      graph: { exclude: [...DEFAULT_GRAPH_EXCLUDE] },
    });
  });

  test("001 keeps a customised exclude list", () => {
    const custom = v1.replace('"graphify-out/**"', '"graphify-out/**", "legacy/**"');
    expect(
      (parseJsonc(graphExcludeDefaults.migrate(custom)).value as { graph: { exclude: string[] } })
        .graph.exclude,
    ).toContain("legacy/**");
  });

  test("003 adds the artifacts block and keeps records out of the graph", () => {
    const v3 = `{
  // keep this comment
  "schemaVersion": 3,
  "graph": { "exclude": ["**/node_modules/**"] }
}
`;
    const out = artifactsV4.migrate(v3);
    const value = parseJsonc(out).value as {
      schemaVersion: number;
      artifacts: Record<string, unknown>;
      graph: { exclude: string[] };
    };
    expect(value.schemaVersion).toBe(4);
    expect(value.artifacts).toEqual({
      mode: "local",
      reports: true,
      approvals: true,
      usage: true,
    });
    expect(value.graph.exclude).toEqual(["**/node_modules/**", "factory-records/**"]);
    expect(out).toContain("// keep this comment");

    const twice = artifactsV4.migrate(
      `{"schemaVersion": 3, "graph": { "exclude": ["factory-records/**"] }}`,
    );
    expect((parseJsonc(twice).value as { graph: { exclude: string[] } }).graph.exclude).toEqual([
      "factory-records/**",
    ]);
  });

  test("the runner applies pending migrations in order and refuses newer configs", () => {
    expect(migrateConfigText(v1)).toMatchObject({
      from: 1,
      to: 4,
      applied: ["001-graph-exclude-defaults", "002-config-v3", "003-artifacts"],
    });
    const current = migrateConfigText(migrateConfigText(v1).text);
    expect(current.applied).toEqual([]);
    expect(() => migrateConfigText('{ "schemaVersion": 99 }')).toThrow("newer than this factory");
  });
});

describe(`update from a ${SNAPSHOT.version} install`, () => {
  let base: string;
  let root: string;

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), "ai-factory-update-"));
    root = join(base, "app");
    for (const [rel, content] of Object.entries(SNAPSHOT.files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    await fixtureGit(root, "init", "-q", "-b", "main");
    await fixtureGit(root, "add", "-A");
    await fixtureGit(root, "commit", "-q", "-m", `chore(factory): init v${SNAPSHOT.version}`);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
  const edit = (rel: string, f: (t: string) => string): void =>
    writeFileSync(join(root, rel), f(read(rel)));
  async function commit(message: string): Promise<void> {
    await fixtureGit(root, "add", "-A");
    await fixtureGit(root, "commit", "-q", "-m", message);
  }
  async function trackedContents(): Promise<Record<string, string>> {
    const files = (await gitOut(root, "ls-files")).split("\n");
    return Object.fromEntries(files.map((f) => [f, read(f)]));
  }

  test("the old config is refused until update migrates it", async () => {
    expect(() => loadConfig(root)).toThrow("uses config schemaVersion 1; this factory needs 4");
    const res = await cli(root, "detect");
    expect(res.err).toContain("run `loomwright update` to migrate it");
  });

  test("keeps your edits, migrates the config, regenerates agents, one commit, rollback restores exactly", async () => {
    edit("factory.config.jsonc", (t) => `// team note: models agreed on 2026-10-01\n${t}`);
    edit(".opencode/agents/tester.md", (t) => `${t}\nAlways run \`bun test\` before you finish.\n`);
    edit(".opencode/agents/implementer-app.md", (t) =>
      t.replace(
        "# Role: implementer for repo `app`",
        "# Role: implementer for repo `app` (our team)",
      ),
    );
    edit("AGENTS.md", (t) => `${t}\n# House rules\nUse tabs.\n`);
    rmSync(join(root, ".opencode/standards/rust.md"));
    await commit("chore: customise the factory");
    const before = await trackedContents();
    const head = await gitOut(root, "rev-parse", "HEAD");

    const dry = await cli(root, "update", "--dry-run");
    expect(dry.code).toBe(ExitCode.Ok);
    expect(dry.out).toContain(`update ${SNAPSHOT.version} → ${FACTORY_VERSION}`);
    expect(dry.out).toContain("config migrations: 001-graph-exclude-defaults, 002-config-v3");
    expect(dry.out).toContain("merge with your edits: .opencode/agents/implementer-app.md");
    // JSON lists what changes, not every file's whole content (audit G9).
    const json = await cli(root, "update", "--dry-run", "--json");
    const plan = JSON.parse(json.out) as { changes: { path: string; action: string }[] };
    expect(plan.changes.some((c) => c.path === ".opencode/agents/implementer-app.md")).toBe(true);
    expect(json.out).not.toContain("# Role: implementer");
    expect(json.out.length).toBeLessThan(20_000);
    expect(await gitOut(root, "rev-parse", "HEAD")).toBe(head);
    expect(await gitOut(root, "status", "--porcelain")).toBe("");

    const run = await cli(root, "update");
    expect(run.err).toBe("");
    expect(run.code).toBe(ExitCode.Ok);
    expect(await gitOut(root, "log", "-1", "--format=%s")).toBe(
      `chore(factory): update to v${FACTORY_VERSION}`,
    );
    expect(await gitOut(root, "rev-parse", "HEAD~1")).toBe(head);
    expect(await gitOut(root, "status", "--porcelain")).toBe("");

    // User edits survive, new template text arrives, deletions are respected.
    expect(read(".opencode/agents/tester.md")).toContain(
      "Always run `bun test` before you finish.",
    );
    const impl = read(".opencode/agents/implementer-app.md");
    expect(impl).toContain("(our team)");
    expect(impl).toContain("When the task message is about merge conflicts");
    expect(existsSync(join(root, ".opencode/standards/rust.md"))).toBe(false);
    expect(read("AGENTS.md")).toContain("Query the workspace graph before reading files");
    expect(read("AGENTS.md")).toContain("# House rules\nUse tabs.");
    // Config migrated with comments intact; lock rewritten for this version.
    expect(read("factory.config.jsonc")).toContain("// team note: models agreed on 2026-10-01");
    const config = loadConfig(root).config;
    expect(config.schemaVersion).toBe(4);
    expect(config.graph.exclude).toContain("**/vendor/**");
    const lock = readLock(root);
    expect(lock?.factoryVersion).toBe(FACTORY_VERSION);
    expect(lock?.managed[".opencode/agents/implementer-app.md"]?.templateVersion).toBe(
      FACTORY_VERSION,
    );

    expect((await cli(root, "update")).out).toContain("already up to date");

    const rollback = await cli(root, "rollback");
    expect(rollback.code).toBe(ExitCode.Ok);
    expect(await trackedContents()).toEqual(before);
    expect(await gitOut(root, "status", "--porcelain")).toBe("");
  });

  test("a conflicting edit gets markers, nothing is committed, rollback restores", async () => {
    edit(".opencode/agents/implementer-app.md", (t) =>
      t.replace(
        "- On a retry, fix exactly what the gate output reports.",
        "- On a retry, fix exactly what the gate output reports, nothing more.",
      ),
    );
    await commit("chore: tweak retries");
    const head = await gitOut(root, "rev-parse", "HEAD");
    const before = await trackedContents();

    const run = await cli(root, "update");
    expect(run.code).toBe(ExitCode.Precondition);
    expect(run.err).toContain(".opencode/agents/implementer-app.md");
    expect(read(".opencode/agents/implementer-app.md")).toContain("<<<<<<< yours");
    expect(await gitOut(root, "rev-parse", "HEAD")).toBe(head);

    expect((await cli(root, "rollback")).out).toContain("nothing to commit");
    expect(await trackedContents()).toEqual(before);
    expect(await gitOut(root, "status", "--porcelain")).toBe("");
  });

  test("warns when detection differs from the config, without applying it (audit T)", async () => {
    writeFileSync(join(root, "go.mod"), "module example.com/app\n\ngo 1.22\n");
    writeFileSync(join(root, "main.go"), "package main\n\nfunc main() {}\n");
    await commit("chore: a Go tool");
    const dry = await cli(root, "update", "--dry-run");
    expect(dry.code).toBe(ExitCode.Ok);
    expect(dry.out).toContain(
      "detection differs from the config (not applied; see `loomwright detect`)",
    );
    expect(dry.out).toContain("go");
  });

  test("never commits onto a change branch, even forced (audit P17)", async () => {
    await claimActive(root, "add-x");
    await gitOut(root, "switch", "-q", "-c", "change/add-x");
    const refused = await cli(root, "update", "--force");
    expect(refused.code).toBe(ExitCode.Precondition);
    expect(refused.err).toContain("the AI repo is on change/add-x");
    expect(refused.err).toContain("git switch");
    expect((await cli(root, "update", "--force", "--dry-run")).code).toBe(ExitCode.Ok);
    expect(await gitOut(root, "log", "-1", "--format=%s")).not.toContain("chore(factory): update");
  });

  test("refuses while a change is in progress unless forced; --restore and --tools", async () => {
    await claimActive(root, "busy-change");
    const refused = await cli(root, "update");
    expect(refused.code).toBe(ExitCode.Precondition);
    expect(refused.err).toContain("changes in progress: busy-change");
    expect((await cli(root, "update", "--force")).code).toBe(ExitCode.Ok);
    await releaseActive(root, "busy-change");

    rmSync(join(root, ".opencode/standards/go.md"));
    await commit("chore: drop go standard");
    expect((await cli(root, "update")).code).toBe(ExitCode.Ok);
    expect(existsSync(join(root, ".opencode/standards/go.md"))).toBe(false);
    const restored = await cli(root, "update", "--restore");
    expect(restored.out).toContain("create: .opencode/standards/go.md");
    expect(existsSync(join(root, ".opencode/standards/go.md"))).toBe(true);

    edit("factory.lock.json", (t) => t.replace('"schemaVersion": 1', '"schemaVersion": 0'));
    await commit("chore: pretend an old graph format");
    const tools = await cli(root, "update", "--tools");
    expect(tools.code).toBe(ExitCode.Ok);
    expect(tools.out).toContain("tools: OpenSpec's opencode files regenerated");
    expect(tools.out).toContain("graph: rebuilt");
    expect(readLock(root)?.graph.schemaVersion).toBe(1);
  });
});

describe("compatibility surface", () => {
  test.each(["0.12.0", "1.0.0"])(
    "workspace formats are unchanged: a v%s install still updates",
    async (version) => {
      const snapshot = JSON.parse(
        readFileSync(
          join(import.meta.dir, `../../../test/fixtures/install-${version}.json`),
          "utf8",
        ),
      ) as { version: string; files: Record<string, string> };
      const base = mkdtempSync(join(tmpdir(), "loomwright-previous-"));
      const root = join(base, "app");
      try {
        for (const [rel, content] of Object.entries(snapshot.files)) {
          mkdirSync(dirname(join(root, rel)), { recursive: true });
          writeFileSync(join(root, rel), content);
        }
        await fixtureGit(root, "init", "-q", "-b", "main");
        await fixtureGit(root, "add", "-A");
        await fixtureGit(root, "commit", "-q", "-m", `chore(factory): init v${snapshot.version}`);
        const initial = await gitOut(root, "rev-parse", "HEAD");

        const run = await cli(root, "update");
        expect(run.err).toBe("");
        expect(run.code).toBe(ExitCode.Ok);
        expect(await gitOut(root, "rev-list", "--count", `${initial}..HEAD`)).toBe("1");
        expect(await gitOut(root, "log", "-1", "--format=%s")).toBe(
          `chore(factory): update to v${FACTORY_VERSION}`,
        );
        expect(await gitOut(root, "status", "--porcelain")).toBe("");

        // The persisted names do not move with the brand.
        expect(existsSync(join(root, "factory.lock.json"))).toBe(true);
        expect(readLock(root)?.factoryVersion).toBe(FACTORY_VERSION);
        expect(run.out).toContain(".factory/backups/");
        expect(existsSync(join(root, ".factory", "backups"))).toBe(true);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
});

describe("activation snapshot", () => {
  test("a resumed change keeps the agent and gate definitions it started with", async () => {
    const { createSingleRepoFixture } = await import("../../../test/fixtures/workspaces.ts");
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
      const file = join(fx.root, "factory.config.jsonc");
      const pass = {
        format: "true",
        lint: "true",
        types: "true",
        test: "true",
        testAffected: "true",
      };
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          '"overrides": {}',
          `"overrides": ${JSON.stringify({ app: pass })}`,
        ),
      );
      await fixtureGit(fx.root, "commit", "-q", "-am", "chore: gates");
      const tasks: ScriptedTask[] = [
        {
          id: "1.1",
          title: "Add a helper",
          repo: "app",
          deps: [],
          touches: ["src/**"],
          file: "src/h.ts",
          content: "export const h = 1;\n",
        },
      ];
      let blocked = true;
      const runtime = new ScriptedRuntime(
        factoryScript({
          changeId: "snap-x",
          summary: "Helper",
          repos: ["app"],
          tasks,
          implement: () =>
            blocked
              ? { handoff: { status: "blocked", openQuestions: ["which file?"] } }
              : undefined,
        }),
      );
      await cliWith(runtime, fx.root, "run", "Helper");
      expect((await cliWith(runtime, fx.root, "approve", "snap-x")).code).toBe(ExitCode.Paused);
      expect(
        existsSync(join(fx.root, ".factory/worktrees/snap-x/.opencode/agents/implementer-app.md")),
      ).toBe(true);
      expect(existsSync(join(fx.root, ".factory/runs/snap-x/snapshot/gates.json"))).toBe(true);

      // The config changes under the paused change: its gates must not follow.
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace('"testAffected":"true"', '"testAffected":"false"'),
      );
      expect(readFileSync(file, "utf8")).toContain('"testAffected":"false"');
      blocked = false;
      await cli(fx.root, "retry", "snap-x", "--task", "1.1");
      expect((await cliWith(runtime, fx.root, "resume", "snap-x")).code).toBe(ExitCode.Ok);
      expect(loadRun(fx.root, "snap-x")?.phase).toBe("done");
      // Closing drops the agent snapshot with the change's worktree folders.
      expect(existsSync(join(fx.root, ".factory/worktrees/snap-x"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

describe("update and the opencode feature floor", () => {
  const fixtures: Fixture[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  /** A fresh install; `withRoles` turns on `mcp.roles`, which needs opencode 2.2.0. */
  async function freshInstall(withRoles: boolean): Promise<Fixture> {
    const fixture = await createSingleRepoFixture();
    fixtures.push(fixture);
    expect((await cli(fixture.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
    expect(readLock(fixture.root)?.tools.opencode.min).toBe("2.1.2");
    if (!withRoles) return fixture;

    const file = join(fixture.root, "factory.config.jsonc");
    const text = readFileSync(file, "utf8");
    const enabled = text.replace(
      '"mcp": { "roles": {} }',
      '"mcp": { "roles": { "implementer": ["mantine_*"] } }',
    );
    expect(enabled).not.toBe(text);
    writeFileSync(file, enabled);
    await fixtureGit(fixture.root, "add", "-A");
    await fixtureGit(fixture.root, "commit", "-q", "-m", "chore: enable mcp roles");
    return fixture;
  }

  /** Runs `update` against a stub reporting `opencode v<version>`, restoring the env after. */
  async function updateWithOpencode(fixture: Fixture, version: string): Promise<Run> {
    const script = join(fixture.base, `opencode-${version}.sh`);
    writeFileSync(script, `#!/bin/sh\necho "opencode v${version}"\n`);
    chmodSync(script, 0o755);
    const saved = process.env.AI_FACTORY_OPENCODE_BIN;
    process.env.AI_FACTORY_OPENCODE_BIN = script;
    try {
      return await cli(fixture.root, "update");
    } finally {
      if (saved === undefined) delete process.env.AI_FACTORY_OPENCODE_BIN;
      else process.env.AI_FACTORY_OPENCODE_BIN = saved;
    }
  }

  test("update warns and continues when mcp.roles needs a newer opencode", async () => {
    const fixture = await freshInstall(true);
    const run = await updateWithOpencode(fixture, "2.1.2");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("warning: opencode");
    expect(run.out).toContain("mcp.roles");
    expect(run.out).toContain("npm install --global @opencode/cli@2.2.0");
    expect(await gitOut(fixture.root, "log", "-1", "--format=%s")).toBe(
      `chore(factory): update to v${FACTORY_VERSION}`,
    );
    expect(await gitOut(fixture.root, "status", "--porcelain")).toBe("");
  });

  test("the lock records the effective floor on the update path", async () => {
    const fixture = await freshInstall(true);
    expect((await updateWithOpencode(fixture, "2.1.2")).code).toBe(ExitCode.Ok);
    const lock = readLock(fixture.root);
    expect(lock?.tools.opencode.min).toBe("2.2.0");
    expect(lock?.tools.opencode.maxExclusive).toBe("3.0.0");
  });

  test("3.0.0 fails with or without the feature: update still only warns", async () => {
    for (const withRoles of [true, false]) {
      const fixture = await freshInstall(withRoles);
      const run = await updateWithOpencode(fixture, "3.0.0");
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.out).toContain("warning: opencode");
      expect(run.out).toContain("newer than supported");
    }
  });

  test("an opencode at the floor records it without a warning", async () => {
    const fixture = await freshInstall(true);
    const run = await updateWithOpencode(fixture, "2.2.0");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).not.toContain("warning: opencode");
    expect(readLock(fixture.root)?.tools.opencode.min).toBe("2.2.0");
  });
});
