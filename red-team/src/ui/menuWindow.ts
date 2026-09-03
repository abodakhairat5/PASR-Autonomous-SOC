// Shared windowing math for the slash + @file pickers. Both menus cap
// the number of visible rows to keep the bottom of the screen quiet;
// when the list is longer than the cap, the visible window centers on
// the selection so the user can scroll without losing context.
//
// Sliding-window math for the suggestion menu:
//   start = max(0, min(selected - floor(cap/2), total - cap))
//   end   = min(start + cap, total)

export const MENU_VISIBLE_CAP = 5;

export interface MenuWindow {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

export function computeMenuWindow(
  total: number,
  selected: number,
  cap = MENU_VISIBLE_CAP,
): MenuWindow {
  if (total <= cap) {
    return { start: 0, end: total, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const start = Math.max(0, Math.min(selected - Math.floor(cap / 2), total - cap));
  const end = Math.min(start + cap, total);
  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: total - end,
  };
}
