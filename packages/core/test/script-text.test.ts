import { describe, expect, test } from "bun:test";
import { execSinkLiterals } from "../src/policy/script-text.ts";

const scan = (source: string): string[] => execSinkLiterals(source);

describe("script text", () => {
  test("a real spawn of `git push` in the file yields a scannable literal", () => {
    expect(scan('execSync("git push")')).toEqual(["git push"]);
  });

  test("nested property callees count by their last segment", () => {
    expect(scan('cp.execFileSync("git", ["push"])')).toEqual(["git push"]);
  });

  test("literals of one spawn call are joined before the scan", () => {
    expect(scan('spawnSync(["git", "push"])')).toEqual(["git push"]);
  });

  test("tagged templates are execution primitive calls", () => {
    expect(scan("$`git push`")).toEqual(["git push"]);
    expect(scan("sh`git push`")).toEqual(["git push"]);
  });

  test("`$` as a plain call is an execution primitive", () => {
    expect(scan('$("git push")')).toEqual(["git push"]);
  });

  test("adjacent literals keep a separator", () => {
    expect(scan('execSync("git " + "push")')).toEqual(["git push"]);
  });

  test("adjacent `+` literals concatenate without a space", () => {
    expect(scan('spawnSync("git", ["pu" + "sh"])')).toEqual(["git push"]);
    expect(scan('execSync("gi" + "t " + "push")')).toEqual(["git push"]);
    expect(scan('execSync("git" + " " + "push")')).toEqual(["git push"]);
  });

  test("prose passed to a non-execution call does not block", () => {
    expect(scan('console.log("git push")')).toEqual([]);
    expect(scan('note(["git push"])')).toEqual([]);
    expect(scan('const s = "git push";')).toEqual([]);
    expect(scan('note("the guard blocks git push")')).toEqual([]);
  });

  test("a comment does not block in any script type", () => {
    expect(scan("// git push\n")).toEqual([]);
    expect(scan("/* git push */")).toEqual([]);
    expect(scan("/**\n * git push\n */")).toEqual([]);
  });

  test("a comment inside a sink call is dropped, not the literal", () => {
    expect(scan('execSync(/* x */ "ls")')).toEqual(["ls"]);
  });

  test("interpolation bodies are lexed as code", () => {
    const interpolated = (body: string): string => `const s = \`x \${${body}} y\`;`;
    expect(scan(interpolated('execSync("git push")'))).toEqual(["git push"]);
    expect(scan("const t = `git push`;")).toEqual([]);
    expect(scan(interpolated('"git push"'))).toEqual([]);
  });

  test("regex literals and division do not crash or produce literals", () => {
    expect(scan("const r = a / b / c;")).toEqual([]);
    expect(scan("const re = /ab+/;")).toEqual([]);
  });

  test("escaped quotes in a sink literal stay scannable", () => {
    expect(scan('execSync("a\\"git push")')).toEqual(['a"git push']);
  });

  test("empty source yields no literals", () => {
    expect(scan("")).toEqual([]);
  });

  test("an unclosed literal does not throw", () => {
    expect(() => scan('execSync("git push')).not.toThrow();
  });
});
