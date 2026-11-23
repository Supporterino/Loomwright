import { describe, expect, test } from "bun:test";
import { helpKeys, helpPanel } from "../src/help.ts";
import type { KeyInput } from "../src/model/keys.ts";

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    ctrl: false,
    shift: false,
    meta: false,
    pageUp: false,
    pageDown: false,
    delete: false,
    backspace: false,
    ...overrides,
  };
}

describe("help", () => {
  test("the help panel lists the keys and offers close and quit", () => {
    const panel = helpPanel();
    expect(panel.kind).toBe("help");
    expect(panel.title).toBe("Help");
    for (const line of ["n start a new change", "? help", "q quit"])
      expect(panel.lines).toContain(line);
    expect(panel.keys.map((hint) => `${hint.key} ${hint.label}`)).toEqual(["Esc close", "q quit"]);
    expect(panel.notice).toBeNull();
  });

  test("the help panel names l as the land key for a done run", () => {
    const line = helpPanel().lines.find((candidate) => candidate.startsWith("l "));
    expect(line).toBeDefined();
    expect(line).toContain("l");
    expect(line).toContain("land");
  });

  test("Esc closes help and q quits while it is open", () => {
    expect(helpKeys("", key({ escape: true }))).toBe("close");
    expect(helpKeys("q", key())).toBe("quit");
    expect(helpKeys("q", key({ ctrl: true }))).toBe("none");
    expect(helpKeys("?", key())).toBe("none");
  });
});
