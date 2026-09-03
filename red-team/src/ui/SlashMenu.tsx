// Slash-command suggestions. Rendered just above the input as a flat
// list — no rounded border, no per-row box, no always-visible footer
// hints. Selection is shown by color contrast (selected = bright,
// others = dim) rather than a `›` arrow, in a
// typeahead-style suggestion list.
//
// When the filtered list exceeds the visible cap, we render a 5-item
// window centered on the selection plus subtle "↑ N more" / "↓ N more"
// hints so the user knows there's more material to scroll into.

import { Box, Text } from 'ink';
import { computeMenuWindow } from './menuWindow.js';
import type { SlashItem } from './slashItems.js';

export interface SlashMenuProps {
  items: SlashItem[];
  selected: number;
}

export function SlashMenu({ items, selected }: SlashMenuProps): JSX.Element | null {
  if (items.length === 0) return null;
  const w = computeMenuWindow(items.length, selected);
  const visible = items.slice(w.start, w.end);
  return (
    <Box flexDirection="column">
      {w.hiddenAbove > 0 ? <Text dimColor>{`  ↑ ${w.hiddenAbove} more`}</Text> : null}
      {visible.map((item, idx) => {
        const absoluteIdx = w.start + idx;
        const isSelected = absoluteIdx === selected;
        const args = item.args ? ` ${item.args}` : '';
        // Selected row uses magenta accent + bold, unselected rows dim
        // so the eye lands on the active suggestion. No prefix glyph.
        return (
          <Text
            key={item.name}
            color={isSelected ? 'magenta' : undefined}
            dimColor={!isSelected}
            bold={isSelected}
            wrap="truncate"
          >
            {`  ${item.name}${args}  ${item.description}`}
          </Text>
        );
      })}
      {w.hiddenBelow > 0 ? <Text dimColor>{`  ↓ ${w.hiddenBelow} more`}</Text> : null}
    </Box>
  );
}
