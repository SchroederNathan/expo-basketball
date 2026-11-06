import { useLayoutEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { dayCells, longDateLabel, type Ymd } from '@/domain/dates';
import { colors, space } from '@/theme';

// Seven cells fill the width; the rest of the range is reached by scrolling.
const VISIBLE_CELLS = 7;
const STRIP_RADIUS = 30;

type DateStripProps = {
  selected: Ymd;
  today: Ymd;
  onSelect: (date: Ymd) => void;
};

// Built from the calendar alone, so it works before any score has loaded.
export function DateStrip({ selected, today, onSelect }: DateStripProps) {
  const { width } = useWindowDimensions();
  const cellWidth = (width - space.xs * 2) / VISIBLE_CELLS;
  // The cells are rebuilt around the selected day, so its centred offset is constant.
  const centredOffset = (STRIP_RADIUS - Math.floor(VISIBLE_CELLS / 2)) * cellWidth;
  const scrollRef = useRef<ScrollViewInstance>(null);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ x: centredOffset, animated: false });
  }, [selected, centredOffset]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: centredOffset, y: 0 }}
      style={styles.strip}
      contentContainerStyle={styles.content}
    >
      {dayCells(selected, today, STRIP_RADIUS).map((cell) => {
        const isSelected = cell.date === selected;
        return (
          <Pressable
            key={cell.date}
            onPress={() => onSelect(cell.date)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${cell.isToday ? 'Today, ' : ''}${longDateLabel(cell.date)}`}
            style={({ pressed }) => [styles.cell, { width: cellWidth }, pressed ? { opacity: 0.6 } : null]}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexGrow: 0,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  content: {
    paddingHorizontal: space.xs,
    paddingBottom: space.sm,
  },
  cell: {
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
