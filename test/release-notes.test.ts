import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..");
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

interface Changeset {
  readonly name: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

interface Section {
  readonly heading: string;
  readonly body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChangesets(): Changeset[] {
  const dir = join(ROOT, ".changeset");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const match = FRONTMATTER.exec(readFileSync(join(dir, name), "utf8"));
      const frontmatter = match?.[1] === undefined ? null : parse(match[1]);
      if (match === null || !isRecord(frontmatter)) {
        throw new Error(`${name} has no frontmatter mapping`);
      }
      return { name, frontmatter, body: match[2] ?? "" };
    });
}

function changelogSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      if (current !== undefined) {
        sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      }
      current = { heading: line.slice(3).trim(), lines: [] };
    } else {
      current?.lines.push(line);
    }
  }
  if (current !== undefined) {
    sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  }
  return sections;
}

describe("release notes", () => {
  test("the changeset records the breaking rename", () => {
    const changeset = readChangesets().find(
      (entry) => entry.frontmatter["@loomwright/cli"] === "major",
    );
    expect(changeset).toBeDefined();
    expect(changeset?.body).toContain("loomwright");
    expect(changeset?.body).toContain("ai-factory");
  });

  test("the new changelog section announces the rename", () => {
    const sections = changelogSections(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    const first = sections[0];
    expect(first).toBeDefined();
    expect(first?.heading).toBe("Unreleased");
    expect(first?.body).toContain("@loomwright/cli");
    expect(first?.body).toContain("loomwright");
    expect(first?.body).toContain("ai-factory");
    expect(sections.some((section) => section.heading === "0.12.0")).toBe(true);
  });

  test("past changelog entries are preserved", () => {
    const sections = changelogSections(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    const released = sections.find((section) => section.heading === "0.12.0");
    expect(released?.body).toContain(
      "Reviewers and contract reviewers are now told to set `file` to the change's spec path",
    );
    for (const section of sections.slice(1)) {
      expect(section.body).not.toContain("Loomwright");
    }
  });
});
