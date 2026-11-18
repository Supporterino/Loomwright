/**
 * The non-TTY path: one frame through the same component tree as the interactive UI, with no
 * terminal session and no alternate screen. Ink may still emit cursor sequences for a non-TTY
 * stdout, so this boundary strips them.
 */
import type { ViewModel } from "../model/view-model.ts";
import { renderFrame } from "../views/frame.tsx";

export interface OnceFrameOptions {
  readonly ascii: boolean;
  readonly columns: number;
  readonly rows: number;
}

// Built from the code point so this module carries no escape literal in source.
const ESC = String.fromCharCode(27);
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");

export async function renderOnceFrame(
  viewModel: ViewModel,
  options: OnceFrameOptions,
): Promise<string> {
  const text = await renderFrame(
    viewModel,
    { columns: options.columns, rows: options.rows },
    { ascii: options.ascii },
  );
  return text.replace(CSI, "");
}
