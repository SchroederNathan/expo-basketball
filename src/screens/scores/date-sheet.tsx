import type { DateSheetProps } from './date-sheet.types';

// The web build has no native date picker, so the strip and swipes move days.
export const CALENDAR_AVAILABLE = false;

export function DateSheet(_props: DateSheetProps) {
  return null;
}
