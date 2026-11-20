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

/**
 * Inert hints first, with their reason clipped to the room the enabled hints leave: the enabled
 * keys stay whole, so `q quit` and `? help` never fall off a narrow footer.
 */
function footerText(hints: readonly KeyHint[], glyphs: GlyphSet, columns: number): string {
  const separator = ` ${glyphs.bullet} `;
  const inert: string[] = [];
  const enabled: string[] = [];
  for (const hint of hints) {
    if (hint.enabled) {
      enabled.push(`${hint.key} ${hint.label}`);
    } else if (hint.reason !== undefined) {
      inert.push(`${hint.key} ${hint.label} ${dash(glyphs)} ${hint.reason}`);
    }
  }
  const enabledText = enabled.join(separator);
  if (inert.length === 0) return enabledText;
  if (enabledText === "") return clip(inert.join(separator), columns, glyphs);
  const room = columns - enabledText.length - separator.length;
  if (room <= 0) return enabledText;
  const inertText = clip(inert.join(separator), room, glyphs);
  return inertText === "" ? enabledText : `${inertText}${separator}${enabledText}`;
}

export function KeyFooter({ hints, glyphs, depth, columns }: KeyFooterProps): ReactElement {
  const text = footerText(hints, glyphs, columns);
  return (
    <Text {...colorProps("muted", depth)} wrap="truncate">
      {clip(text, columns, glyphs)}
    </Text>
  );
}
