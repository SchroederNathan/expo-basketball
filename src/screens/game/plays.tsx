import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PeriodChip, Play } from '@/api/schemas';
import { TeamLogo } from '@/components/team-logo';
import { colors, layout, radius, space, typography } from '@/theme';

type PeriodChipsProps = {
  chips: readonly PeriodChip[];
  selected: number | null;
  onSelect: (period: number | null) => void;
};

// Period counts vary (overtimes add chips), so the filter is a chip row
// rather than a fixed segmented control.
export function PeriodChips({ chips, selected, onSelect }: PeriodChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      accessibilityRole="tablist"
    >
      {chips.map((chip) => {
        const active = chip.period === selected;
        return (
          <Pressable
            key={chip.period ?? 'all'}
            onPress={() => onSelect(chip.period)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={chip.period === null ? 'All periods' : chip.label}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [
              styles.chip,
              active ? styles.chipActive : null,
              pressed && !active ? { backgroundColor: colors.fillPressed } : null,
            ]}
          >
            <Text style={[typography.subhead, { fontWeight: '600', color: active ? colors.onAccent : colors.text }]}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function PlayRow({ play }: { play: Play }) {
  if (play.kind === 'divider') {
    return (
      <View style={styles.divider} accessible accessibilityRole="header" accessibilityLabel={play.text}>
        <View style={styles.rule} />
        <Text style={[typography.label, { flexShrink: 1, textAlign: 'center' }]}>{play.text}</Text>
        <View style={styles.rule} />
      </View>
    );
  }
  const spoken = [
    play.clock,
    play.text,
    play.assist,
    play.scoring ? `score ${play.awayScore} to ${play.homeScore}` : '',
  ].filter(Boolean);
  return (
    <View style={styles.play} accessible accessibilityLabel={spoken.join(', ')}>
      <Text style={[typography.footnote, styles.clock]}>{play.clock}</Text>
      <View style={styles.logo}>
        {play.logo ? <TeamLogo uri={play.logo} abbr="" size={20} /> : null}
      </View>
      <View style={styles.body}>
        <Text style={[typography.subhead, { color: play.scoring ? colors.text : colors.textSecondary, fontWeight: play.scoring ? '600' : '400' }]}>
          {play.text}
          {play.badge ? <Text style={styles.badge}> {play.badge}</Text> : null}
        </Text>
        {play.assist ? <Text style={typography.footnote}>{play.assist}</Text> : null}
      </View>
      <Text style={[typography.subhead, styles.score]}>
        <Text style={{ color: play.scoredBy === 'away' ? colors.text : colors.textTertiary, fontWeight: play.scoredBy === 'away' ? '700' : '400' }}>
          {play.awayScore}
        </Text>
        <Text style={{ color: colors.textTertiary }}>–</Text>
        <Text style={{ color: play.scoredBy === 'home' ? colors.text : colors.textTertiary, fontWeight: play.scoredBy === 'home' ? '700' : '400' }}>
          {play.homeScore}
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.md,
  },
  chip: {
    minWidth: 48,
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fill,
  },
  chipActive: {
    backgroundColor: colors.text,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  play: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  clock: {
    width: 44,
    paddingTop: 1,
    fontVariant: ['tabular-nums'],
  },
  logo: {
    width: 20,
    height: 20,
  },
  body: {
    flex: 1,
    gap: space.xxs,
  },
  badge: {
    color: colors.accent,
    fontWeight: '700',
  },
  score: {
    fontVariant: ['tabular-nums'],
  },
});
