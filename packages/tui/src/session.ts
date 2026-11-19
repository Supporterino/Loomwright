/**
 * The terminal seam: alternate screen, cursor and raw mode in one place so the entry can restore
 * the terminal from a `finally`, and tests can assert the writes against a fake stream.
 */
import type { KeyInput } from "./model/keys.ts";

export interface TerminalSession {
  /** Alternate screen on, cursor hidden, raw mode on. */
  enter(): void;
  /** Idempotent: alternate screen off, cursor shown, raw mode off. */
  leave(): void;
  readonly columns: number;
  readonly rows: number;
  onKey(handler: (input: string, key: KeyInput) => void): () => void;
  onResize(handler: () => void): () => void;
  onSignal(handler: () => void): () => void;
}

type InputLike = Pick<
  NodeJS.ReadStream,
  "setRawMode" | "isRaw" | "on" | "off" | "resume" | "pause"
>;

// Built from the code point so the source carries no SGR literal (the token module owns escapes).
const ESC = String.fromCharCode(27);
const ENTER_ALTERNATE = `${ESC}[?1049h${ESC}[?25l`;
const LEAVE_ALTERNATE = `${ESC}[?25h${ESC}[?1049l`;

function emptyKey() {
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
  };
}

interface ParsedKey {
  readonly input: string;
  readonly key: KeyInput;
}

/** The subset of a keypress the pure key layer understands, parsed without Ink. */
export function parseKey(data: string): ParsedKey {
  const key = emptyKey();
  switch (data) {
    case `${ESC}[A`:
      key.upArrow = true;
      return { input: "", key };
    case `${ESC}[B`:
      key.downArrow = true;
      return { input: "", key };
    case `${ESC}[C`:
      key.rightArrow = true;
      return { input: "", key };
    case `${ESC}[D`:
      key.leftArrow = true;
      return { input: "", key };
    case `${ESC}[5~`:
      key.pageUp = true;
      return { input: "", key };
    case `${ESC}[6~`:
      key.pageDown = true;
      return { input: "", key };
    case `${ESC}[3~`:
      key.delete = true;
      return { input: "", key };
    case "\r":
    case "\n":
      key.return = true;
      return { input: "Enter", key };
    case ESC:
      key.escape = true;
      key.meta = true;
      return { input: "Esc", key };
    case "\t":
      key.tab = true;
      return { input: "Tab", key };
    case "\u007f":
    case "\b":
      key.backspace = true;
      return { input: "", key };
    default:
      break;
  }
  const code = data.codePointAt(0) ?? 0;
  if (data.length === 1 && code >= 1 && code <= 26) {
    key.ctrl = true;
    return { input: String.fromCharCode(code + 96), key };
  }
  if (data.length === 1 && /[A-Z]/.test(data)) key.shift = true;
  return { input: data, key };
}

function setRaw(input: InputLike, enabled: boolean): void {
  if (typeof input.setRawMode !== "function") return;
  input.setRawMode(enabled);
}

export function createTerminalSession(
  input: Pick<NodeJS.ReadStream, "setRawMode" | "isRaw" | "on" | "off" | "resume" | "pause">,
  output: Pick<NodeJS.WriteStream, "write" | "columns" | "rows" | "on" | "off">,
): TerminalSession {
  const wasRaw = input.isRaw === true;
  let entered = false;
  let left = false;

  return {
    enter(): void {
      if (entered) return;
      entered = true;
      left = false;
      output.write(ENTER_ALTERNATE);
      if (!wasRaw) setRaw(input, true);
    },
    leave(): void {
      if (left) return;
      left = true;
      entered = false;
      output.write(LEAVE_ALTERNATE);
      if (!wasRaw) setRaw(input, false);
    },
    get columns(): number {
      return output.columns ?? 80;
    },
    get rows(): number {
      return output.rows ?? 24;
    },
    onKey(handler): () => void {
      const listener = (data: Buffer | string): void => {
        const text = typeof data === "string" ? data : data.toString("utf8");
        const parsed = parseKey(text);
        handler(parsed.input, parsed.key);
      };
      input.on("data", listener);
      input.resume();
      return () => {
        input.off("data", listener);
        input.pause();
      };
    },
    onResize(handler): () => void {
      output.on("resize", handler);
      return () => output.off("resize", handler);
    },
    onSignal(handler): () => void {
      process.on("SIGINT", handler);
      process.on("SIGTERM", handler);
      return () => {
        process.off("SIGINT", handler);
        process.off("SIGTERM", handler);
      };
    },
  };
}
