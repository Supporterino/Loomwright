import { Text } from "ink";
import type { ReactElement } from "react";
import type { KeyHint } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps, dash } from "./style.ts";

export interface KeyFooterProps {
  readonly hints: readonly KeyHint[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** Frame width; the footer is clipped here so ASCII keeps its own ellipsis. */
  readonly columns: number;
}

/** Enabled hints, then the inert ones with the CLI's reason so a dead key explains itself. */
function hintParts(hints: readonly KeyHint[], glyphs: GlyphSet): readonly string[] {
  const parts = hints.filter((hint) => hint.enabled).map((hint) => `${hint.key} ${hint.label}`);
  for (const hint of hints) {
    if (hint.enabled || hint.reason === undefined) continue;
    parts.push(`${hint.key} ${hint.label} ${dash(glyphs)} ${hint.reason}`);
  }
  return parts;
}

export function KeyFooter({ hints, glyphs, depth, columns }: KeyFooterProps): ReactElement {
  const text = hintParts(hints, glyphs).join(` ${glyphs.bullet} `);
  return (
    <Text {...colorProps("muted", depth)} wrap="truncate">
      {clip(text, columns, glyphs)}
    </Text>
  );
}
