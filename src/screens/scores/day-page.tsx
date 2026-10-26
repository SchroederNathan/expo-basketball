import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useScoreboard } from '@/api/queries';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { longDateLabel, type IanaZone, type Ymd } from '@/domain/dates';
import type { League } from '@/domain/league';
import { colors, layout } from '@/theme';
import { ScoreRow } from './score-row';

type DayPageProps = {
  league: League;
  date: Ymd;
  zone: IanaZone;
  visible: boolean;
  width: number;
};

function Separator() {
  return <View style={styles.separator} />;
}

// One day of games. Neighbor pages mount beside the visible one, so their
// requests run as prefetches. Only the visible page polls.
export function DayPage({ league, date, zone, visible, width }: DayPageProps) {
  const scoreboard = useScoreboard({ league, date, zone, visible });
  const { state } = scoreboard;
  return (
    <FlatList
      style={{ width }}
      contentInsetAdjustmentBehavior="automatic"
      data={state.kind === 'ready' ? state.data.games : []}
      keyExtractor={(game) => game.id}
      renderItem={({ item }) => <ScoreRow game={item} />}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        state.kind === 'ready' && state.refreshError ? (
          <RefreshError error={state.refreshError} onRetry={scoreboard.retry} />
        ) : undefined
      }
      ListEmptyComponent={
        state.kind === 'ready' ? (
          <Notice title={`No games on ${longDateLabel(date)}`} message="Swipe or pick another day." />
        ) : (
          <QueryFallback state={state} subject="Scores" onRetry={scoreboard.retry} />
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={scoreboard.refreshing}
          onRefresh={scoreboard.refresh}
          tintColor={colors.textTertiary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: layout.screenPadding,
    backgroundColor: colors.hairline,
  },
});
