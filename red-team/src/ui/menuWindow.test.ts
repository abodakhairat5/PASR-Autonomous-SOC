// Windowing math test for the slash + @file pickers. The behavior we
// care about: short lists show everything; long lists show a 5-item
// window centered on the selection; the window clamps at both ends so
// the cursor doesn't slide off-screen.

import { describe, expect, it } from 'vitest';
import { computeMenuWindow } from './menuWindow.js';

describe('computeMenuWindow', () => {
  it('shows the full list when it fits within the cap', () => {
    const w = computeMenuWindow(3, 1);
    expect(w).toEqual({ start: 0, end: 3, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it('exactly at cap: no overflow', () => {
    const w = computeMenuWindow(5, 2);
    expect(w).toEqual({ start: 0, end: 5, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it('centers the window on the selection mid-list', () => {
    // 20 items, selected #10, cap=5 → start = 10 - 2 = 8, end = 13
    const w = computeMenuWindow(20, 10);
    expect(w.start).toBe(8);
    expect(w.end).toBe(13);
    expect(w.hiddenAbove).toBe(8);
    expect(w.hiddenBelow).toBe(7);
  });

  it('clamps to the start when selection is near the top', () => {
    const w = computeMenuWindow(20, 0);
    expect(w.start).toBe(0);
    expect(w.end).toBe(5);
    expect(w.hiddenAbove).toBe(0);
    expect(w.hiddenBelow).toBe(15);
  });

  it('clamps to the end when selection is near the bottom', () => {
    const w = computeMenuWindow(20, 19);
    expect(w.start).toBe(15);
    expect(w.end).toBe(20);
    expect(w.hiddenAbove).toBe(15);
    expect(w.hiddenBelow).toBe(0);
  });

  it('honors a custom cap', () => {
    const w = computeMenuWindow(20, 10, 3);
    expect(w.end - w.start).toBe(3);
  });

  it('empty list returns zeros', () => {
    const w = computeMenuWindow(0, 0);
    expect(w).toEqual({ start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 });
  });
});
