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

function readChangelog(): Section[] {
  return changelogSections(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
}

// `changeset version` prepends the released section above a stale `Unreleased` one, so the
// newest entry is always the first section before `## 0.12.0`.
function newestSection(sections: Section[]): Section | undefined {
  const released = sections.findIndex((section) => section.heading === "0.12.0");
  return released > 0 ? sections[0] : undefined;
}

describe("release notes", () => {
  test("the changeset records the breaking rename", () => {
    const changeset = readChangesets().find(
      (entry) => entry.frontmatter["@loomwright/cli"] === "major",
    );
    // Releasing deletes the changeset; the released section then carries the same note.
    const recorded = changeset?.body ?? newestSection(readChangelog())?.body;
    expect(recorded).toContain("loomwright");
    expect(recorded).toContain("ai-factory");
  });

  test("the new changelog section announces the rename", () => {
    const sections = readChangelog();
    expect(sections.some((section) => section.heading === "0.12.0")).toBe(true);
    const first = newestSection(sections);
    expect(first).toBeDefined();
    expect(first?.body).toContain("@loomwright/cli");
    expect(first?.body).toContain("loomwright");
    expect(first?.body).toContain("ai-factory");
  });

  test("past changelog entries are preserved", () => {
    const sections = readChangelog();
    const released = sections.findIndex((section) => section.heading === "0.12.0");
    expect(released).toBeGreaterThan(-1);
    const kept = sections.slice(released < 0 ? sections.length : released);
    expect(kept[0]?.body).toContain(
      "Reviewers and contract reviewers are now told to set `file` to the change's spec path",
    );
    for (const section of kept) {
      expect(section.body).not.toContain("Loomwright");
    }
  });
});
