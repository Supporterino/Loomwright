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
import { join } from "node:path";
import { createSingleRepoFixture } from "../../../test/fixtures/workspaces.ts";
import { gitOut } from "../../../test/helpers.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { ExecError } from "../src/errors.ts";
import { buildLock, LOCK_FILE, readLock, serializeLock } from "../src/lock/lock.ts";
import { sha256 } from "../src/managed/sync.ts";
import {
  archiveChange,
  OPENSPEC_TOOLS_TEMPLATE,
  renderOpenspecTools,
  validateChange,
} from "../src/openspec/cli.ts";
import { commitInstall, INSTALL_PATHS, syncWorkspace } from "../src/workspace/sync.ts";

const M = "anthropic/claude-sonnet-5-5";

function config(): FactoryConfig {
  return FactoryConfig.parse({
    schemaVersion: 2,
    layout: "single",
    repos: [{ name: "app", path: ".", languages: ["typescript"] }],
    models: { orchestrator: M, architect: M, reviewer: M, implementer: M, tester: M, explorer: M },
  });
}

function quote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

interface Stub {
  readonly path: string;
  target(): string;
  args(): string[];
}

describe("renderOpenspecTools follows the installed OpenSpec layout", () => {
  // test/setup.ts pins this to the real devDependency; restore that exact value, never delete it.
  const saved = process.env.AI_FACTORY_OPENSPEC_BIN;
  let base: string;
  let root: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "factory-openspec-2-"));
    root = join(base, "workspace");
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.AI_FACTORY_OPENSPEC_BIN;
    else process.env.AI_FACTORY_OPENSPEC_BIN = saved;
    rmSync(base, { recursive: true, force: true });
  });

  function writeStub(version: string, init: string, exitCode = 0): Stub {
    const argsFile = join(base, "args.txt");
    const targetFile = join(base, "target.txt");
    const path = join(base, "openspec-stub.sh");
    writeFileSync(
      path,
      `#!/bin/sh
case "$1" in
  --version) echo "openspec ${version}" ;;
  init)
    printf '%s\\n' "$@" >> ${quote(argsFile)}
    target=""
    for a in "$@"; do target="$a"; done
    printf '%s\\n' "$target" > ${quote(targetFile)}
${init}
    exit ${exitCode}
    ;;
esac
`,
    );
    chmodSync(path, 0o755);
    return {
      path,
      target: () => readFileSync(targetFile, "utf8").trim(),
      args: () => readFileSync(argsFile, "utf8").trim().split("\n"),
    };
  }

  function use(stub: Stub): Stub {
    process.env.AI_FACTORY_OPENSPEC_BIN = stub.path;
    return stub;
  }

  function expectScope(stub: Stub, scoped: boolean): void {
    const args = stub.args();
    const at = args.indexOf("--scope");
    if (scoped) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(args[at + 1]).toBe("project");
    } else {
      expect(at).toBe(-1);
    }
    expect(args.at(-1)).toBe(stub.target());
  }

  function expectTools(files: Awaited<ReturnType<typeof renderOpenspecTools>>): void {
    for (const file of files) {
      expect(file.template).toBe(OPENSPEC_TOOLS_TEMPLATE);
      expect(file.mode).toBe("file");
    }
  }

  const AGENTS_SKILLS = `
    mkdir -p "$target/.agents/skills/openspec-propose" "$target/.agents/skills/openspec/references"
    echo "skill" > "$target/.agents/skills/openspec-propose/SKILL.md"
    echo "router" > "$target/.agents/skills/openspec/SKILL.md"
    echo "ref" > "$target/.agents/skills/openspec/references/status.md"`;

  test("2.2 writes skills under .agents", async () => {
    const stub = use(writeStub("2.2.0", AGENTS_SKILLS));
    const files = await renderOpenspecTools(root);
    expect(files.map((f) => f.path).sort()).toEqual(
      [
        ".agents/skills/openspec-propose/SKILL.md",
        ".agents/skills/openspec/SKILL.md",
        ".agents/skills/openspec/references/status.md",
      ].sort(),
    );
    expectTools(files);
    expectScope(stub, true);
    expect(stub.target()).toContain("ai-factory-openspec-");
  });

  test("2.2 also keeps any .opencode output", async () => {
    const stub = use(
      writeStub(
        "2.2.0",
        `
    mkdir -p "$target/.opencode" "$target/.agents/skills/openspec"
    echo "{}" > "$target/.opencode/opencode.jsonc"
    echo "router" > "$target/.agents/skills/openspec/SKILL.md"`,
      ),
    );
    const files = await renderOpenspecTools(root);
    expect(files.map((f) => f.path).sort()).toEqual(
      [".agents/skills/openspec/SKILL.md", ".opencode/opencode.jsonc"].sort(),
    );
    expectTools(files);
    expectScope(stub, true);
  });

  test("2.1.0 also gets --scope project", async () => {
    const stub = use(writeStub("2.1.0", AGENTS_SKILLS));
    const files = await renderOpenspecTools(root);
    expect(files.map((f) => f.path)).toContain(".agents/skills/openspec/SKILL.md");
    expectScope(stub, true);
  });

  test("2.0.0 gets no --scope but still returns .agents paths", async () => {
    const stub = use(writeStub("2.0.0", AGENTS_SKILLS));
    const files = await renderOpenspecTools(root);
    expect(files.map((f) => f.path)).toContain(".agents/skills/openspec/SKILL.md");
    expectScope(stub, false);
  });

  test("1.x keeps the current invocation", async () => {
    const stub = use(
      writeStub(
        "1.14.3",
        `
    mkdir -p "$target/.opencode/commands"
    echo "command" > "$target/.opencode/commands/opsx-propose.md"`,
      ),
    );
    const files = await renderOpenspecTools(root);
    expect(files.map((f) => f.path)).toEqual([".opencode/commands/opsx-propose.md"]);
    expectTools(files);
    expectScope(stub, false);
  });

  test("a failed init is reported and cleaned up", async () => {
    const stub = use(writeStub("2.2.0", "", 1));
    await expect(renderOpenspecTools(root)).rejects.toBeInstanceOf(ExecError);
    expect(existsSync(stub.target())).toBe(false);
  });
});

