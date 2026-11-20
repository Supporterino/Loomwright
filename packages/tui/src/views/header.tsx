import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, formatTokensShort } from "../model/format.ts";
import { type RunDetail, roleLabel } from "../model/view-model.ts";
import { LABELS, pausedFindings } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, joinFields, phaseGlyph, phaseToken } from "./style.ts";

export interface RunHeaderProps {
  readonly run: RunDetail;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake and approval titles.
  return glyphs.bullet === "-" ? "-" : "—";
}

export function RunHeader({ run, glyphs, depth }: RunHeaderProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text {...colorProps(phaseToken(run.phase), depth)}>{phaseGlyph(run.phase, glyphs)}</Text>{" "}
        {joinFields(glyphs, [
          run.id,
          LABELS[run.phase],
          formatElapsed(run.elapsedMs),
          `${formatTokensShort(run.tokens)} tokens`,
          `$${run.cost.toFixed(2)}`,
          roleLabel(run.lock),
        ])}
      </Text>
      {run.phase === "awaiting-approval" ? (
        <Text {...colorProps("approval", depth)} wrap="truncate">
          {joinFields(glyphs, [
            `${glyphs.approval} awaiting approval`,
            "a approve",
            "A approve only",
          ])}
        </Text>
      ) : null}
      {run.phase === "paused" && run.specFindings.length > 0 ? (
        <Text {...colorProps(phaseToken(run.phase), depth)} wrap="truncate">
          {`${phaseGlyph(run.phase, glyphs)} ${pausedFindings(dash(glyphs), run.specFindings.length)}`}
        </Text>
      ) : null}
    </Box>
  );
}
