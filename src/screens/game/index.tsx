import SegmentedControl from '@expo/ui/community/segmented-control';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { FlatList, Platform, RefreshControl, Share, StyleSheet, View } from 'react-native';
import { usePlays, useGame, useSeedGame } from '@/api/queries';
import type { Game, Play } from '@/api/schemas';
import { HeaderIconButton } from '@/components/header-icon-button';
import { Screen } from '@/components/screen';
import { InfoRows } from '@/components/info-rows';
import { InvalidLink } from '@/components/invalid-link';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { SectionLabel } from '@/components/section-label';
import { TeamBackdrop } from '@/components/team-backdrop';
import { gameTitle, gameWebUrl } from '@/domain/game';
import type { GameRef } from '@/domain/ids';
import { playsInPeriod, resolvePeriod, type PeriodChoice } from '@/domain/plays';
import { parseGameParams } from '@/navigation/hrefs';
import { useCalendar } from '@/state/calendar';
import { colors, layout, space } from '@/theme';
import { BoxScore } from './box-score';
import { FlowChart } from './flow-chart';
import { GameStandings } from './game-standings';
import { GameHero, GameStatusTitle } from './hero';
import { GameLeaders } from './leaders';
import { Linescore } from './linescore';
import { PeriodChips, PlayRow } from './plays';

type Section = 'box' | 'plays' | 'standings';

const SECTIONS: readonly { readonly key: Section; readonly label: string }[] = [
  { key: 'box', label: 'Box Score' },
  { key: 'plays', label: 'Plays' },
  { key: 'standings', label: 'Standings' },
];

type ListItem =
  | { readonly kind: 'box'; readonly key: string }
  | { readonly kind: 'standings'; readonly key: string }
  | { readonly kind: 'play'; readonly key: string; readonly play: Play };

async function shareGame(game: Game): Promise<void> {
  const title = gameTitle(game);
  const url = gameWebUrl(game);
  try {
    await Share.share(Platform.OS === 'ios' ? { message: title, url } : { title, message: `${title}\n${url}` });
  } catch {
    // The share sheet is unavailable here, for example in a browser without it.
  }
}

export function GameScreen() {
  const ref = parseGameParams(useLocalSearchParams());
  if (ref === null) return <InvalidLink subject="game" />;
  return <GameDetail key={`${ref.league}:${ref.id}`} gameRef={ref} />;
}

