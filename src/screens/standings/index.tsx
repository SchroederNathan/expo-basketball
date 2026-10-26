import { Host, Picker } from '@expo/ui';
import SegmentedControl from '@expo/ui/community/segmented-control';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStandings } from '@/api/queries';
import type { Standings } from '@/api/schemas';
import { leagueHeaderOptions } from '@/components/league-picker';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { StandingsTable, type StandingsSection } from '@/components/standings-table';
import type { League } from '@/domain/league';
import {
  groupLabel,
  groupsForView,
  resolveView,
  standingsViews,
  type StandingsView,
} from '@/domain/standings';
import { useCalendar } from '@/state/calendar';
import { setPreferredLeague, usePreferredLeague } from '@/state/preferences';
import { colors, layout, space, typography } from '@/theme';

// A segmented control fits up to four short labels. College leagues list
// about thirty conferences, so they get a menu instead.
const MAX_SEGMENTS = 4;

function tableSections(table: Standings, view: StandingsView): StandingsSection[] {
  return groupsForView(table, view).map((group) => ({
    key: group.id,
    title:
      view.kind === 'divisions'
        ? [group.conference, groupLabel(group)].filter(Boolean).join(' · ')
        : groupLabel(group),
    rows: group.rows,
  }));
}

type ViewPickerProps = {
  views: readonly StandingsView[];
  view: StandingsView;
  onChange: (key: string) => void;
};

function ViewPicker({ views, view, onChange }: ViewPickerProps) {
  if (views.length <= 1) return null;
  if (views.length <= MAX_SEGMENTS) {
    return (
      <SegmentedControl
        values={views.map((entry) => entry.label)}
        selectedIndex={views.findIndex((entry) => entry.key === view.key)}
        onChange={(event) => {
          const next = views[event.nativeEvent.selectedSegmentIndex];
          if (next) onChange(next.key);
        }}
        accessibilityLabel="Standings view"
        style={styles.control}
      />
    );
  }
  return (
    <View style={[styles.control, styles.menuRow]}>
      <Text style={typography.subhead}>Conference</Text>
      <Host matchContents seedColor={colors.accent}>
        <Picker selectedValue={view.key} onValueChange={onChange} appearance="menu">
          {views.map((entry) => (
            <Picker.Item key={entry.key} label={entry.label} value={entry.key} />
          ))}
        </Picker>
      </Host>
    </View>
  );
}

export function StandingsScreen() {
  const league = usePreferredLeague();
  const { zone } = useCalendar();
  const standings = useStandings({ league, zone });
  // The chosen view belongs to one league. A league change starts at its first view.
  const [choice, setChoice] = useState<{ readonly league: League; readonly key: string } | null>(null);
  const { state } = standings;
  const table = state.kind === 'ready' ? state.data : null;
  const views = table ? standingsViews(table) : [];
  const view = resolveView(views, choice?.league === league ? choice.key : null);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Standings',
          headerLargeTitleEnabled: true,
          ...leagueHeaderOptions({ value: league, onChange: setPreferredLeague }),
        }}
      />
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={standings.refreshing}
            onRefresh={standings.refresh}
            tintColor={colors.textTertiary}
          />
        }
      >
        {state.kind !== 'ready' ? (
          <QueryFallback state={state} subject="Standings" onRetry={standings.retry} />
        ) : table === null || view === null ? (
          <Notice title="No standings yet" message="This league has not published standings." />
        ) : (
          <>
            {state.refreshError ? <RefreshError error={state.refreshError} onRetry={standings.retry} /> : null}
            <ViewPicker views={views} view={view} onChange={(key) => setChoice({ league, key })} />
            {table.season ? <Text style={[typography.footnote, styles.season]}>{table.season} season</Text> : null}
            <StandingsTable league={league} sections={tableSections(table, view)} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: space.xxxl,
  },
  control: {
    marginHorizontal: layout.screenPadding,
    marginTop: space.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: layout.minTouch,
  },
  season: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.md,
  },
});
