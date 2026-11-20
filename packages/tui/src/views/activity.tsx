import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ActivityLine } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps } from "./style.ts";

export interface ActivityLinesProps {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** Renders exactly the given lines; the caller owns every slice and line budget. */
export function ActivityLines({ lines, glyphs, depth }: ActivityLinesProps): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column">
      {lines.map((line) => (
        <Text key={line.seq} wrap="truncate">
          <Text {...colorProps("muted", depth)}>{line.step}</Text> {glyphs.bullet}{" "}
          <Text {...colorProps("muted", depth)}>{line.kind}</Text> {glyphs.bullet}{" "}
          {line.logRef === undefined ? null : (
            <Text {...colorProps("muted", depth)}>{`${glyphs.arrow} ${line.logRef}`}</Text>
          )}
          {line.logRef === undefined ? null : " "}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export interface ActivityTailProps {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly maxLines?: number;
}

/** Renders the already-capped lines from `EventFacts.activity`; `maxLines` clips to the rows left. */
export function ActivityTail({
  lines,
  glyphs,
  depth,
  maxLines = 20,
}: ActivityTailProps): ReactElement | null {
  // No row to spend: not even the empty state may render, or the frame grows past the terminal.
  if (maxLines <= 0) return null;
  if (lines.length === 0) {
    return <Text {...colorProps("muted", depth)}>no activity yet</Text>;
  }
  const shown = lines.slice(Math.max(0, lines.length - maxLines));
  return <ActivityLines lines={shown} glyphs={glyphs} depth={depth} />;
}