function GameDetail({ gameRef }: { gameRef: GameRef }) {
  const { zone } = useCalendar();
  const headerHeight = useHeaderHeight();
  const seed = useSeedGame(gameRef);
  const detail = useGame({ ref: gameRef, zone });
  const [section, setSection] = useState<Section>('box');
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>({ kind: 'latest' });
  const [boxSide, setBoxSide] = useState(0);
  const [standingsIndex, setStandingsIndex] = useState(0);

  const data = detail.state.kind === 'ready' ? detail.state.data : null;
  const game = data?.game ?? seed;
  const plays = usePlays({
    ref: gameRef,
    enabled: section === 'plays' && data !== null,
    pollSeconds: data?.pollSeconds ?? 0,
    live: data?.game.state === 'in',
  });

  const feed = plays.state.kind === 'ready' ? plays.state.data : null;
  const chips = feed?.periods ?? data?.periods ?? [];
  const period = resolvePeriod(chips, periodChoice);

  let items: ListItem[] = [];
  if (data !== null) {
    if (section === 'box') items = [{ kind: 'box', key: 'box' }];
    if (section === 'standings') items = [{ kind: 'standings', key: 'standings' }];
    if (section === 'plays' && feed !== null) {
      items = playsInPeriod(feed.plays, period).map((play) => ({ kind: 'play', key: play.id, play }));
    }
  }

  // iOS insets the list below the clear header, so the backdrop reaches up
  // under the bar. Other platforms pad the content by the header height.
  const ios = Platform.OS === 'ios';

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Game',
          headerTransparent: true,
          headerTitle: game ? () => <GameStatusTitle game={game} /> : undefined,
          headerRight: game
            ? () => (
                <HeaderIconButton
                  icon={{ ios: 'square.and.arrow.up', android: 'share' }}
                  label="Share game"
                  onPress={() => void shareGame(game)}
                />
              )
            : undefined,
        }}
      />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'box':
              return data ? (
                <BoxScore league={gameRef.league} box={data.box} side={boxSide} onSideChange={setBoxSide} />
              ) : null;
            case 'standings':
              return data ? (
                <GameStandings
                  league={gameRef.league}
                  season={data.standings.season}
                  groups={data.standings.groups}
                  selected={standingsIndex}
                  onSelect={setStandingsIndex}
                />
              ) : null;
            case 'play':
              return <PlayRow play={item.play} />;
            default: {
              const exhaustive: never = item;
              return exhaustive;
            }
          }
        }}
        ListHeaderComponent={
          <View style={{ paddingTop: ios ? 0 : headerHeight }}>
            {game ? (
              <TeamBackdrop
                backdrop={{ kind: 'matchup', away: game.away.accent, home: game.home.accent }}
                top={ios ? -headerHeight : 0}
              />
            ) : null}
            {game ? (
              <GameHero game={game}>
                {data && !data.flow.empty ? (
                  <FlowChart flow={data.flow} awayLabel={game.away.abbr} homeLabel={game.home.abbr} />
                ) : null}
                {data ? <Linescore linescore={data.linescore} away={game.away} home={game.home} /> : null}
              </GameHero>
            ) : null}
            {detail.state.kind === 'ready' ? (
              <>
                {detail.state.refreshError ? (
                  <RefreshError error={detail.state.refreshError} onRetry={detail.retry} />
                ) : null}
                <SegmentedControl
                  values={SECTIONS.map((entry) => entry.label)}
                  selectedIndex={SECTIONS.findIndex((entry) => entry.key === section)}
                  onChange={(event) => {
                    const next = SECTIONS[event.nativeEvent.selectedSegmentIndex];
                    if (next) setSection(next.key);
                  }}
                  accessibilityLabel="Game section"
                  style={styles.sections}
                />
                {section === 'box' ? <GameLeaders league={gameRef.league} leaders={detail.state.data.leaders} /> : null}
                {section === 'plays' && plays.state.kind === 'ready' && plays.state.refreshError ? (
                  <RefreshError error={plays.state.refreshError} onRetry={plays.retry} />
                ) : null}
                {section === 'plays' && chips.length > 1 ? (
                  <PeriodChips
                    chips={chips}
                    selected={period}
                    onSelect={(next) =>
                      setPeriodChoice(next === null ? { kind: 'all' } : { kind: 'period', period: next })
                    }
                  />
                ) : null}
              </>
            ) : (
              <QueryFallback state={detail.state} subject="This game" onRetry={detail.retry} />
            )}
          </View>
        }
        ListEmptyComponent={
          section === 'plays' && data !== null ? (
            plays.state.kind === 'ready' ? (
              <Notice title="No plays yet" message="Plays appear here once the game starts." />
            ) : (
              <QueryFallback state={plays.state} subject="Plays" onRetry={plays.retry} />
            )
          ) : undefined
        }
        ListFooterComponent={
          data && data.info.length > 0 ? (
            <View style={styles.footer}>
              <SectionLabel>Game info</SectionLabel>
              <InfoRows lines={data.info} />
            </View>
          ) : (
            <View style={styles.footer} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={detail.refreshing || plays.refreshing}
            onRefresh={() => {
              detail.refresh();
              if (section === 'plays') plays.refresh();
            }}
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
  sections: {
    marginHorizontal: layout.screenPadding,
    marginTop: space.sm,
  },
  footer: {
    paddingBottom: space.xxxl,
  },
});
