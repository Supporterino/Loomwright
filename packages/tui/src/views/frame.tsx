import { Box, render } from "ink";
import type { ReactElement } from "react";
import type { ViewModel } from "../model/view-model.ts";
import { type GlyphSet, glyphsFor } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { KeyFooter } from "./footer.tsx";
import { PanelBox } from "./panel.tsx";
import { RunList } from "./run-list.tsx";
import { RunView } from "./run-view.tsx";

export interface FrameProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

export interface FrameSize {
  readonly columns: number;
  readonly rows: number;
}

export function Frame({ viewModel, glyphs, depth }: FrameProps): ReactElement {
  return (
    <Box flexDirection="column" width={viewModel.columns} height={viewModel.rows}>
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {viewModel.panel !== null ? (
          <PanelBox panel={viewModel.panel} glyphs={glyphs} depth={depth} />
        ) : viewModel.screen === "list" ? (
          <RunList viewModel={viewModel} glyphs={glyphs} depth={depth} />
        ) : (
          <RunView
            viewModel={viewModel}
            glyphs={glyphs}
            depth={depth}
            twoPane={viewModel.twoPane}
          />
        )}
      </Box>
      <KeyFooter hints={viewModel.footer} glyphs={glyphs} depth={depth} />
    </Box>
  );
}

// Built from the code point so the token module stays the only place with SGR literals.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Mounts the tree into an in-memory stdout, waits one tick for layout, unmounts and returns the
 * plain text of the final frame: no ANSI, no trailing spaces, no trailing blank lines.
 */
export async function renderFrame(
  viewModel: ViewModel,
  size: FrameSize,
  options: { ascii?: boolean } = {},
): Promise<string> {
  const chunks: string[] = [];
  const stdout = {
    columns: size.columns,
    rows: size.rows,
    isTTY: false,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
    on(): void {},
    off(): void {},
  };
  const stdin = {
    isTTY: false,
    on(): void {},
    off(): void {},
    setRawMode(): void {},
    resume(): void {},
    pause(): void {},
  };
  const sized: ViewModel = {
    ...viewModel,
    columns: size.columns,
    rows: size.rows,
    twoPane: size.columns >= 100,
  };
  // shortcut: Ink reads only these fields from the alternate streams; replace with real streams
  // if a future Ink release grows the interface.
  const instance = render(
    <Frame viewModel={sized} glyphs={glyphsFor(options.ascii ?? false)} depth="none" />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  instance.unmount();
  // Ink's throttled log writes the frame twice (leading and trailing); the last write is the
  // complete frame, and earlier ones are the same text with erase sequences in front.
  return (chunks.at(-1) ?? "")
    .split("\n")
    .map((line) => stripAnsi(line).replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}
