// Pure math that ties the date strip to the day pager. The strip measures
// positions in days from a fixed base date, so the same value stays correct
// when the pager rebuilds around a new anchor.

// Cells on each side of the center cell.
export const STRIP_RADIUS = 3;
export const STRIP_CELLS = STRIP_RADIUS * 2 + 1;

// Extra cells rendered past each edge, so a swipe never reveals an empty slot
// before the pager settles and the strip re-centers its window.
export const STRIP_BUFFER = 2;

// The strip position, in days from the base date, for a pager offset.
// `anchorOffset` is the pager anchor's distance from the base date, and
// `radius` is the number of pages either side of the anchor.
export function pagerPosition(
  offsetX: number,
  pageWidth: number,
  anchorOffset: number,
  radius: number,
): number {
  'worklet';
  if (pageWidth <= 0) return anchorOffset;
  return anchorOffset + offsetX / pageWidth - radius;
}

// The row translation that puts the day at `position` in the center cell.
export function stripTranslate(position: number, cellWidth: number): number {
  'worklet';
  return (STRIP_RADIUS - position) * cellWidth;
}

// How selected a cell looks: 1 at the center, 0 one cell or more away.
export function cellEmphasis(cellOffset: number, position: number): number {
  'worklet';
  return Math.max(0, 1 - Math.abs(cellOffset - position));
}

// The day offsets the strip renders around the selected day.
export function stripOffsets(selectedOffset: number): number[] {
  const reach = STRIP_RADIUS + STRIP_BUFFER;
  return Array.from({ length: reach * 2 + 1 }, (_, index) => selectedOffset - reach + index);
}

// Only the seven cells on screen at rest are reachable by assistive tech.
export function cellOnScreen(cellOffset: number, selectedOffset: number): boolean {
  return Math.abs(cellOffset - selectedOffset) <= STRIP_RADIUS;
}
