import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, formatTokensShort } from "../model/format.ts";
import { type RunDetail, roleLabel } from "../model/view-model.ts";
import { LABELS, pausedFindings } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps, dash, joinFields, phaseGlyph, phaseToken } from "./style.ts";

/** Cuts to `room` cells from the end, so the lock role that closes the metadata always survives. */
function clipTail(text: string, room: number, glyphs: GlyphSet): string {
  if (room <= 0) return "";
  if (text.length <= room) return text;
  const mark = glyphs.bullet === "-" ? "..." : "…";
  if (room <= mark.length) return text.slice(-room);
  return `${mark}${text.slice(-(room - mark.length))}`;
}

export interface RunHeaderProps {
  readonly run: RunDetail;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** Content cells the pane leaves for the row; the caller subtracts its padding. */
  readonly columns: number;
}

export function RunHeader({ run, glyphs, depth, columns }: RunHeaderProps): ReactElement {
  const showReapprove = run.approval !== null && run.approval.specCommit !== null;
  // The lock role is the last field and the one the header may never drop, so the id and phase
  // give way first. The budget keeps the row out of Ink's truncation, whose mark is always Unicode.
  const phase = phaseGlyph(run.phase, glyphs);
  const meta = joinFields(glyphs, [
    formatElapsed(run.elapsedMs),
    `${formatTokensShort(run.tokens)} tokens`,
    `$${run.cost.toFixed(2)}`,
    roleLabel(run.lock),
  ]);
  const room = Math.max(0, columns - phase.length - 2);
  const head = clip(`${run.id} ${LABELS[run.phase]}`, Math.max(0, room - meta.length - 1), glyphs);
  const clippedMeta = clipTail(meta, Math.max(0, room - head.length - 1), glyphs);
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text {...colorProps(phaseToken(run.phase), depth)}>{phase}</Text> <Text bold>{head}</Text>{" "}
        <Text {...colorProps("muted", depth)}>{clippedMeta}</Text>
      </Text>
      {run.phase === "awaiting-approval" ? (
        <Text {...colorProps("approval", depth)} wrap="truncate">
          {joinFields(glyphs, [
            `${glyphs.approval} awaiting approval`,
            "a approve and run",
            "A approve only",
            ...(showReapprove ? ["R reapprove"] : []),
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
