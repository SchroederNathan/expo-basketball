import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { HeaderIconButton } from '@/components/header-icon-button';
import { leagueHeaderOptions } from '@/components/league-picker';
import { dayWindow, shortDateLabel, windowIndex, type Ymd } from '@/domain/dates';
import type { League } from '@/domain/league';
import { parseScoresParams } from '@/navigation/hrefs';
import { useCalendar } from '@/state/calendar';
import { setPreferredLeague, usePreferredLeague } from '@/state/preferences';
import { useReducedMotion } from '@/state/reduced-motion';
import { colors, space, typography } from '@/theme';
import { CALENDAR_AVAILABLE, DateSheet } from './date-sheet';
import { DateStrip } from './date-strip';
import { DayPage } from './day-page';

// Pages cover the anchor day plus 30 days either side. A date outside that
// window moves the anchor, which rebuilds the pager around the new date.
const PAGER_RADIUS = 30;
const WEB_SETTLE_MS = 120;

export function ScoresScreen() {
  const params = parseScoresParams(useLocalSearchParams());
  const router = useRouter();
  const preferred = usePreferredLeague();
  const league = params.league ?? preferred;
  const { zone, today } = useCalendar();
  const selected = params.date ?? today;
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [anchor, setAnchor] = useState(selected);
  if (windowIndex(anchor, selected, PAGER_RADIUS) === null) setAnchor(selected);
  const dates = dayWindow(anchor, PAGER_RADIUS);
  const selectedIndex = windowIndex(anchor, selected, PAGER_RADIUS) ?? PAGER_RADIUS;

  const listRef = useRef<FlatList<Ymd>>(null);
  const pageIndex = useRef(selectedIndex);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A link or a push can name a league. It becomes the browse league, so every
  // tab agrees, and the parameter is cleared so later picker choices stick.
  useEffect(() => {
    if (params.league === null) return;
    setPreferredLeague(params.league);
    router.setParams({ league: undefined });
  }, [params.league, router]);

  // A longer jump skips the pages between, so their scoreboards never load.
  useEffect(() => {
    const distance = Math.abs(pageIndex.current - selectedIndex);
    if (distance === 0) return;
    pageIndex.current = selectedIndex;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: distance === 1 && !reducedMotion });
  }, [selectedIndex, reducedMotion]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Today has no date parameter, so the screen follows the calendar past midnight.
  const selectDate = (date: Ymd) => {
    setCalendarOpen(false);
    router.setParams({ date: date === today ? undefined : date });
  };

  const changeLeague = (next: League) => {
    setPreferredLeague(next);
    router.setParams({ league: undefined, date: undefined });
  };

  const settleAt = (offsetX: number) => {
    const index = Math.round(offsetX / width);
    const date = dates[index];
    if (date === undefined) return;
    pageIndex.current = index;
    if (date !== selected) selectDate(date);
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    settleAt(event.nativeEvent.contentOffset.x);
  };

  // Web scroll views send no momentum events, so a short pause marks the settle.
  const onWebScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settleAt(offsetX), WEB_SETTLE_MS);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: shortDateLabel(selected),
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          ...leagueHeaderOptions({ value: league, onChange: changeLeague }),
          headerRight: () => (
            <View style={styles.headerActions}>
              {selected !== today ? (
                <Pressable
                  onPress={() => selectDate(today)}
                  accessibilityRole="button"
                  accessibilityLabel="Go to today"
                  hitSlop={6}
                  style={({ pressed }) => [styles.todayButton, pressed ? { opacity: 0.5 } : null]}
                >
                  <Text style={[typography.callout, { color: colors.accent, fontWeight: '600' }]}>Today</Text>
                </Pressable>
              ) : null}
              {CALENDAR_AVAILABLE ? (
                <HeaderIconButton
                  icon={{ ios: 'calendar', android: 'calendar_month' }}
                  label="Choose a date"
                  onPress={() => setCalendarOpen(true)}
                />
              ) : null}
              <HeaderIconButton
                icon={{ ios: 'bell', android: 'notifications' }}
                label="Notification settings"
                onPress={() => router.push('/notifications')}
              />
            </View>
          ),
        }}
      />
      <DateStrip selected={selected} today={today} onSelect={selectDate} />
      <FlatList
        key={`${league}:${anchor}:${width}`}
        ref={listRef}
        style={styles.pager}
        data={dates}
        keyExtractor={(date) => date}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        initialScrollIndex={selectedIndex}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScroll={Platform.OS === 'web' ? onWebScroll : undefined}
        scrollEventThrottle={Platform.OS === 'web' ? 64 : undefined}
        renderItem={({ item }) => (
          <DayPage league={league} date={item} zone={zone} visible={item === selected} width={width} />
        )}
      />
      <DateSheet
        visible={calendarOpen}
        value={selected}
        today={today}
        onSelect={selectDate}
        onDismiss={() => setCalendarOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pager: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  todayButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
