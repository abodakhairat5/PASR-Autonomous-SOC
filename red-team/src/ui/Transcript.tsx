// Transcript log. Finalized entries are printed ONCE into the terminal's
// native scrollback via Ink's <Static>, so the mouse wheel and the
// terminal's own scrollbar reach the full conversation history — there is
// no in-app scroll offset. The actively-streaming assistant entry renders
// separately in App's live frame (EntryView) until it finalizes, then
// joins the committed log.
//
// Only the FIRST line of each transcript entry carries the role's
// prefix glyph (›, ⚙, ↳, etc.). Continuation lines get an aligned
// 2-space indent so the prefix isn't re-stamped on every wrap — that
// turned tool-result bodies into a wall of arrows:
//
//   ↳ [ok] shell (3828ms)
//   ↳ exit: 0           ← every line used to get ↳
//   ↳ stdout:
//
// is now:
//
//   ↳ [ok] shell (3828ms)
//     exit: 0
//     stdout:
//
// Assistant text additionally goes through renderMarkdown so **bold**,
// `code`, and headings render with terminal styling.

import { Box, Static, Text } from 'ink';
import { memo, useMemo } from 'react';
import { Banner, type BannerData } from './Banner.js';
import { useTerminalSize } from './TerminalSize.js';
import { renderMarkdown } from './markdown.js';
import type { TranscriptEntry } from './state.js';

export interface TranscriptProps {
  /** Finalized entries, printed once into native scrollback. */
  committed: TranscriptEntry[];
  /** Frozen snapshot printed once at the top of the log. */
  bannerData: BannerData;
  /** Bumped on /clear so the Static log remounts. */
  generation: number | string;
}

/** One log item: the one-time banner header, or a transcript entry. */
type LogItem = { t: 'banner' } | { t: 'entry'; entry: TranscriptEntry };

const ROLE_STYLES: Record<TranscriptEntry['kind'], { color: string; prefix: string }> = {
  user: { color: 'cyan', prefix: '› ' },
  assistant: { color: 'white', prefix: '  ' },
  'tool-call': { color: 'magenta', prefix: '⚙ ' },
  'tool-result': { color: 'gray', prefix: '↳ ' },
  system: { color: 'gray', prefix: '· ' },
  error: { color: 'red', prefix: '! ' },
  finding: { color: 'yellow', prefix: '★ ' },
  decision: { color: 'cyan', prefix: '· ' },
};

/** Continuation lines align under the prefix glyph. All prefixes above
 *  are 2 cells wide, so 2 spaces is the right indent. */
const CONTINUATION_INDENT = '  ';

/** Only assistant prose gets markdown rendering — tool output is verbatim,
 *  user input shows what they typed, errors/system stay plain. */
const MARKDOWN_KINDS = new Set<TranscriptEntry['kind']>(['assistant', 'finding']);

interface Row {
  kind: TranscriptEntry['kind'];
  text: string;
  isFirst: boolean;
}

// Per-entry render cache. Markdown rendering + line splitting is the hot
// path here: `renderMarkdown` runs a regex-heavy pipeline through
// `cli-highlight`, and Transcript re-renders any time App re-renders —
// which happens on every keystroke via useTextField. Without this cache,
// typing in a session with N assistant entries pays O(N · markdown cost)
// per keystroke even though nothing in the transcript changed.
//
// The reducer creates a new entry object on every mutation (`{ ...last,
// text: last.text + delta }`), so object identity is a reliable cache
// key: untouched entries stay reference-equal; updated/streaming entries
// get a fresh reference and miss the cache, which is exactly what we
// want. WeakMap so evicted entries don't leak.
const rowCache = new WeakMap<TranscriptEntry, Row[]>();

function rowsForEntry(entry: TranscriptEntry): Row[] {
  const cached = rowCache.get(entry);
  if (cached) return cached;
  const text = MARKDOWN_KINDS.has(entry.kind) ? renderMarkdown(entry.text) : entry.text;
  const lines = text.split('\n');
  const out: Row[] = lines.map((line, j) => ({
    kind: entry.kind,
    text: line,
    isFirst: j === 0,
  }));
  // Trailing spacer row between entries.
  out.push({ kind: entry.kind, text: '', isFirst: false });
  rowCache.set(entry, out);
  return out;
}

// Lightweight rows for the actively-streaming entry. The append-delta
// reducer creates a fresh entry object per token, so the WeakMap cache above
// misses on every delta — running the regex-heavy renderMarkdown + cli-highlight
// pipeline over the whole accumulated answer on every single token. The live
// frame is transient (it's re-rendered as plain text on each tick anyway and
// the full markdown render happens exactly once when the entry finalizes into
// <Static>), so skip the pipeline here and just split into lines. Not cached:
// the entry identity changes every token, so a cache would never hit.
function plainRowsForEntry(entry: TranscriptEntry): Row[] {
  const lines = entry.text.split('\n');
  const out: Row[] = lines.map((line, j) => ({
    kind: entry.kind,
    text: line,
    isFirst: j === 0,
  }));
  // Trailing spacer row between entries.
  out.push({ kind: entry.kind, text: '', isFirst: false });
  return out;
}

/** Render one transcript entry as a column of styled, prefixed rows.
 *  Used both inside the Static log and for the live streaming entry. When
 *  `streaming` is set the markdown/highlight pipeline is skipped — the
 *  live frame shows plain prefixed lines until the entry finalizes and is
 *  committed to <Static>, where the full markdown render runs once. */
export function EntryView({
  entry,
  streaming = false,
}: {
  entry: TranscriptEntry;
  streaming?: boolean;
}): JSX.Element {
  const s = ROLE_STYLES[entry.kind];
  const rows = streaming ? plainRowsForEntry(entry) : rowsForEntry(entry);
  return (
    <Box flexDirection="column">
      {rows.map((row, j) => {
        const indent = row.isFirst ? (entry.prefix ?? s.prefix) : CONTINUATION_INDENT;
        // For markdown-rendered rows the embedded ANSI sets its own colors;
        // we still set the base color so plain segments render in the
        // role's color.
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are stable & never reordered
          <Text key={j} color={entry.color ?? s.color}>
            {row.text ? `${indent}${row.text}` : ''}
          </Text>
        );
      })}
    </Box>
  );
}

function TranscriptInner({ committed, bannerData, generation }: TranscriptProps): JSX.Element {
  const { columns } = useTerminalSize();
  // Banner is item 0 (printed once, frozen), followed by committed entries.
  // The array only ever grows, so <Static> prints each new entry exactly
  // once into the terminal's scrollback and never redraws — which is what
  // makes the wheel/scrollbar reach the whole history.
  const items = useMemo<LogItem[]>(
    () => [{ t: 'banner' }, ...committed.map((entry) => ({ t: 'entry' as const, entry }))],
    [committed],
  );

  return (
    <Static key={generation} items={items}>
      {(item, index) =>
        item.t === 'banner' ? (
          <Box key={`banner-${generation}`} marginBottom={1}>
            <Banner data={bannerData} width={columns} />
          </Box>
        ) : (
          <EntryView key={`${generation}-${index}`} entry={item.entry} />
        )
      }
    </Static>
  );
}

// memo() with shallow prop compare: App re-renders on every keystroke, but
// the log only changes when `committed` (array identity) or `generation`
// changes, so typing skips the Transcript render entirely.
export const Transcript = memo(TranscriptInner);
