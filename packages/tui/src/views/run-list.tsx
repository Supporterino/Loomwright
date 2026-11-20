import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, formatTokensShort } from "../model/format.ts";
import { type RunListItem, roleLabel, type ViewModel } from "../model/view-model.ts";
import { findingsCount, LABELS } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, joinFields, phaseGlyph, phaseToken } from "./style.ts";

export interface RunListProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** id, summary and the findings marker; two spaces keep the summary off the bullet list. */
function headOf(item: RunListItem, glyphs: GlyphSet): string {
  const head = [item.id, item.summary];
  if (item.findings > 0) head.push(`${glyphs.blocked} ${findingsCount(item.findings)}`);
  return head.join("  ");
}

/** The pane's cells: a two-pane list takes the left half of the frame. */
function paneWidth(viewModel: ViewModel): number {
  return viewModel.twoPane ? Math.floor(viewModel.columns / 2) : viewModel.columns;
}

/** Cuts to `room` cells with the frame's ellipsis; Ink's own is always `…`, even in ASCII. */
function clip(text: string, room: number, glyphs: GlyphSet): string {
  if (room <= 0) return "";
  if (text.length <= room) return text;
  const mark = glyphs.bullet === "-" ? "..." : "…";
  if (room <= mark.length) return mark.slice(0, room);
  return `${text.slice(0, room - mark.length)}${mark}`;
}

export function RunList({ viewModel, glyphs, depth }: RunListProps): ReactElement {
  // 8 cells are the focus and phase markers and the separators around the head.
  const cells = paneWidth(viewModel) - 8;
  return (
    <Box flexDirection="column">
      <Text bold>Runs</Text>
      {viewModel.list.map((item) => {
        const head = clip(headOf(item, glyphs), cells, glyphs);
        const meta = clip(
          joinFields(glyphs, [
            LABELS[item.phase],
            roleLabel(item.role),
            `${formatTokensShort(item.tokens)} tokens`,
            `$${item.cost.toFixed(2)}`,
            formatElapsed(item.elapsedMs),
          ]),
          cells - head.length,
          glyphs,
        );
        return (
          <Text key={item.id} wrap="truncate">
            <Text {...(item.selected ? colorProps("focus", depth) : {})}>
              {item.selected ? glyphs.focus : " "}
            </Text>{" "}
            <Text {...colorProps(phaseToken(item.phase), depth)}>
              {phaseGlyph(item.phase, glyphs)}
            </Text>{" "}
            {head}
            {"  "}
            {glyphs.bullet} {meta}
          </Text>
        );
      })}
      {viewModel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {viewModel.notice}
        </Text>
      )}
    </Box>
  );
}
