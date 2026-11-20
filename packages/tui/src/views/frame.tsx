import { Box, render } from "ink";
import type { ReactElement } from "react";
import { twoPaneTailRows, type ViewModel } from "../model/view-model.ts";
import { detectColorDepth, type TerminalEnv } from "../theme/env.ts";
import { type GlyphSet, glyphsFor } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { ActivityTail } from "./activity.tsx";
import { KeyFooter } from "./footer.tsx";
import { RunHeader } from "./header.tsx";
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
  const run = viewModel.run;
  return (
    <Box flexDirection="column" width={viewModel.columns} height={viewModel.rows}>
      <Box flexDirection="column" flexGrow={1}>
        {viewModel.panel !== null ? (
          <PanelBox panel={viewModel.panel} glyphs={glyphs} depth={depth} rows={viewModel.rows} />
        ) : viewModel.screen === "list" ? (
          viewModel.twoPane && run !== null ? (
            <Box flexDirection="row">
              <Box flexDirection="column" width={Math.floor(viewModel.columns / 2)}>
                <RunList viewModel={viewModel} glyphs={glyphs} depth={depth} />
              </Box>
              <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
                <RunHeader run={run} glyphs={glyphs} depth={depth} />
                <ActivityTail
                  lines={run.activity}
                  glyphs={glyphs}
                  depth={depth}
                  maxLines={twoPaneTailRows(viewModel)}
                />
              </Box>
            </Box>
          ) : (
            <RunList viewModel={viewModel} glyphs={glyphs} depth={depth} />
          )
        ) : (
          <RunView
            viewModel={viewModel}
            glyphs={glyphs}
            depth={depth}
            twoPane={viewModel.twoPane}
          />
        )}
      </Box>
      <KeyFooter
        hints={viewModel.footer}
        glyphs={glyphs}
        depth={depth}
        columns={viewModel.columns}
      />
    </Box>
  );
}

// Built from the code point so the token module stays the only place with SGR literals.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export interface FrameRenderOptions {
  readonly ascii?: boolean;
  readonly env?: TerminalEnv;
  /** Default: colour off, because the captured stream is not a TTY. */
  readonly depth?: ColorDepth;
}

/** Mounts the tree into an in-memory stdout and returns the final frame with its SGR intact. */
async function captureFrame(
  viewModel: ViewModel,
  size: FrameSize,
  options: FrameRenderOptions,
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
  const env = options.env ?? {};
  const depth = options.depth ?? detectColorDepth(env, false);
  // shortcut: Ink reads only these fields from the alternate streams; replace with real streams
  // if a future Ink release grows the interface.
  const instance = render(
    <Frame
      viewModel={sized}
      glyphs={glyphsFor({ ascii: options.ascii ?? false, env })}
      depth={depth}
    />,
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
  return chunks.at(-1) ?? "";
}

/**
 * The plain text of one frame: no ANSI, no trailing spaces, no trailing blank lines. Snapshots and
 * `--once` use this; the colour tests inspect `renderAnsiFrame` before the strip.
 */
export async function renderFrame(
  viewModel: ViewModel,
  size: FrameSize,
  options: FrameRenderOptions = {},
): Promise<string> {
  const raw = await captureFrame(viewModel, size, options);
  return raw
    .split("\n")
    .map((line) => stripAnsi(line).replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}

/** The same frame with SGR intact, for tests that assert the palette rather than the text. */
export async function renderAnsiFrame(
  viewModel: ViewModel,
  size: FrameSize,
  options: FrameRenderOptions = {},
): Promise<string> {
  return captureFrame(viewModel, size, options);
}
