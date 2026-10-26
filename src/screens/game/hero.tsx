import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Game, GameSide } from '@/api/schemas';
import { DisplayText } from '@/components/display-text';
import { RowLink } from '@/components/row-link';
import { TeamLogo } from '@/components/team-logo';
import { teamHref } from '@/navigation/hrefs';
import { colors, space, typography } from '@/theme';

function TeamColumn({ side, league }: { side: GameSide; league: Game['league'] }) {
  const content = (
    <>
      <TeamLogo uri={side.logo} abbr={side.abbr} size={56} />
      <Text numberOfLines={1} style={[typography.headline, { fontWeight: '700' }]}>
        {side.rank ? <Text style={styles.rank}>{side.rank} </Text> : null}
        {side.abbr}
      </Text>
      <Text numberOfLines={1} style={[typography.footnote, styles.numbers]}>
        {side.record}
      </Text>
    </>
  );
  if (side.id === null) {
    return <View style={styles.team}>{content}</View>;
  }
  return (
    <RowLink href={teamHref({ league, id: side.id })}
        accessibilityLabel={`${side.fullName || side.name}${side.record ? `, ${side.record}` : ''}`}
        style={styles.team}
      >
        {content}
    </RowLink>
  );
}

function Center({ game }: { game: Game }) {
  const started = game.state !== 'pre' && game.away.score !== '' && game.home.score !== '';
  if (!started) {
    return (
      <View style={styles.center} accessible accessibilityLabel={[game.status, game.detail].join(', ')}>
        <DisplayText size="medium" numberOfLines={1} adjustsFontSizeToFit>
          {game.status}
        </DisplayText>
        {game.detail ? (
          <Text numberOfLines={2} style={[typography.footnote, { textAlign: 'center' }]}>
            {game.detail}
          </Text>
        ) : null}
      </View>
    );
  }
  const someoneLeads = game.away.leading || game.home.leading;
  return (
    <View
      style={[styles.center, styles.scores]}
      accessible
      accessibilityLabel={`${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}`}
    >
      <DisplayText
        size="hero"
        numberOfLines={1}
        adjustsFontSizeToFit
        tone={someoneLeads && !game.away.leading ? 'muted' : 'primary'}
      >
        {game.away.score}
      </DisplayText>
      <Text style={[typography.title, { color: colors.textMuted }]}>–</Text>
      <DisplayText
        size="hero"
        numberOfLines={1}
        adjustsFontSizeToFit
        tone={someoneLeads && !game.home.leading ? 'muted' : 'primary'}
      >
        {game.home.score}
      </DisplayText>
    </View>
  );
}

export function GameStatusTitle({ game }: { game: Game }) {
  const live = game.state === 'in';
  return (
    <View style={styles.title} accessible accessibilityRole="header">
      {live ? <View style={styles.liveDot} /> : null}
      <Text numberOfLines={1} style={[typography.callout, { fontWeight: '700', color: live ? colors.live : colors.text }]}>
        {game.status}
      </Text>
      {game.detail && game.state !== 'pre' ? (
        <Text numberOfLines={1} style={[typography.callout, { flexShrink: 1, color: colors.textTertiary }]}>
          {game.detail}
        </Text>
      ) : null}
    </View>
  );
}

type GameHeroProps = {
  game: Game;
  children?: ReactNode;
};

export function GameHero({ game, children }: GameHeroProps) {
  return (
    <View style={styles.hero}>
      <View style={styles.matchup}>
        <TeamColumn side={game.away} league={game.league} />
        <Center game={game} />
        <TeamColumn side={game.home} league={game.league} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  matchup: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.xs,
  },
  team: {
    width: 76,
    minHeight: 44,
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
    justifyContent: 'center',
    gap: space.xs,
  },
  scores: {
    flexDirection: 'row',
    gap: space.sm,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    maxWidth: 240,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
