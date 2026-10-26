import { Pressable, StyleSheet, Text, View } from 'react-native';
import { dayCells, longDateLabel, type Ymd } from '@/domain/dates';
import { colors, space } from '@/theme';

const STRIP_RADIUS = 3;

type DateStripProps = {
  selected: Ymd;
  today: Ymd;
  onSelect: (date: Ymd) => void;
};

// Built from the calendar alone, so it works before any score has loaded.
export function DateStrip({ selected, today, onSelect }: DateStripProps) {
  return (
    <View style={styles.strip}>
      {dayCells(selected, today, STRIP_RADIUS).map((cell) => {
        const isSelected = cell.date === selected;
        return (
          <Pressable
            key={cell.date}
            onPress={() => onSelect(cell.date)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${cell.isToday ? 'Today, ' : ''}${longDateLabel(cell.date)}`}
            style={({ pressed }) => [styles.cell, pressed ? { opacity: 0.6 } : null]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.weekday,
                { color: isSelected ? colors.text : cell.isToday ? colors.accent : colors.textMuted },
              ]}
            >
              {cell.isToday ? 'TODAY' : cell.weekday}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.day,
                isSelected ? { color: colors.text, fontSize: 26 } : { color: colors.textMuted },
              ]}
            >
              {cell.day}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    paddingHorizontal: space.xs,
    paddingBottom: space.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  cell: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  weekday: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  day: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
