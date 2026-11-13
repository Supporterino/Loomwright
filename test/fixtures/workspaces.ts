import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitOk } from "../../src/exec.ts";

/**
 * Fixture workspaces from §13, created in temp dirs:
 * (a) a single-repo TS project;
 * (b) an AI repo with three local bare-repo submodules (Go backend with OpenAPI,
 *     React frontend consuming it, Helm chart).
 *
 * Building a fixture costs 50ms (single) to 900ms (submodules), mostly git processes, so
 * each shape is built once per test process in a template directory and every test gets a
 * byte copy of it. Copies are independent; the submodule git configs are re-pointed at the
 * copy, because git stores those URLs as absolute paths.
 */

export const FIXTURE_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export type Files = Readonly<Record<string, string>>;

export function writeFiles(root: string, files: Files): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function fixtureGit(cwd: string, ...args: string[]): Promise<string> {
  return gitOk(["-c", "protocol.file.allow=always", ...args], { cwd, env: FIXTURE_GIT_ENV });
}

async function initRepo(dir: string, files: Files): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFiles(dir, files);
  await fixtureGit(dir, "init", "-q", "-b", "main");
  await fixtureGit(dir, "add", "-A");
  await fixtureGit(dir, "commit", "-q", "--allow-empty", "-m", "chore: initial commit");
}

/** Creates a bare repo seeded with `files`; returns its path. */
export async function bareRepo(base: string, name: string, files: Files): Promise<string> {
  const seed = join(base, "seed", name);
  await initRepo(seed, files);
  const bare = join(base, "remotes", `${name}.git`);
  await fixtureGit(base, "clone", "-q", "--bare", seed, bare);
  rmSync(seed, { recursive: true, force: true });
  return bare;
}

export interface Fixture {
  /** The workspace root (repo root or AI repo root). */
  readonly root: string;
  /** Temp dir holding the workspace and any bare remotes. */
  readonly base: string;
  cleanup(): void;
}

function tempBase(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `ai-factory-${prefix}-`));
}

type TemplateKind = "single" | "submodules";

const templates = new Map<TemplateKind, Promise<string>>();

/** Builds a fixture shape once per process; every test copies the result. */
function template(kind: TemplateKind, build: (dir: string) => Promise<void>): Promise<string> {
  const cached = templates.get(kind);
  if (cached !== undefined) return cached;
  const pending = (async () => {
    const dir = mkdtempSync(join(tmpdir(), `ai-factory-template-${kind}-`));
    process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
    await build(dir);
    return dir;
  })();
  templates.set(kind, pending);
  // A failed build must not poison every later test in the file.
  pending.catch(() => templates.delete(kind));
  return pending;
}

/** Files a copy of a template must re-point: git records submodule URLs as absolute paths. */
function pathConfigs(base: string): string[] {
  const out = [join(base, "ai", ".git", "config")];
  // Submodules live under .git/modules/<name>, where <name> can itself contain slashes
  // ("repos/backend"), and each bare remote keeps its own config.
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "objects" || name === "refs" || name === "logs") continue;
      const abs = join(dir, name);
      if (!statSync(abs).isDirectory()) continue;
      out.push(join(abs, "config"));
      walk(abs);
    }
  };
  walk(join(base, "ai", ".git", "modules"));
  walk(join(base, "remotes"));
  return out;
}

/** Rewrites the template's absolute paths inside a copy, so its submodules resolve locally. */
async function rewireTemplatePaths(base: string, templateDir: string): Promise<void> {
  const from = [...new Set([templateDir, realpathSync(templateDir)])];
  const rewrite = (abs: string): boolean => {
    if (!existsSync(abs)) return false;
    const text = readFileSync(abs, "utf8");
    let next = text;
    for (const prefix of from) next = next.split(prefix).join(base);
    if (next === text) return false;
    writeFileSync(abs, next);
    return true;
  };
  for (const abs of pathConfigs(base)) rewrite(abs);
  // `.gitmodules` is tracked, so the re-pointed URL must go into the fixture's commit too.
  if (rewrite(join(base, "ai", ".gitmodules"))) {
    await fixtureGit(join(base, "ai"), "commit", "-q", "--amend", "--no-edit", "-a");
  }
}

