import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Platform, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useTeam } from '@/api/queries';
import type { RosterPlayer, ScheduleGame, TeamPage } from '@/api/schemas';
import { DisplayText } from '@/components/display-text';
import { Screen } from '@/components/screen';
import { Headshot } from '@/components/headshot';
import { InvalidLink } from '@/components/invalid-link';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { RowLink } from '@/components/row-link';
import { SectionLabel } from '@/components/section-label';
import { TeamBackdrop } from '@/components/team-backdrop';
import { TeamLogo } from '@/components/team-logo';
import type { TeamRef } from '@/domain/ids';
import type { League } from '@/domain/league';
import { gameHref, parseTeamParams, playerHref } from '@/navigation/hrefs';
import { useCalendar } from '@/state/calendar';
import { colors, layout, radius, space, typography } from '@/theme';

type Row =
  | { readonly kind: 'game'; readonly key: string; readonly game: ScheduleGame }
  | { readonly kind: 'player'; readonly key: string; readonly player: RosterPlayer };

type Section = { readonly key: string; readonly title: string; readonly data: readonly Row[] };

function pageSections(page: TeamPage): Section[] {
  const sections: Section[] = [
    {
      key: 'upcoming',
      title: 'Upcoming',
      data: page.upcoming.map((game): Row => ({ kind: 'game', key: `u-${game.id}`, game })),
    },
    {
      key: 'results',
      title: 'Results',
      data: page.results.map((game): Row => ({ kind: 'game', key: `r-${game.id}`, game })),
    },
    {
      key: 'roster',
      title: 'Roster',
      data: page.roster.map((player): Row => ({ kind: 'player', key: `p-${player.id}`, player })),
    },
  ];
  return sections.filter((section) => section.data.length > 0);
}

function scheduleLabel(game: ScheduleGame): string {
  const opponent = `${game.atVs === '@' ? 'at' : 'versus'} ${game.opponent.name || game.opponent.abbr}`;
  if (game.state === 'post') {
    const outcome = game.result === 'W' ? 'won' : game.result === 'L' ? 'lost' : 'final';
    return `${game.dateLabel}, ${opponent}, ${outcome} ${game.score}`;
  }
  return `${game.dateLabel}, ${opponent}, ${game.time || game.status}`;
}

function ScheduleRow({ league, game }: { league: League; game: ScheduleGame }) {
  return (
    <RowLink href={gameHref({ league, id: game.id })} accessibilityLabel={scheduleLabel(game)} style={styles.row}>
      <Text style={[typography.subhead, styles.date]}>{game.dateLabel}</Text>
      <Text style={[typography.subhead, styles.atVs]}>{game.atVs}</Text>
      <TeamLogo uri={game.opponent.logo} abbr={game.opponent.abbr} size={24} />
      <Text numberOfLines={1} style={[typography.body, styles.opponent]}>
        {game.opponent.name || game.opponent.abbr}
      </Text>
      {game.state === 'post' ? (
        <Text style={[typography.subhead, styles.trailing]}>
          <Text style={{ color: game.result === 'W' ? colors.live : colors.textTertiary, fontWeight: '700' }}>
            {game.result}{' '}
          </Text>
          <Text style={{ color: colors.text }}>{game.score}</Text>
        </Text>
      ) : (
        <Text numberOfLines={1} style={[typography.subhead, styles.trailing, { color: game.state === 'in' ? colors.live : colors.textSecondary }]}>
          {game.state === 'in' ? 'Live' : game.time || game.status}
        </Text>
      )}
    </RowLink>
  );
}

