import DateTimePicker from '@expo/ui/community/datetime-picker';
import { localNoon, ymdFromLocalDate } from '@/domain/dates';
import { colors } from '@/theme';
import type { DateSheetProps } from './date-sheet.types';

export const CALENDAR_AVAILABLE = true;

// The Material date dialog appears while this is mounted.
export function DateSheet({ visible, value, onSelect, onDismiss }: DateSheetProps) {
  if (!visible) return null;
  return (
    <DateTimePicker
      value={localNoon(value)}
      mode="date"
      presentation="dialog"
      accentColor={colors.accent}
      onDismiss={onDismiss}
      onChange={(_event, picked) => {
        const date = picked ? ymdFromLocalDate(picked) : null;
        if (date === null) onDismiss();
        else onSelect(date);
      }}
    />
  );
}