export const SINGLE_TS_FILES: Files = {
  "package.json": JSON.stringify(
    {
      name: "app",
      private: true,
      scripts: { lint: "biome check .", typecheck: "tsc --noEmit", test: "bun test" },
      devDependencies: { typescript: "5.9.3" },
    },
    null,
    2,
  ),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }, null, 2),
  "src/sum.ts": "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
  "src/sum.test.ts":
    'import { expect, test } from "bun:test";\nimport { sum } from "./sum";\n\ntest("sum", () => expect(sum(1, 2)).toBe(3));\n',
};

export async function createSingleRepoFixture(): Promise<Fixture> {
  const tmpl = await template("single", (dir) => initRepo(join(dir, "app"), SINGLE_TS_FILES));
  const base = tempBase("single");
  cpSync(join(tmpl, "app"), join(base, "app"), { recursive: true });
  return {
    root: join(base, "app"),
    base,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

const OPENAPI = `openapi: 3.0.3
info:
  title: Backend API
  version: 1.0.0
paths:
  /health:
    get:
      operationId: getHealth
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [status]
                properties:
                  status:
                    type: string
`;

export const BACKEND_FILES: Files = {
  "go.mod": "module example.com/backend\n\ngo 1.23\n",
  "main.go":
    'package main\n\nimport "net/http"\n\nfunc main() {\n\thttp.HandleFunc("/health", health)\n\t_ = http.ListenAndServe(":8080", nil)\n}\n',
  "health.go":
    'package main\n\nimport "net/http"\n\nfunc health(w http.ResponseWriter, _ *http.Request) {\n\tw.Header().Set("Content-Type", "application/json")\n\t_, _ = w.Write([]byte(`{"status":"ok"}`))\n}\n',
  "api/openapi.yaml": OPENAPI,
  // Test data must not be proposed as a contract.
  "testdata/legacy-openapi.yaml": "openapi: 3.0.0\ninfo: {title: old, version: '0'}\npaths: {}\n",
};

export const FRONTEND_FILES: Files = {
  "package.json": JSON.stringify(
    {
      name: "frontend",
      private: true,
      scripts: {
        "gen:api": "openapi-typescript ../backend/api/openapi.yaml -o src/api.d.ts",
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "vitest run",
      },
      dependencies: { react: "19.2.0", "react-dom": "19.2.0" },
      devDependencies: { typescript: "5.9.3", vitest: "4.0.0" },
    },
    null,
    2,
  ),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, jsx: "react-jsx" } }, null, 2),
  "src/App.tsx": "export function App() {\n  return <h1>Hello</h1>;\n}\n",
};

export const DEPLOY_FILES: Files = {
  "charts/app/Chart.yaml": "apiVersion: v2\nname: app\nversion: 0.1.0\n",
  "charts/app/values.yaml":
    "image:\n  repository: registry.example.com/backend\n  tag: latest\nreplicas: 1\n",
  "charts/app/values.schema.json": JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["image", "replicas"],
      properties: {
        image: {
          type: "object",
          properties: { repository: { type: "string" }, tag: { type: "string" } },
        },
        replicas: { type: "integer", minimum: 1 },
      },
    },
    null,
    2,
  ),
  "charts/app/templates/deployment.yaml":
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\nspec:\n  replicas: {{ .Values.replicas }}\n",
};

async function buildSubmoduleTemplate(dir: string): Promise<void> {
  const remotes = {
    backend: await bareRepo(dir, "backend", BACKEND_FILES),
    frontend: await bareRepo(dir, "frontend", FRONTEND_FILES),
    deploy: await bareRepo(dir, "deploy", DEPLOY_FILES),
  };
  const root = join(dir, "ai");
  await initRepo(root, { "README.md": "# AI repo\n" });
  for (const [name, url] of Object.entries(remotes)) {
    await fixtureGit(root, "submodule", "add", "-q", url, `repos/${name}`);
  }
  await fixtureGit(root, "commit", "-q", "-m", "chore: add submodules");
}

export async function createSubmoduleFixture(): Promise<Fixture> {
  const tmpl = await template("submodules", buildSubmoduleTemplate);
  const base = tempBase("submodules");
  cpSync(tmpl, base, { recursive: true });
  await rewireTemplatePaths(base, tmpl);
  return {
    root: join(base, "ai"),
    base,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}
