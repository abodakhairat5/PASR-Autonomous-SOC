// Controlled text-field state with cursor and multi-line editing. The
// goal isn't a full text-editor — it's the operations the agent prompt
// actually uses: typing, backspace/delete, arrow-key cursor movement,
// home/end of line, newline insertion (Ctrl-N), and bracketed paste.
//
// We expose `value`, `cursor` (offset into value), and a set of typed
// actions. Components render the value + cursor; key handlers above
// dispatch actions. State is a useReducer so updates batch under React.
//
// Why we built this:
//   - Single-line input clipped multi-line pastes (heredocs, payloads).
//   - No way to insert a newline mid-prompt.
//   - No cursor movement, so editing a long URL meant deleting and
//     re-typing the tail.

import { useCallback, useReducer } from 'react';

export interface TextFieldState {
  value: string;
  cursor: number;
}

export interface TextFieldActions {
  insertText: (s: string) => void;
  backspace: () => void;
  deleteForward: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  moveUp: () => void;
  moveDown: () => void;
  moveLineStart: () => void;
  moveLineEnd: () => void;
  setValue: (v: string, cursor?: number) => void;
  clear: () => void;
}

export type TextField = TextFieldState & TextFieldActions;

type Action =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'move'; delta: number }
  | { type: 'move-up' }
  | { type: 'move-down' }
  | { type: 'move-line-start' }
  | { type: 'move-line-end' }
  | { type: 'set'; value: string; cursor: number };

function reducer(s: TextFieldState, a: Action): TextFieldState {
  switch (a.type) {
    case 'insert': {
      const value = s.value.slice(0, s.cursor) + a.text + s.value.slice(s.cursor);
      return { value, cursor: s.cursor + a.text.length };
    }
    case 'backspace': {
      if (s.cursor === 0) return s;
      return {
        value: s.value.slice(0, s.cursor - 1) + s.value.slice(s.cursor),
        cursor: s.cursor - 1,
      };
    }
    case 'delete': {
      if (s.cursor >= s.value.length) return s;
      return {
        value: s.value.slice(0, s.cursor) + s.value.slice(s.cursor + 1),
        cursor: s.cursor,
      };
    }
    case 'move':
      return { ...s, cursor: clamp(s.cursor + a.delta, 0, s.value.length) };
    case 'move-up': {
      const { line, col } = positionOf(s.value, s.cursor);
      if (line === 0) return { ...s, cursor: 0 };
      return { ...s, cursor: offsetAt(s.value, line - 1, col) };
    }
    case 'move-down': {
      const { line, col } = positionOf(s.value, s.cursor);
      const lines = s.value.split('\n');
      if (line >= lines.length - 1) return { ...s, cursor: s.value.length };
      return { ...s, cursor: offsetAt(s.value, line + 1, col) };
    }
    case 'move-line-start': {
      const { line } = positionOf(s.value, s.cursor);
      return { ...s, cursor: offsetAt(s.value, line, 0) };
    }
    case 'move-line-end': {
      const { line } = positionOf(s.value, s.cursor);
      const lines = s.value.split('\n');
      return { ...s, cursor: offsetAt(s.value, line, (lines[line] ?? '').length) };
    }
    case 'set':
      return { value: a.value, cursor: clamp(a.cursor, 0, a.value.length) };
  }
}

export function useTextField(initial = ''): TextField {
  const [state, dispatch] = useReducer(reducer, {
    value: initial,
    cursor: initial.length,
  });

  const insertText = useCallback((text: string) => dispatch({ type: 'insert', text }), []);
  const backspace = useCallback(() => dispatch({ type: 'backspace' }), []);
  const deleteForward = useCallback(() => dispatch({ type: 'delete' }), []);
  const moveLeft = useCallback(() => dispatch({ type: 'move', delta: -1 }), []);
  const moveRight = useCallback(() => dispatch({ type: 'move', delta: 1 }), []);
  const moveUp = useCallback(() => dispatch({ type: 'move-up' }), []);
  const moveDown = useCallback(() => dispatch({ type: 'move-down' }), []);
  const moveLineStart = useCallback(() => dispatch({ type: 'move-line-start' }), []);
  const moveLineEnd = useCallback(() => dispatch({ type: 'move-line-end' }), []);
  const setValue = useCallback(
    (v: string, cursor?: number) => dispatch({ type: 'set', value: v, cursor: cursor ?? v.length }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'set', value: '', cursor: 0 }), []);

  return {
    value: state.value,
    cursor: state.cursor,
    insertText,
    backspace,
    deleteForward,
    moveLeft,
    moveRight,
    moveUp,
    moveDown,
    moveLineStart,
    moveLineEnd,
    setValue,
    clear,
  };
}

// ---------- helpers ----------

/** Convert a flat offset into a (line, column) within the value. */
export function positionOf(value: string, offset: number): { line: number; col: number } {
  let line = 0;
  let col = 0;
  const cap = clamp(offset, 0, value.length);
  for (let i = 0; i < cap; i += 1) {
    if (value[i] === '\n') {
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

/** Compute the flat offset for (line, col), clamping column to the line length. */
export function offsetAt(value: string, line: number, col: number): number {
  const lines = value.split('\n');
  const targetLine = clamp(line, 0, lines.length - 1);
  let off = 0;
  for (let i = 0; i < targetLine; i += 1) off += (lines[i] ?? '').length + 1;
  const lineLen = (lines[targetLine] ?? '').length;
  return off + clamp(col, 0, lineLen);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Bracketed-paste detection used by App. When `input` arrives from
// useInput with multiple characters or contains a newline, the
// terminal pasted instead of typing — we insert the chunk wholesale
// rather than treating an embedded \n as a submit.
export function looksLikePaste(input: string, key: { return?: boolean }): boolean {
  if (!input) return false;
  if (input.length > 1) return true;
  if (input.includes('\n') && !key.return) return true;
  return false;
}

// Some terminals leak the bracketed-paste markers verbatim. Strip them
// before insertion so the user doesn't see `\x1b[200~` text in their
// input.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
export function stripPasteMarkers(s: string): string {
  return s.split(PASTE_START).join('').split(PASTE_END).join('');
}

export function normalizePastedText(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function shouldCollapsePaste(s: string): boolean {
  return normalizePastedText(s).includes('\n');
}

export function pastedTextMarker(id: number, text: string): string {
  const normalized = normalizePastedText(text);
  const lineCount = normalized.split('\n').length;
  return `[Pasted text #${id} +${lineCount} lines, ${normalized.length} chars]`;
}

const PASTED_TEXT_MARKER_RE = /\[Pasted text #(\d+) \+\d+ lines(?:, \d+ chars)?\]/g;

export function expandPastedTextMarkers(
  value: string,
  pastedTextById: ReadonlyMap<number, string>,
): string {
  return value.replace(PASTED_TEXT_MARKER_RE, (marker, idRaw: string) => {
    const pasted = pastedTextById.get(Number(idRaw));
    return pasted ?? marker;
  });
}
