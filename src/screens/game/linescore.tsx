import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { GameSide, Linescore as LinescoreData } from '@/api/schemas';
import { colors, layout, space, typography } from '@/theme';

type LinescoreProps = {
  linescore: LinescoreData;
  away: GameSide;
  home: GameSide;
};

const TEAM_WIDTH = 64;
const MAX_CELL_WIDTH = 40;

type RowProps = {
  side: GameSide;
  scores: readonly string[];
  labels: readonly string[];
  cellWidth: number;
};

function Row({ side, scores, labels, cellWidth }: RowProps) {
  const values = labels.map((label, index) => `${label} ${scores[index] ?? 'not played'}`);
  return (
    <View
      accessible
      accessibilityLabel={`${side.name}: ${values.join(', ')}, total ${side.score || 'none'}`}
      style={styles.row}
    >
      <Text numberOfLines={1} style={[typography.callout, styles.team, { fontWeight: '700' }]}>
        {side.abbr}
      </Text>
      {labels.map((label, index) => (
        <Text
          key={label}
          maxFontSizeMultiplier={1.4}
          style={[typography.callout, styles.cell, { width: cellWidth, color: colors.textSecondary }]}
        >
          {scores[index] ?? '–'}
        </Text>
      ))}
      <Text
        maxFontSizeMultiplier={1.4}
        style={[
          typography.callout,
          styles.cell,
          {
            width: cellWidth,
            color: side.leading ? colors.text : colors.textSecondary,
            fontWeight: '700',
          },
        ]}
      >
        {side.score || '–'}
      </Text>
    </View>
  );
}

export function Linescore({ linescore, away, home }: LinescoreProps) {
  const { width } = useWindowDimensions();
  if (linescore.labels.length === 0) return null;
  const columns = linescore.labels.length + 1;
  const cellWidth = Math.min(
    MAX_CELL_WIDTH,
    Math.floor((width - layout.screenPadding * 2 - TEAM_WIDTH) / columns),
  );
  return (
    <View style={styles.table}>
      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.team} />
        {linescore.labels.map((label) => (
          <Text
            key={label}
            maxFontSizeMultiplier={1.4}
            style={[typography.caption, styles.cell, { width: cellWidth }]}
          >
            {label}
          </Text>
        ))}
        <Text maxFontSizeMultiplier={1.4} style={[typography.caption, styles.cell, { width: cellWidth }]}>
          T
        </Text>
      </View>
      <Row side={away} scores={linescore.away} labels={linescore.labels} cellWidth={cellWidth} />
      <Row side={home} scores={linescore.home} labels={linescore.labels} cellWidth={cellWidth} />
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.lg,
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  team: {
    flex: 1,
    minWidth: TEAM_WIDTH,
  },
  cell: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
