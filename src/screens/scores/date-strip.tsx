import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { addDays, daysBetween, longDateLabel, weekdayLabel, type Ymd } from '@/domain/dates';
import { colors, space } from '@/theme';
import {
  cellEmphasis,
  cellOnScreen,
  STRIP_CELLS,
  stripOffsets,
  stripTranslate,
} from './strip-motion';

const SELECTED_SCALE = 26 / 22;

type DateStripProps = {
  // The fixed date that strip positions count from.
  base: Ymd;
  // Days from `base` to the day under the pager, updated on every scroll frame.
  position: SharedValue<number>;
  selected: Ymd;
  today: Ymd;
  reducedMotion: boolean;
  onSelect: (date: Ymd) => void;
};

// Built from the calendar alone, so it works before any score has loaded.
// The row slides with the day pager, so the strip moves with the finger.
// With reduced motion it holds still and jumps when the pager settles.
export function DateStrip({ base, position, selected, today, reducedMotion, onSelect }: DateStripProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [innerWidth, setInnerWidth] = useState<number | null>(null);
  const cellWidth = (innerWidth ?? windowWidth - space.xs * 2) / STRIP_CELLS;
  const selectedOffset = daysBetween(base, selected);

  const rowStyle = useAnimatedStyle(() => {
    const at = reducedMotion ? selectedOffset : position.get();
    return { transform: [{ translateX: stripTranslate(at, cellWidth) }] };
  });

  return (
    <View style={styles.strip}>
      <View style={styles.viewport} onLayout={(event) => setInnerWidth(event.nativeEvent.layout.width)}>
        {/* Sizes the strip in normal flow, so it grows with the text size. */}
        <View style={styles.sizer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.weekday, styles.hidden]}>TODAY</Text>
          <Text style={[styles.day, styles.hidden]}>30</Text>
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, rowStyle]}>
          {stripOffsets(selectedOffset).map((offset) => {
            const date = addDays(base, offset);
            return (
              <DateCell
                key={date}
                date={date}
                offset={offset}
                left={offset * cellWidth}
                width={cellWidth}
                isSelected={date === selected}
                isToday={date === today}
                onScreen={cellOnScreen(offset, selectedOffset)}
                position={position}
                selectedOffset={selectedOffset}
                reducedMotion={reducedMotion}
                onSelect={onSelect}
              />
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
}

type DateCellProps = {
  date: Ymd;
  offset: number;
  left: number;
  width: number;
  isSelected: boolean;
  isToday: boolean;
  onScreen: boolean;
  position: SharedValue<number>;
  selectedOffset: number;
  reducedMotion: boolean;
  onSelect: (date: Ymd) => void;
};

function DateCell({
  date,
  offset,
  left,
  width,
  isSelected,
  isToday,
  onScreen,
  position,
  selectedOffset,
  reducedMotion,
  onSelect,
}: DateCellProps) {
  const restColor = isToday ? colors.accent : colors.textMuted;

  const weekdayStyle = useAnimatedStyle(() => {
    const emphasis = cellEmphasis(offset, reducedMotion ? selectedOffset : position.get());
    return { color: interpolateColor(emphasis, [0, 1], [restColor, colors.text]) };
  });
  const dayStyle = useAnimatedStyle(() => {
    const emphasis = cellEmphasis(offset, reducedMotion ? selectedOffset : position.get());
    return {
      color: interpolateColor(emphasis, [0, 1], [colors.textMuted, colors.text]),
      transform: [{ scale: 1 + (SELECTED_SCALE - 1) * emphasis }],
    };
  });

  return (
    <Pressable
      onPress={() => onSelect(date)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${isToday ? 'Today, ' : ''}${longDateLabel(date)}`}
      accessibilityElementsHidden={!onScreen}
      importantForAccessibility={onScreen ? 'auto' : 'no-hide-descendants'}
      style={({ pressed }) => [styles.cell, { left, width }, pressed ? { opacity: 0.6 } : null]}
    >
      <Animated.Text numberOfLines={1} adjustsFontSizeToFit style={[styles.weekday, weekdayStyle]}>
        {isToday ? 'TODAY' : weekdayLabel(date)}
      </Animated.Text>
      <Animated.Text numberOfLines={1} adjustsFontSizeToFit style={[styles.day, dayStyle]}>
        {Number(date.slice(6, 8))}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: space.xs,
    paddingBottom: space.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  viewport: {
    overflow: 'hidden',
  },
  sizer: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxs,
  },
  hidden: {
    opacity: 0,
  },
  cell: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
