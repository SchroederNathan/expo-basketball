import { BottomSheet, Button, Column } from '@expo/ui';
import { DatePicker } from '@expo/ui/swift-ui';
import { datePickerStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { localNoon, ymdFromLocalDate } from '@/domain/dates';
import { colors } from '@/theme';
import type { DateSheetProps } from './date-sheet.types';

export const CALENDAR_AVAILABLE = true;

// A native sheet with the graphical calendar. Picking a day commits it.
export function DateSheet({ visible, value, today, onSelect, onDismiss }: DateSheetProps) {
  return (
    <BottomSheet isPresented={visible} onDismiss={onDismiss}>
      <Column spacing={12}>
        <DatePicker
          selection={localNoon(value)}
          displayedComponents={['date']}
          onDateChange={(picked) => {
            const date = ymdFromLocalDate(picked);
            if (date !== null && date !== value) onSelect(date);
          }}
          modifiers={[datePickerStyle('graphical'), tint(colors.accent)]}
        />
        <Button label="Today" variant="text" onPress={() => onSelect(today)} />
      </Column>
    </BottomSheet>
  );
}
