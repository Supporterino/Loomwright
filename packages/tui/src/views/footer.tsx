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

interface EnabledHint {
  readonly key: string;
  readonly text: string;
}

/** The footer's escape hatches: kept even when the contextual hints have to give way. */
function isKept(key: string): boolean {
  return key === "q" || key === "?";
}

/** Joins the enabled hints, dropping the rightmost optional one until the line fits. */
function fitEnabled(hints: readonly EnabledHint[], separator: string, columns: number): string {
  const shown = [...hints];
  let text = shown.map((hint) => hint.text).join(separator);
  while (text.length > columns) {
    const drop = shown.findLastIndex((hint) => !isKept(hint.key));
    if (drop < 0) break;
    shown.splice(drop, 1);
    text = shown.map((hint) => hint.text).join(separator);
  }
  return text;
}

/**
 * Inert hints first, with their reason clipped to the room the enabled hints leave. When the
 * enabled hints alone overflow, the lowest-priority hint is dropped: `q quit` and `? help` stay.
 */
function footerText(hints: readonly KeyHint[], glyphs: GlyphSet, columns: number): string {
  const separator = ` ${glyphs.bullet} `;
  const inert: string[] = [];
  const enabled: EnabledHint[] = [];
  for (const hint of hints) {
    if (hint.enabled) {
      enabled.push({ key: hint.key, text: `${hint.key} ${hint.label}` });
    } else if (hint.reason !== undefined) {
      inert.push(`${hint.key} ${hint.label} ${dash(glyphs)} ${hint.reason}`);
    }
  }
  const enabledText = fitEnabled(enabled, separator, columns);
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
