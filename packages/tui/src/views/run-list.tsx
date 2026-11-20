import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, formatTokensShort } from "../model/format.ts";
import { type RunListItem, roleLabel, type ViewModel } from "../model/view-model.ts";
import { sliceWindow, windowTitle } from "../model/viewport.ts";
import { findingsCount, LABELS } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps, phaseGlyph, phaseToken } from "./style.ts";

export interface RunListProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** id and summary; two spaces keep the summary off the bullet list. */
function headOf(item: RunListItem): string {
  return `${item.id}  ${item.summary}`;
}

/** The findings marker: the gate glyph and label, never the coral approval hue. */
function markerOf(item: RunListItem, glyphs: GlyphSet): string {
  return item.findings > 0 ? `  ${glyphs.blocked} ${findingsCount(item.findings)}` : "";
}

function metaOf(item: RunListItem): readonly string[] {
  return [
    LABELS[item.phase],
    roleLabel(item.role),
    `${formatTokensShort(item.tokens)} tokens`,
    `$${item.cost.toFixed(2)}`,
    formatElapsed(item.elapsedMs),
  ];
}

/** The pane's cells: a two-pane list takes the left half of the frame. */
function paneWidth(viewModel: ViewModel): number {
  return viewModel.twoPane ? Math.floor(viewModel.columns / 2) : viewModel.columns;
}

export function RunList({ viewModel, glyphs, depth }: RunListProps): ReactElement {
  // 8 cells are the focus and phase markers and the separators around the head.
  const cells = paneWidth(viewModel) - 8;
  const title = windowTitle("runs", viewModel.listWindow);
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Runs</Text>
        {title === null ? null : (
          <Text {...colorProps("muted", depth)}>{` ${glyphs.bullet} ${title}`}</Text>
        )}
      </Text>
      {sliceWindow(viewModel.list, viewModel.listWindow).map((item) => {
        const meta = metaOf(item);
        const metaFull = meta.join(` ${glyphs.bullet} `);
        const marker = clip(markerOf(item, glyphs), cells, glyphs);
        // The marker is always reserved. The full-width list then reserves every metadata field
        // before the head, so a long summary cannot hide the finding count or cut the fields each
        // row carries. The half-width two-pane list keeps the identifying head instead.
        const markerRoom = Math.max(0, cells - marker.length);
        const headFirst = viewModel.twoPane;
        const head = clip(
          headOf(item),
          headFirst ? markerRoom : Math.max(0, markerRoom - metaFull.length),
          glyphs,
        );
        const clippedMeta = clip(
          metaFull,
          Math.max(0, markerRoom - (headFirst ? head.length : 0)),
          glyphs,
        );
        const selected = item.selected;
        return (
          <Text key={item.id} wrap="truncate" {...(selected ? { bold: true } : {})}>
            <Text {...(selected ? colorProps("focus", depth) : {})}>
              {selected ? glyphs.focus : " "}
            </Text>{" "}
            <Text {...colorProps(phaseToken(item.phase), depth)}>
              {phaseGlyph(item.phase, glyphs)}
            </Text>{" "}
            {head}
            {marker === "" ? null : <Text bold>{marker}</Text>}
            {clippedMeta === "" ? null : (
              <>
                {"  "}
                {glyphs.bullet}{" "}
              </>
            )}
            {clippedMeta === metaFull ? (
              <>
                <Text>{meta[0] ?? ""}</Text>
                {` ${glyphs.bullet} `}
                <Text>{meta[1] ?? ""}</Text>
                {` ${glyphs.bullet} `}
                <Text {...colorProps("muted", depth)}>
                  {`${meta[2] ?? ""} ${glyphs.bullet} ${meta[3] ?? ""} ${glyphs.bullet} ${meta[4] ?? ""}`}
                </Text>
              </>
            ) : (
              <Text {...colorProps("muted", depth)}>{clippedMeta}</Text>
            )}
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
