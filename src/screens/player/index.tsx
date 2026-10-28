import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePlayer } from '@/api/queries';
import type { GameLogRow, PlayerPage } from '@/api/schemas';
import { Chevron } from '@/components/chevron';
import { Screen } from '@/components/screen';
import { DisplayText } from '@/components/display-text';
import { Headshot } from '@/components/headshot';
import { InfoRows } from '@/components/info-rows';
import { InvalidLink } from '@/components/invalid-link';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { RowLink } from '@/components/row-link';
import { SectionLabel } from '@/components/section-label';
import { TeamLogo } from '@/components/team-logo';
import type { PlayerRef } from '@/domain/ids';
import type { League } from '@/domain/league';
import { gameHref, parsePlayerParams, teamHref } from '@/navigation/hrefs';
import { useCalendar } from '@/state/calendar';
import { colors, layout, radius, space, typography } from '@/theme';

const LOG_COLUMNS = [
  { key: 'min', label: 'MIN', spoken: 'minutes' },
  { key: 'pts', label: 'PTS', spoken: 'points' },
  { key: 'reb', label: 'REB', spoken: 'rebounds' },
  { key: 'ast', label: 'AST', spoken: 'assists' },
] as const satisfies readonly { key: keyof GameLogRow; label: string; spoken: string }[];

function SeasonStats({ player }: { player: PlayerPage['player'] }) {
  if (player.stats.length === 0) return null;
  return (
    <>
      <SectionLabel>{player.season || 'Season averages'}</SectionLabel>
      <View style={styles.tiles}>
        {player.stats.map((stat) => (
          <View
            key={stat.label}
            accessible
            accessibilityLabel={`${stat.label} ${stat.value}${stat.rank ? `, ranked ${stat.rank}` : ''}`}
            style={styles.tile}
          >
            <DisplayText size="medium" numberOfLines={1} adjustsFontSizeToFit>
              {stat.value || '–'}
            </DisplayText>
            <Text style={typography.label}>{stat.label}</Text>
            {stat.rank ? (
              <Text numberOfLines={1} style={[typography.caption, { color: colors.live, fontWeight: '700' }]}>
                {stat.rank}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </>
  );
}

function GameLog({ league, games }: { league: League; games: readonly GameLogRow[] }) {
  if (games.length === 0) return null;
  return (
    <>
      <SectionLabel>Recent games</SectionLabel>
      <View style={[styles.logRow, styles.logHeader]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.logGame} />
        {LOG_COLUMNS.map((column) => (
          <Text key={column.key} style={[typography.caption, styles.logCell]}>
            {column.label}
          </Text>
        ))}
      </View>
      {games.map((game) => (
        <RowLink
          key={game.id}
          href={gameHref({ league, id: game.id })}
          accessibilityLabel={[
            `${game.dateLabel} ${game.opponent}`,
            game.result,
            ...LOG_COLUMNS.map((column) => `${game[column.key] || 'no'} ${column.spoken}`),
          ].join(', ')}
          style={styles.logRow}
        >
          <View style={styles.logGame}>
            <Text numberOfLines={1} style={[typography.body, { fontWeight: '600' }]}>
              {`${game.dateLabel} ${game.opponent}`}
            </Text>
            <Text style={[typography.footnote, { color: game.win ? colors.live : colors.textTertiary, fontVariant: ['tabular-nums'] }]}>
              {game.result}
            </Text>
          </View>
          {LOG_COLUMNS.map((column) => (
            <Text
              key={column.key}
              style={[
                typography.body,
                styles.logCell,
                column.key === 'pts' ? { color: colors.text, fontWeight: '700' } : { color: colors.textSecondary },
              ]}
            >
              {game[column.key] || '–'}
            </Text>
          ))}
        </RowLink>
      ))}
    </>
  );
}

function PlayerHeader({ league, page }: { league: League; page: PlayerPage }) {
  const { player } = page;
  const meta = [player.jersey, player.position].filter(Boolean).join(' · ');
  return (
    <View style={styles.header}>
      <Headshot uri={player.headshot} name={player.name} size={120} />
      <Text selectable style={[typography.title, { textAlign: 'center' }]}>
        {player.name}
      </Text>
      {meta ? <Text style={[typography.subhead, { textAlign: 'center' }]}>{meta}</Text> : null}
      {player.team ? (
        <RowLink
          href={teamHref({ league, id: player.team.id })}
          accessibilityLabel={`Team: ${player.team.name}`}
          style={styles.teamLink}
        >
          <TeamLogo uri={player.team.logo} abbr={player.team.abbr} size={20} />
          <Text numberOfLines={1} style={[typography.callout, { flexShrink: 1 }]}>
            {player.team.name}
          </Text>
          <Chevron />
        </RowLink>
      ) : null}
    </View>
  );
}

export function PlayerScreen() {
  const ref = parsePlayerParams(useLocalSearchParams());
  if (ref === null) return <InvalidLink subject="player" />;
  return <PlayerDetail key={`${ref.league}:${ref.id}`} playerRef={ref} />;
}

function PlayerDetail({ playerRef }: { playerRef: PlayerRef }) {
  const { zone } = useCalendar();
  const player = usePlayer({ ref: playerRef, zone });
  const { state } = player;
  return (
    <Screen>
      <Stack.Screen options={{ title: state.kind === 'ready' ? state.data.player.name : 'Player' }} />
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={player.refreshing} onRefresh={player.refresh} tintColor={colors.textTertiary} />
        }
      >
        {state.kind === 'ready' ? (
          <>
            {state.refreshError ? <RefreshError error={state.refreshError} onRetry={player.retry} /> : null}
            <PlayerHeader league={playerRef.league} page={state.data} />
            <SeasonStats player={state.data.player} />
            <GameLog league={playerRef.league} games={state.data.games} />
            {state.data.player.bio.length > 0 ? (
              <>
                <SectionLabel>Bio</SectionLabel>
                <InfoRows lines={state.data.player.bio} />
              </>
            ) : null}
          </>
        ) : (
          <QueryFallback state={state} subject="This player" onRetry={player.retry} />
        )}
      </ScrollView>
    </Screen>
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
  header: {
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.lg,
  },
  teamLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    gap: space.xxs,
    padding: space.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  logHeader: {
    paddingVertical: space.xs,
  },
  logGame: {
    flex: 1,
    gap: space.xxs,
  },
  logCell: {
    width: 40,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