function RosterRow({ league, player }: { league: League; player: RosterPlayer }) {
  const meta = [player.jersey ? `#${player.jersey}` : '', player.position, player.detail].filter(Boolean).join(' · ');
  return (
    <RowLink
      href={playerHref({ league, id: player.id })}
      accessibilityLabel={[player.name, meta, player.injury ? `injury status ${player.injury}` : ''].filter(Boolean).join(', ')}
      style={styles.row}
    >
      <Headshot uri={player.headshot} name={player.name} size={40} />
      <View style={styles.playerText}>
        <Text numberOfLines={1} style={[typography.body, { fontWeight: '500' }]}>
          {player.name}
        </Text>
        <Text numberOfLines={1} style={typography.footnote}>
          {meta}
        </Text>
      </View>
      {player.injury ? (
        <View style={styles.injury}>
          <Text style={[typography.caption, { color: colors.live, fontWeight: '700' }]}>{player.injury}</Text>
        </View>
      ) : null}
    </RowLink>
  );
}

function TeamHeader({ page }: { page: TeamPage }) {
  const splits = [page.team.home ? `Home ${page.team.home}` : '', page.team.road ? `Road ${page.team.road}` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.header}>
      <TeamLogo uri={page.team.logo} abbr={page.team.abbr} size={96} />
      <Text selectable style={[typography.title, { textAlign: 'center' }]}>
        {page.team.fullName || page.team.name}
      </Text>
      {page.team.record ? (
        <DisplayText size="large" accessibilityLabel={`Record ${page.team.record}`}>
          {page.team.record}
        </DisplayText>
      ) : null}
      {page.team.standing ? <Text style={[typography.subhead, { textAlign: 'center' }]}>{page.team.standing}</Text> : null}
      {splits ? <Text style={[typography.footnote, { textAlign: 'center' }]}>{splits}</Text> : null}
    </View>
  );
}

export function TeamScreen() {
  const ref = parseTeamParams(useLocalSearchParams());
  if (ref === null) return <InvalidLink subject="team" />;
  return <TeamDetail key={`${ref.league}:${ref.id}`} teamRef={ref} />;
}

function TeamDetail({ teamRef }: { teamRef: TeamRef }) {
  const { zone } = useCalendar();
  const headerHeight = useHeaderHeight();
  const team = useTeam({ ref: teamRef, zone });
  const { state } = team;
  const page = state.kind === 'ready' ? state.data : null;
  const ios = Platform.OS === 'ios';
  return (
    <Screen>
      <Stack.Screen options={{ title: page?.team.name ?? 'Team', headerTransparent: true }} />
      <SectionList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        sections={page ? pageSections(page) : []}
        keyExtractor={(row) => row.key}
        stickySectionHeadersEnabled={false}
        renderItem={({ item }) =>
          item.kind === 'game' ? (
            <ScheduleRow league={teamRef.league} game={item.game} />
          ) : (
            <RosterRow league={teamRef.league} player={item.player} />
          )
        }
        renderSectionHeader={({ section }) => <SectionLabel>{section.title}</SectionLabel>}
        ListHeaderComponent={
          <View style={{ paddingTop: ios ? 0 : headerHeight }}>
            {page ? (
              <>
                <TeamBackdrop backdrop={{ kind: 'team', color: page.team.accent }} top={ios ? -headerHeight : 0} />
                <TeamHeader page={page} />
              </>
            ) : null}
            {state.kind === 'ready' && state.refreshError ? (
              <RefreshError error={state.refreshError} onRetry={team.retry} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          state.kind === 'ready' ? undefined : (
            <QueryFallback state={state} subject="This team" onRetry={team.retry} />
          )
        }
        ListFooterComponent={<View style={{ height: space.xxxl }} />}
        refreshControl={
          <RefreshControl
            refreshing={team.refreshing}
            onRefresh={team.refresh}
            tintColor={colors.textTertiary}
            progressViewOffset={ios ? 0 : headerHeight}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  date: {
    width: 56,
    color: colors.textTertiary,
  },
  atVs: {
    width: 22,
    color: colors.textTertiary,
  },
  opponent: {
    flex: 1,
    fontWeight: '500',
  },
  trailing: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  playerText: {
    flex: 1,
    gap: space.xxs,
  },
  injury: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.sm,
    backgroundColor: colors.fill,
  },
});
