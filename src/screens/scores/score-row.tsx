import { StyleSheet, Text, View } from 'react-native';
import type { Game, GameSide } from '@/api/schemas';
import { RowLink } from '@/components/row-link';
import { TeamLogo } from '@/components/team-logo';
import { gameHref } from '@/navigation/hrefs';
import { colors, layout, space, typography } from '@/theme';

function sideLabel(side: GameSide): string {
  return side.rank ? `${side.rank} ${side.name}` : side.name;
}

function accessibilityLabel(game: Game): string {
  const status = [game.status, game.detail].filter((part) => part.length > 0).join(', ');
  if (game.state === 'pre') return `${sideLabel(game.away)} at ${sideLabel(game.home)}, ${status}`;
  const live = game.state === 'in' ? 'Live, ' : '';
  return `${live}${sideLabel(game.away)} ${game.away.score}, ${sideLabel(game.home)} ${game.home.score}, ${status}`;
}

function TeamColumn({ side }: { side: GameSide }) {
  return (
    <View style={styles.team}>
      <TeamLogo uri={side.logo} abbr={side.abbr} size={40} />
      <Text numberOfLines={1} style={[typography.callout, { fontWeight: '700' }]}>
        {side.rank ? <Text style={styles.rank}>{side.rank} </Text> : null}
        {side.abbr}
      </Text>
      <Text numberOfLines={1} style={[typography.footnote, styles.numbers]}>
        {side.record}
      </Text>
    </View>
  );
}

function Score({ side, dimmed }: { side: GameSide; dimmed: boolean }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[typography.score, { color: dimmed ? colors.textTertiary : colors.text }]}
    >
      {side.score}
    </Text>
  );
}

function Status({ game }: { game: Game }) {
  const live = game.state === 'in';
  return (
    <View style={styles.status}>
      {live ? <View style={styles.liveDot} /> : null}
      <Text
        numberOfLines={1}
        style={[typography.subhead, { color: live ? colors.live : colors.text, fontWeight: '600' }]}
      >
        {game.status}
      </Text>
      {game.detail ? (
        <Text numberOfLines={1} style={[typography.subhead, { flexShrink: 1, color: colors.textTertiary }]}>
          · {game.detail}
        </Text>
      ) : null}
    </View>
  );
}

export function ScoreRow({ game }: { game: Game }) {
  const started = game.state !== 'pre' && game.away.score !== '' && game.home.score !== '';
  // The trailing or losing side dims. A tie dims neither side.
  const someoneLeads = game.away.leading || game.home.leading;
  return (
    <RowLink
      href={gameHref({ league: game.league, id: game.id })}
      accessibilityLabel={accessibilityLabel(game)}
      style={styles.row}
    >
      <TeamColumn side={game.away} />
      <View style={styles.center}>
        {started ? (
          <View style={styles.scores}>
            <Score side={game.away} dimmed={someoneLeads && !game.away.leading} />
            <Text style={[typography.score, { color: colors.textMuted }]}>–</Text>
            <Score side={game.home} dimmed={someoneLeads && !game.home.leading} />
          </View>
        ) : null}
        <Status game={game} />
      </View>
      <TeamColumn side={game.home} />
    </RowLink>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.lg,
  },
  team: {
    width: 72,
    alignItems: 'center',
    gap: space.xxs,
  },
  rank: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  numbers: {
    fontVariant: ['tabular-nums'],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
  },
  scores: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    maxWidth: '100%',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
