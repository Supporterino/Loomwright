import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ActivityLine } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps } from "./style.ts";

export interface ActivityLinesProps {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** The columns a line may use; the caller owns the pane width. */
  readonly columns: number;
}

/** Renders exactly the given lines; the caller owns every slice, line budget and pane width. */
export function ActivityLines({
  lines,
  glyphs,
  depth,
  columns,
}: ActivityLinesProps): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column">
      {lines.map((line) => {
        const sep = ` ${glyphs.bullet} `;
        const refText = line.logRef === undefined ? "" : `${glyphs.arrow} ${line.logRef}`;
        // The separators (and the space before the text) are fixed; the rest shares what is left.
        const reserved = 2 * sep.length + (line.logRef === undefined ? 0 : 1);
        if (columns <= reserved) {
          const plain = `${line.step}${sep}${line.kind}${sep}${refText === "" ? "" : `${refText} `}${line.text}`;
          return (
            <Text key={line.seq} wrap="truncate">
              {clip(plain, columns, glyphs)}
            </Text>
          );
        }
        let room = columns - reserved;
        const step = clip(line.step, room, glyphs);
        room -= step.length;
        const kind = clip(line.kind, room, glyphs);
        room -= kind.length;
        const ref = clip(refText, room, glyphs);
        room -= ref.length;
        // Clip every part to the room the head leaves, so Ink never gets a chance to cut the row
        // with its own non-ASCII ellipsis.
        const text = clip(line.text, room, glyphs);
        return (
          <Text key={line.seq} wrap="truncate">
            <Text {...colorProps("muted", depth)}>{step}</Text>
            {sep}
            <Text {...colorProps("muted", depth)}>{kind}</Text>
            {sep}
            {line.logRef === undefined ? null : (
              <>
                <Text {...colorProps("muted", depth)}>{ref}</Text>{" "}
              </>
            )}
            {text}
          </Text>
        );
      })}
    </Box>
  );
}

export interface ActivityTailProps {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly maxLines?: number;
  /** The columns a line may use; the caller owns the pane width. */
  readonly columns: number;
}

/** Renders the already-capped lines from `EventFacts.activity`; `maxLines` clips to the rows left. */
export function ActivityTail({
  lines,
  glyphs,
  depth,
  maxLines = 20,
  columns,
}: ActivityTailProps): ReactElement | null {
  // No row to spend: not even the empty state may render, or the frame grows past the terminal.
  if (maxLines <= 0) return null;
  if (lines.length === 0) {
    return <Text {...colorProps("muted", depth)}>no activity yet</Text>;
  }
  const shown = lines.slice(Math.max(0, lines.length - maxLines));
  return <ActivityLines lines={shown} glyphs={glyphs} depth={depth} columns={columns} />;
}
