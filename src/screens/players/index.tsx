import SegmentedControl from '@expo/ui/community/segmented-control';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useLeaders } from '@/api/queries';
import type { LeaderRow as LeaderRowData } from '@/api/schemas';
import { DisplayText } from '@/components/display-text';
import { Headshot } from '@/components/headshot';
import { leagueHeaderOptions } from '@/components/league-picker';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { RowLink } from '@/components/row-link';
import { TeamLogo } from '@/components/team-logo';
import {
  DEFAULT_LEADER_STAT,
  LEADER_STAT_LABELS,
  LEADER_STATS,
  type LeaderStat,
} from '@/domain/leaders';
import type { League } from '@/domain/league';
import { playerHref } from '@/navigation/hrefs';
import { setPreferredLeague, usePreferredLeague } from '@/state/preferences';
import { colors, layout, space, typography } from '@/theme';

function LeaderRow({ league, row, statLabel }: { league: League; row: LeaderRowData; statLabel: string }) {
  const team = [row.team, row.position].filter(Boolean).join(' · ');
  return (
    <RowLink
      href={playerHref({ league, id: row.id })}
      accessibilityLabel={`${row.rank}. ${row.name}, ${team}, ${row.value} ${statLabel}`}
      style={styles.row}
    >
      <Text style={[typography.footnote, styles.rank]}>{row.rank}</Text>
      <Headshot uri={row.headshot} name={row.name} size={44} />
      <View style={styles.player}>
        <Text numberOfLines={1} style={[typography.body, { fontWeight: '600' }]}>
          {row.name}
        </Text>
        <View style={styles.team}>
          {row.teamLogo ? <TeamLogo uri={row.teamLogo} abbr={row.team} size={16} /> : null}
          <Text numberOfLines={1} style={[typography.footnote, { flexShrink: 1 }]}>
            {team}
          </Text>
        </View>
      </View>
      <DisplayText size="small">{row.value}</DisplayText>
    </RowLink>
  );
}

export function PlayersScreen() {
  const league = usePreferredLeague();
  // The stat belongs to one league. A league change starts again at points.
  const [choice, setChoice] = useState<{ readonly league: League; readonly stat: LeaderStat } | null>(null);
  const stat = choice?.league === league ? choice.stat : DEFAULT_LEADER_STAT;
  const leaders = useLeaders({ league, stat });
  const { state } = leaders;
  const statLabel = LEADER_STAT_LABELS[stat];
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Players',
          headerLargeTitleEnabled: true,
          ...leagueHeaderOptions({ value: league, onChange: setPreferredLeague }),
        }}
      />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={state.kind === 'ready' ? state.data.players : []}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <LeaderRow league={league} row={item} statLabel={statLabel} />}
        ListHeaderComponent={
          <View>
            <SegmentedControl
              values={LEADER_STATS.map((entry) => LEADER_STAT_LABELS[entry])}
              selectedIndex={LEADER_STATS.indexOf(stat)}
              onChange={(event) => {
                const next = LEADER_STATS[event.nativeEvent.selectedSegmentIndex];
                if (next) setChoice({ league, stat: next });
              }}
              accessibilityLabel="Leader statistic"
              style={styles.control}
            />
            {state.kind === 'ready' && state.data.season ? (
              <Text style={[typography.footnote, styles.season]}>{`${state.data.season} per-game leaders`}</Text>
            ) : null}
            {state.kind === 'ready' && state.refreshError ? (
              <RefreshError error={state.refreshError} onRetry={leaders.retry} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          state.kind === 'ready' ? (
            <Notice title="No leaders yet" message="Leaders appear once the season has games." />
          ) : (
            <QueryFallback state={state} subject="Leaders" onRetry={leaders.retry} />
          )
        }
        ListFooterComponent={<View style={{ height: space.xxl }} />}
        refreshControl={
          <RefreshControl refreshing={leaders.refreshing} onRefresh={leaders.refresh} tintColor={colors.textTertiary} />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  control: {
    marginHorizontal: layout.screenPadding,
    marginTop: space.sm,
  },
  season: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowHeight + space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rank: {
    width: 22,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  player: {
    flex: 1,
    gap: space.xxs,
  },
  team: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
