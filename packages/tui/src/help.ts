/** The help panel behind `?`: a static key map, pure so `entry.tsx` owns when it is open. */
import type { KeyInput } from "./model/keys.ts";
import type { PanelView } from "./model/view-model.ts";
import { keyHint } from "./strings.ts";

const HELP_LINES: readonly string[] = [
  "n start a new change",
  "Tab intake text/file mode",
  "Enter open the selected run or task; confirm",
  "Esc back out of a panel; cancel",
  "j / k move the selection",
  "a approve and run",
  "A approve only",
  "w reword",
  "R reapprove",
  "r resume",
  "x abort",
  "t retry the selected failed task",
  "Q questions",
  "? help",
  "q quit",
];

export function helpPanel(): PanelView {
  return {
    kind: "help",
    title: "Help",
    lines: HELP_LINES,
    keys: [keyHint("Esc", "close"), keyHint("q", "quit")],
    notice: null,
  };
}

/** Esc closes the panel; q quits; every other key stays inert. */
export function helpKeys(input: string, key: KeyInput): "close" | "quit" | "none" {
  if (key.escape) return "close";
  if (!key.ctrl && input === "q") return "quit";
  return "none";
}
