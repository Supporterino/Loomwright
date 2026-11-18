import { Text } from "ink";
import type { ReactElement } from "react";
import type { KeyHint } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps } from "./style.ts";

export interface KeyFooterProps {
  readonly hints: readonly KeyHint[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

export function KeyFooter({ hints, glyphs, depth }: KeyFooterProps): ReactElement {
  const text = hints
    .filter((hint) => hint.enabled)
    .map((hint) => `${hint.key} ${hint.label}`)
    .join(` ${glyphs.bullet} `);
  return (
    <Text {...colorProps("muted", depth)} wrap="truncate">
      {text}
    </Text>
  );
}
