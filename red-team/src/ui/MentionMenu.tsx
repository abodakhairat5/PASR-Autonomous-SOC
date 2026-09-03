// File picker shown above the input when the user types `@<partial>`.
// Path-aware: directories sort first, end with `/`, and `../` is pinned
// at the top so the user can ascend. Same visual language as SlashMenu —
// borderless, dim+bright selection, windowed for long lists, with one
// small icon per row to distinguish dirs (▸) from files (+).
//
// Suggestion-list style: no per-row
// box, no rounded border, no always-visible help footer. The cwd prefix
// is shown as a small dim header so the user knows where they are.

import { Box, Text } from 'ink';
import type { MentionCandidate } from '../agent/mentions.js';
import { computeMenuWindow } from './menuWindow.js';

export interface MentionMenuProps {
  /** Directory prefix the picker is currently browsing (display only). */
  cwd: string;
  candidates: MentionCandidate[];
  selected: number;
}

export function MentionMenu({ cwd, candidates, selected }: MentionMenuProps): JSX.Element | null {
  if (candidates.length === 0) return null;
  const w = computeMenuWindow(candidates.length, selected);
  const visible = candidates.slice(w.start, w.end);
  return (
    <Box flexDirection="column">
      <Text dimColor>{`  @${cwd || ''}`}</Text>
      {w.hiddenAbove > 0 ? <Text dimColor>{`  ↑ ${w.hiddenAbove} more`}</Text> : null}
      {visible.map((c, idx) => {
        const absoluteIdx = w.start + idx;
        const isSelected = absoluteIdx === selected;
        const icon = c.isDir ? '▸' : '+';
        // Selected row uses cyan accent + bold so it stands out from
        // the dim list. Dir icons are cyan even when unselected to give
        // a visual cue independent of focus.
        return (
          <Text
            key={c.insert}
            color={isSelected ? 'cyan' : undefined}
            dimColor={!isSelected}
            bold={isSelected}
            wrap="truncate"
          >
            {`  ${icon} ${c.display}`}
          </Text>
        );
      })}
      {w.hiddenBelow > 0 ? <Text dimColor>{`  ↓ ${w.hiddenBelow} more`}</Text> : null}
    </Box>
  );
}
