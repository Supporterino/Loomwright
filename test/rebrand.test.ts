import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { renderInitialConfig } from "../src/config/render.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { agentGitEnv } from "../src/git/hooks.ts";
import { BLOCK_MARKERS, renderWorkspace } from "../src/render/workspace.ts";

const ROOT = join(import.meta.dir, "..");
const M = "anthropic/claude-sonnet-5-5";
const config = FactoryConfig.parse({
  schemaVersion: 2,
  layout: "single",
  repos: [{ name: "app", path: ".", languages: ["typescript"] }],
  models: {
    orchestrator: M,
    architect: M,
    reviewer: M,
    implementer: M,
    tester: M,
    explorer: M,
  },
});
const files = new Map(renderWorkspace(config).map((f) => [f.path, f.content]));
const content = (path: string): string => files.get(path) ?? "";
const frontmatter = (path: string): { description: string } => {
  const text = content(path);
  return parseYaml(text.split("---\n")[1] ?? "") as { description: string };
};

describe("product voice", () => {
  test("rendered agent descriptions name Loomwright", () => {
    expect(frontmatter(".opencode/agents/orchestrator.md").description).toBe(
      "Loomwright intake: request to change id and summary. No tools.",
    );
    expect(frontmatter(".opencode/agents/implementer-app.md").description).toStartWith(
      "Loomwright implementer for app",
    );
  });

  test("the AGENTS.md managed block names Loomwright", () => {
    const agents = content("AGENTS.md");
    expect(agents).toContain("## Loomwright");
    expect(agents).toContain("This workspace is driven by Loomwright");
  });

  test("generated file headers name Loomwright", () => {
    for (const path of ["openspec/config.yaml", ".graphifyignore", ".opencode/opencode.jsonc"]) {
      expect(content(path), path).toContain("Managed by Loomwright.");
      expect(content(path), path).toContain("loomwright update");
    }
    expect(content(".opencode/agents/implementer-app.md")).toContain(
      "description: Loomwright implementer for app",
    );
    expect(content(".opencode/schemas/factory.config.schema.json")).toContain(
      '"title": "Loomwright config"',
    );
    expect(content(".opencode/schemas/handoff.schema.json")).toContain(
      '"$id": "loomwright/handoff.schema.json"',
    );
  });

  test("the initial config header names Loomwright", () => {
    const text = renderInitialConfig({
      repos: [
        { name: "app", path: ".", role: "code", languages: ["typescript"], initialized: true },
      ],
      contracts: [],
      layout: "single",
      instructions: { workspace: [], repos: {} },
      e2e: [],
      tasks: [],
      notes: [],
    });
    expect(text).toStartWith("// Loomwright workspace config.");
    expect(text).toContain("`loomwright detect`");
  });
});

describe("compatibility surface", () => {
  test("managed block markers are unchanged", () => {
    expect(BLOCK_MARKERS).toEqual({
      "AGENTS.md": {
        start: "<!-- ai-factory:start (managed by ai-factory; edit outside this block) -->",
        end: "<!-- ai-factory:end -->",
      },
      ".gitignore": { start: "# ai-factory:start (managed)", end: "# ai-factory:end" },
    });
  });

  test("the plugin id is unchanged", () => {
    expect(readFileSync(join(ROOT, "templates/plugin/factory-plugin.txt"), "utf8")).toContain(
      'id: "ai-factory"',
    );
  });

  test("the agent marker environment variable is unchanged", () => {
    const env = agentGitEnv({});
    expect(env.AI_FACTORY_AGENT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("url.ai-factory-push-blocked://.pushInsteadOf");
    // Existing GIT_CONFIG_* entries are appended to, not overwritten.
    const appended = agentGitEnv({ GIT_CONFIG_COUNT: "2" });
    expect(appended.GIT_CONFIG_COUNT).toBe("3");
    expect(appended.GIT_CONFIG_KEY_2).toBe("url.ai-factory-push-blocked://.pushInsteadOf");
  });

  test("the 0.12.0 install fixture is historical and never mentions Loomwright", () => {
    const snapshot = readFileSync(join(ROOT, "test/fixtures/install-0.12.0.json"), "utf8");
    expect(snapshot).toContain("# Managed by ai-factory");
    expect(snapshot).toContain("<!-- ai-factory:start");
    expect(snapshot).not.toContain("Loomwright");
  });
});
