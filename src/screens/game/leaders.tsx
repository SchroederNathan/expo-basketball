import { StyleSheet, Text, View } from 'react-native';
import type { GameLeader } from '@/api/schemas';
import { Headshot } from '@/components/headshot';
import { RowLink } from '@/components/row-link';
import type { League } from '@/domain/league';
import { playerHref } from '@/navigation/hrefs';
import { colors, layout, radius, space, typography } from '@/theme';

export function GameLeaders({ league, leaders }: { league: League; leaders: readonly GameLeader[] }) {
  if (leaders.length === 0) return null;
  return (
    <View style={styles.row}>
      {leaders.map((leader) => (
        <RowLink key={leader.id} href={playerHref({ league, id: leader.id })}
            accessibilityLabel={`${leader.name}, ${leader.line}`}
            style={[
              styles.tile,
              { borderLeftColor: leader.accent },
            ]}
          >
            <Headshot uri={leader.headshot} name={leader.name} size={40} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[typography.subhead, { color: colors.text, fontWeight: '600' }]}>
                {leader.name}
              </Text>
              <Text numberOfLines={1} style={[typography.footnote, { fontVariant: ['tabular-nums'] }]}>
                {leader.line}
              </Text>
            </View>
        </RowLink>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.lg,
  },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    padding: space.sm,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderLeftWidth: 3,
    backgroundColor: colors.fill,
  },
  text: {
    flex: 1,
    gap: space.xxs,
  },
});
