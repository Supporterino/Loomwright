/**
 * Literal text of every call whose callee is an execution primitive, in source order.
 *
 * Comments are dropped, string and template text is blanked from the code pass, and `${…}`
 * bodies are lexed as code. Regex literals are not told apart from division: a `//` or `/*`
 * inside one may be read as a comment, which is accepted (see the `agent-shell-guard` design).
 */
export function execSinkLiterals(source: string): string[] {
  const results: Sink[] = [];
  const sinks: Array<Sink | undefined> = [];
  const templates: TemplateFrame[] = [];
  let mode: Mode = "code";
  let i = 0;
  let prevWord: string | undefined;
  let stringQuote = "";
  let stringSink: Sink | undefined;
  let stringText = "";

  const currentSink = (): Sink | undefined => sinks.at(-1);

  const addPart = (sink: Sink | undefined, text: string): void => {
    if (sink === undefined) return;
    if (sink.glue) sink.text += text;
    else if (text.trim() !== "") sink.text = sink.text === "" ? text : `${sink.text} ${text}`;
    sink.glue = false;
    sink.afterPart = true;
  };

  /** A token that is neither whitespace, a comment nor `+` ends a `+` chain. */
  const breakChain = (sink: Sink | undefined): void => {
    if (sink === undefined) return;
    sink.glue = false;
    sink.afterPart = false;
  };

  const openSink = (): Sink => {
    const sink: Sink = { text: "", glue: false, afterPart: false };
    results.push(sink);
    return sink;
  };

  while (i < source.length) {
    const ch = source[i] ?? "";

    if (mode === "line") {
      if (ch === "\n") mode = "code";
      i += 1;
      continue;
    }

    if (mode === "block") {
      if (ch === "*" && source[i + 1] === "/") {
        mode = "code";
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (mode === "string") {
      if (ch === "\\") {
        const next = source[i + 1];
        if (next !== undefined) stringText += next;
        i += next === undefined ? 1 : 2;
      } else if (ch === stringQuote) {
        addPart(stringSink, stringText);
        stringSink = undefined;
        stringText = "";
        mode = "code";
        i += 1;
      } else {
        stringText += ch;
        i += 1;
      }
      continue;
    }

    if (mode === "template") {
      const frame = templates.at(-1);
      if (frame === undefined) {
        mode = "code";
        continue;
      }
      if (ch === "\\") {
        const next = source[i + 1];
        if (next !== undefined) frame.text += next;
        i += next === undefined ? 1 : 2;
      } else if (ch === "`") {
        addPart(frame.sink, frame.text);
        templates.pop();
        sinks.pop();
        prevWord = undefined;
        mode = "code";
        i += 1;
      } else if (ch === "$" && source[i + 1] === "{") {
        addPart(frame.sink, frame.text);
        frame.text = "";
        frame.depth = 1;
        prevWord = undefined;
        mode = "code";
        i += 2;
      } else {
        frame.text += ch;
        i += 1;
      }
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      stringQuote = ch;
      stringSink = currentSink();
      stringText = "";
      prevWord = undefined;
      mode = "string";
      i += 1;
      continue;
    }
    if (ch === "`") {
      const tag = prevWord;
      const sink = tag !== undefined && EXEC_PRIMITIVES.has(tag) ? openSink() : currentSink();
      sinks.push(sink);
      templates.push({ sink, depth: 0, text: "" });
      prevWord = undefined;
      mode = "template";
      i += 1;
      continue;
    }
    if (ch === "(") {
      const callee = prevWord;
      const sink = callee !== undefined && EXEC_PRIMITIVES.has(callee) ? openSink() : currentSink();
      sinks.push(sink);
      breakChain(sink);
      prevWord = undefined;
      i += 1;
      continue;
    }
    if (ch === ")") {
      sinks.pop();
      breakChain(currentSink());
      prevWord = undefined;
      i += 1;
      continue;
    }
    if (ch === "{") {
      const frame = templates.at(-1);
      if (frame !== undefined && frame.depth > 0) frame.depth += 1;
      breakChain(currentSink());
      prevWord = undefined;
      i += 1;
      continue;
    }
    if (ch === "}") {
      const frame = templates.at(-1);
      if (frame !== undefined && frame.depth > 0) {
        frame.depth -= 1;
        if (frame.depth === 0) mode = "template";
      }
      breakChain(currentSink());
      prevWord = undefined;
      i += 1;
      continue;
    }
    if (ch === "+") {
      const sink = currentSink();
      if (sink !== undefined) {
        sink.glue = sink.afterPart;
        sink.afterPart = false;
      }
      prevWord = undefined;
      i += 1;
      continue;
    }
    if (isIdentChar(ch)) {
      const start = i;
      while (i < source.length && isIdentChar(source[i] ?? "")) i += 1;
      breakChain(currentSink());
      prevWord = source.slice(start, i);
      continue;
    }
    breakChain(currentSink());
    prevWord = undefined;
    i += 1;
  }

  if (mode === "string") addPart(stringSink, stringText);
  const tail = templates.at(-1);
  if (tail !== undefined) addPart(tail.sink, tail.text);

  return results.map((sink) => sink.text.trim());
}

type Mode = "code" | "string" | "line" | "block" | "template";

interface Sink {
  /** Literal text of this call so far, parts separated by a space unless glued by `+`. */
  text: string;
  /** The next literal part is joined with `+`, so it appends without a separator. */
  glue: boolean;
  /** The previous significant token was a literal part, so a following `+` concatenates. */
  afterPart: boolean;
}

interface TemplateFrame {
  readonly sink: Sink | undefined;
  depth: number;
  text: string;
}

const EXEC_PRIMITIVES: ReadonlySet<string> = new Set([
  "exec",
  "execFile",
  "execSync",
  "execFileSync",
  "spawn",
  "spawnSync",
  "system",
  "eval",
  "Function",
  "sh",
  "$",
]);

function isIdentChar(ch: string): boolean {
  return ch === "$" || ch === "_" || /[A-Za-z0-9]/.test(ch);
}
