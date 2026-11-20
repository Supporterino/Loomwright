import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { PanelView } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps, inkColor } from "./style.ts";

export interface PanelBoxProps {
  readonly panel: PanelView;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** The frame's rows, so the blank line before the keys still leaves the footer a row. */
  readonly rows: number;
  /** The frame's columns; the panel clips inside its border and padding. */
  readonly columns: number;
}

const STATUS_LINE = /^ {2}(?:answered|skipped|unanswered|recorded)(?:\s|$)/u;

/** The questions pane's structured body: a muted file line and statuses, a focused marker. */
function questionLine(
  line: string,
  isFile: boolean,
  key: string,
  glyphs: GlyphSet,
  depth: ColorDepth,
): ReactElement {
  if (isFile || STATUS_LINE.test(line)) {
    return (
      <Text key={key} wrap="truncate" {...colorProps("muted", depth)}>
        {line}
      </Text>
    );
  }
  if (line.startsWith(`${glyphs.focus} `)) {
    return (
      <Text key={key} wrap="truncate" bold>
        <Text {...colorProps("focus", depth)}>{line.slice(0, glyphs.focus.length)}</Text>
        {line.slice(glyphs.focus.length)}
      </Text>
    );
  }
  return (
    <Text key={key} wrap="truncate">
      {line}
    </Text>
  );
}

/** Clips each physical line; Ink's own ellipsis is always `…`, even in an ASCII frame. */
function clipLines(text: string, room: number, glyphs: GlyphSet): string {
  return text
    .split("\n")
    .map((line) => clip(line, room, glyphs))
    .join("\n");
}

/** The generic bordered box 1.5-1.7 fill with a `PanelView`; it owns no panel-specific content. */
export function PanelBox({ panel, glyphs, depth, rows, columns }: PanelBoxProps): ReactElement {
  // Coral belongs to the approval gate alone; every other panel is lilac.
  const token = panel.kind === "approval" ? "approval" : "focus";
  const borderColor = inkColor(token, depth);
  // One border and one padding cell on each side, so this is the room a line actually gets.
  const innerWidth = Math.max(0, columns - 4);
  // Lines repeat (blank preview rows, log tails), so a key pairs each line with its occurrence.
  const occurrences = new Map<string, number>();
  // Two borders, the title and the keys row, plus the frame footer: a full-height panel gets no
  // blank line, because the frame may never grow past its rows.
  const bodyRows = panel.lines.length + (panel.notice === null ? 0 : 1);
  const spaced = bodyRows + 6 <= rows;
  return (
    <Box
      flexDirection="column"
      borderStyle="classic"
      {...(borderColor === undefined ? {} : { borderColor })}
      paddingX={1}
    >
      <Text bold {...colorProps(token, depth)} wrap="truncate">
        {clip(panel.title, innerWidth, glyphs)}
      </Text>
      {panel.lines.map((line, index) => {
        const count = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, count);
        const key = `${line}#${count}`;
        return panel.kind === "questions" ? (
          questionLine(clipLines(line, innerWidth, glyphs), index === 0, key, glyphs, depth)
        ) : (
          <Text key={key} wrap="truncate">
            {clipLines(line, innerWidth, glyphs)}
          </Text>
        );
      })}
      {panel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {clipLines(panel.notice, innerWidth, glyphs)}
        </Text>
      )}
      {spaced ? <Text> </Text> : null}
      <Text {...colorProps("muted", depth)} wrap="truncate">
        {clip(
          panel.keys.map((hint) => `${hint.key} ${hint.label}`).join(` ${glyphs.bullet} `),
          innerWidth,
          glyphs,
        )}
      </Text>
    </Box>
  );
}
