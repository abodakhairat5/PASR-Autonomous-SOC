// Pure-function tests for the text-field helpers. The reducer / hook
// themselves are exercised end-to-end through App; here we cover the
// arithmetic that's hardest to get right: line/column math and the
// paste-detection predicate.

import { describe, expect, it } from 'vitest';
import {
  expandPastedTextMarkers,
  looksLikePaste,
  normalizePastedText,
  offsetAt,
  pastedTextMarker,
  positionOf,
  shouldCollapsePaste,
  stripPasteMarkers,
} from './useTextField.js';

describe('positionOf', () => {
  it('handles single-line offsets', () => {
    expect(positionOf('hello', 0)).toEqual({ line: 0, col: 0 });
    expect(positionOf('hello', 3)).toEqual({ line: 0, col: 3 });
    expect(positionOf('hello', 5)).toEqual({ line: 0, col: 5 });
  });

  it('walks across newlines', () => {
    expect(positionOf('ab\ncd\nef', 0)).toEqual({ line: 0, col: 0 });
    expect(positionOf('ab\ncd\nef', 2)).toEqual({ line: 0, col: 2 });
    expect(positionOf('ab\ncd\nef', 3)).toEqual({ line: 1, col: 0 });
    expect(positionOf('ab\ncd\nef', 5)).toEqual({ line: 1, col: 2 });
    expect(positionOf('ab\ncd\nef', 6)).toEqual({ line: 2, col: 0 });
    expect(positionOf('ab\ncd\nef', 8)).toEqual({ line: 2, col: 2 });
  });

  it('clamps offset to the value length', () => {
    expect(positionOf('hi', 999)).toEqual({ line: 0, col: 2 });
  });
});

describe('offsetAt', () => {
  it('computes flat offset from (line, col)', () => {
    expect(offsetAt('ab\ncd\nef', 0, 0)).toBe(0);
    expect(offsetAt('ab\ncd\nef', 1, 0)).toBe(3);
    expect(offsetAt('ab\ncd\nef', 1, 2)).toBe(5);
    expect(offsetAt('ab\ncd\nef', 2, 1)).toBe(7);
  });

  it('clamps the column to the target line length', () => {
    // line 1 ("cd") is only 2 chars — column 99 should clamp.
    expect(offsetAt('ab\ncd\nef', 1, 99)).toBe(5);
  });

  it('clamps the line to the last line index', () => {
    // 3 lines total (indices 0-2); line 99 should clamp to line 2.
    expect(offsetAt('ab\ncd\nef', 99, 1)).toBe(7);
  });
});

describe('looksLikePaste', () => {
  it('flags multi-character input as paste', () => {
    expect(looksLikePaste('abc', {})).toBe(true);
  });

  it('flags single-char with embedded newline as paste when key.return is false', () => {
    expect(looksLikePaste('a\nb', { return: false })).toBe(true);
  });

  it('treats a true Enter keypress as NOT paste', () => {
    // Ink may report empty input + key.return for Enter.
    expect(looksLikePaste('', { return: true })).toBe(false);
    expect(looksLikePaste('\n', { return: true })).toBe(false);
  });

  it('treats a single printable character as NOT paste', () => {
    expect(looksLikePaste('a', {})).toBe(false);
  });

  it('ignores empty input', () => {
    expect(looksLikePaste('', {})).toBe(false);
  });
});

describe('stripPasteMarkers', () => {
  it('removes bracketed-paste start/end escape sequences', () => {
    const ESC = String.fromCharCode(0x1b);
    const wrapped = `${ESC}[200~hello\nworld${ESC}[201~`;
    expect(stripPasteMarkers(wrapped)).toBe('hello\nworld');
  });

  it('passes plain text through unchanged', () => {
    expect(stripPasteMarkers('hello world')).toBe('hello world');
  });
});

describe('pasted text markers', () => {
  it('normalizes pasted CRLF text', () => {
    expect(normalizePastedText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('collapses only multi-line pasted text', () => {
    expect(shouldCollapsePaste('single line')).toBe(false);
    expect(shouldCollapsePaste('line 1\nline 2')).toBe(true);
  });

  it('builds a compact marker with paste id, line count, and character count', () => {
    expect(pastedTextMarker(1, 'one\ntwo\nthree')).toBe('[Pasted text #1 +3 lines, 13 chars]');
  });

  it('expands pasted text markers before submission', () => {
    const pasted = new Map([[1, 'alpha\nbeta']]);
    expect(expandPastedTextMarkers('review [Pasted text #1 +2 lines, 10 chars]', pasted)).toBe(
      'review alpha\nbeta',
    );
  });

  it('leaves unknown pasted text markers readable', () => {
    expect(expandPastedTextMarkers('[Pasted text #2 +9 lines]', new Map())).toBe(
      '[Pasted text #2 +9 lines]',
    );
  });
});