describe("the OpenSpec command wrappers keep their contracts", () => {
  // test/setup.ts pins this to the real devDependency; restore that exact value, never delete it.
  const saved = process.env.AI_FACTORY_OPENSPEC_BIN;
  let base: string;
  let root: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "factory-openspec-wrapper-"));
    root = join(base, "workspace");
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.AI_FACTORY_OPENSPEC_BIN;
    else process.env.AI_FACTORY_OPENSPEC_BIN = saved;
    rmSync(base, { recursive: true, force: true });
  });

  function useStub(stdout: string): void {
    const path = join(base, "openspec-stub.sh");
    writeFileSync(
      path,
      `#!/bin/sh
case "$1" in
  validate|archive)
    printf '%s\\n' ${quote(stdout)}
    exit 0
    ;;
esac
`,
    );
    chmodSync(path, 0o755);
    process.env.AI_FACTORY_OPENSPEC_BIN = path;
  }

  test("a 2.x change validates", async () => {
    useStub(`{"items":[{"id":"add-health","valid":true,"issues":[]}]}`);
    expect(await validateChange(root, root, "add-health")).toEqual([]);
  });

  test("2.x validation issues keep their path", async () => {
    useStub(
      `{"items":[{"id":"add-health","valid":false,"issues":[{"level":"error","path":"specs/a/spec.md","message":"missing scenario"}]}]}`,
    );
    const issues = await validateChange(root, root, "add-health");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("specs/a/spec.md");
    expect(issues[0]).toContain("missing scenario");
  });

  test("a 2.x archive names its archive path", async () => {
    useStub(`{"archive":{"archivedAs":"2026-11-26-add-health"}}`);
    expect(await archiveChange(root, root, "add-health")).toBe("2026-11-26-add-health");
  });

  test("non-JSON validate output still fails readably", async () => {
    useStub("plain text instead of JSON");
    const issues = await validateChange(root, root, "add-health");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toStartWith("openspec validate failed:");
  });
});

describe("the .agents tree is installed, managed and protected", () => {
  test("the install path includes .agents", async () => {
    expect(INSTALL_PATHS).toContain(".agents");
    const fx = await createSingleRepoFixture();
    try {
      const skill = ".agents/skills/openspec/SKILL.md";
      mkdirSync(join(fx.root, ".agents/skills/openspec"), { recursive: true });
      writeFileSync(join(fx.root, skill), "router\n");
      expect(await commitInstall(fx.root, "chore(factory): init")).toBeDefined();
      const committed = await gitOut(fx.root, "show", "--name-only", "--pretty=format:", "HEAD");
      expect(committed.split("\n")).toContain(skill);
    } finally {
      fx.cleanup();
    }
  });

  test("a carried tools entry survives a plain update: an edited skill is kept", async () => {
    const fx = await createSingleRepoFixture();
    try {
      const skill = ".agents/skills/openspec/SKILL.md";
      const generated = "generated router\n";
      const edited = "the team's router\n";
      mkdirSync(join(fx.root, ".agents/skills/openspec"), { recursive: true });
      writeFileSync(join(fx.root, skill), edited);
      const entry = {
        template: OPENSPEC_TOOLS_TEMPLATE,
        templateVersion: "1.0.0",
        mode: "file" as const,
        sha256: sha256(generated),
        blob: "b".repeat(40),
      };
      writeFileSync(join(fx.root, LOCK_FILE), serializeLock(buildLock({ [skill]: entry })));

      const result = await syncWorkspace(fx.root, config());
      expect(result.lock.managed[skill]).toEqual(entry);
      expect(readLock(fx.root)?.managed[skill]).toEqual(entry);
      expect(readFileSync(join(fx.root, skill), "utf8")).toBe(edited);
    } finally {
      fx.cleanup();
    }
  });
});
