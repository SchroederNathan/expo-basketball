import SegmentedControl from '@expo/ui/community/segmented-control';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { BoxPlayer, BoxStats, BoxTeam } from '@/api/schemas';
import { InfoRows } from '@/components/info-rows';
import { Notice } from '@/components/notice';
import { RowLink } from '@/components/row-link';
import { SectionLabel } from '@/components/section-label';
import type { League } from '@/domain/league';
import { playerHref } from '@/navigation/hrefs';
import { colors, layout, space, typography } from '@/theme';

type Column = {
  readonly key: keyof BoxStats;
  readonly label: string;
  readonly spoken: string;
  readonly width: number;
  readonly strong?: boolean;
};

const COLUMNS: readonly Column[] = [
  { key: 'min', label: 'MIN', spoken: 'minutes', width: 40 },
  { key: 'pts', label: 'PTS', spoken: 'points', width: 40, strong: true },
  { key: 'reb', label: 'REB', spoken: 'rebounds', width: 40 },
  { key: 'ast', label: 'AST', spoken: 'assists', width: 40 },
  { key: 'fg', label: 'FG', spoken: 'field goals', width: 58 },
  { key: 'tp', label: '3PT', spoken: 'threes', width: 52 },
  { key: 'ft', label: 'FT', spoken: 'free throws', width: 52 },
  { key: 'stl', label: 'STL', spoken: 'steals', width: 40 },
  { key: 'blk', label: 'BLK', spoken: 'blocks', width: 40 },
  { key: 'to', label: 'TO', spoken: 'turnovers', width: 36 },
  { key: 'oreb', label: 'OREB', spoken: 'offensive rebounds', width: 48 },
  { key: 'dreb', label: 'DREB', spoken: 'defensive rebounds', width: 48 },
  { key: 'pf', label: 'PF', spoken: 'fouls', width: 36 },
  { key: 'pm', label: '+/-', spoken: 'plus minus', width: 44 },
];

// Table text stops growing here, so the fixed name column and the scrolling
// stat columns keep the same row heights.
const MAX_TABLE_SCALE = 1.6;

type TableRow =
  | { readonly kind: 'heading'; readonly key: string; readonly label: string }
  | { readonly kind: 'player'; readonly key: string; readonly player: BoxPlayer }
  | { readonly kind: 'totals'; readonly key: string; readonly totals: BoxStats };

function tableRows(team: BoxTeam): TableRow[] {
  return [
    { kind: 'heading', key: 'starters', label: 'Starters' },
    ...team.starters.map((player): TableRow => ({ kind: 'player', key: `s-${player.id}`, player })),
    ...(team.bench.length > 0
      ? [
          { kind: 'heading', key: 'bench', label: 'Bench' } satisfies TableRow,
          ...team.bench.map((player): TableRow => ({ kind: 'player', key: `b-${player.id}`, player })),
        ]
      : []),
    { kind: 'totals', key: 'totals', totals: team.totals },
  ];
}

function spokenStats(stats: BoxStats): string {
  return COLUMNS.filter((column) => stats[column.key] !== '')
    .map((column) => `${stats[column.key]} ${column.spoken}`)
    .join(', ');
}

function playerLabel(player: BoxPlayer): string {
  const role = [player.position, player.onCourt ? 'on the court' : ''].filter(Boolean).join(', ');
  const line = player.didNotPlay ? `did not play${player.note ? `, ${player.note}` : ''}` : spokenStats(player);
  return [player.fullName || player.name, role, line].filter(Boolean).join(', ');
}

type BoxScoreProps = {
  league: League;
  box: readonly BoxTeam[];
  side: number;
  onSideChange: (side: number) => void;
};

export function BoxScore({ league, box, side, onSideChange }: BoxScoreProps) {
  const { fontScale } = useWindowDimensions();
  const team = box[side] ?? box[0];
  if (team === undefined || team.starters.length + team.bench.length === 0) {
    return <Notice title="The box score fills in at tip-off." />;
  }
  const scale = Math.max(1, Math.min(fontScale, MAX_TABLE_SCALE));
  const rowHeight = Math.round(44 * scale);
  const nameWidth = Math.round(140 * Math.min(scale, 1.25));
  const statsWidth = COLUMNS.reduce((total, column) => total + Math.round(column.width * scale), 0);
  const rows = tableRows(team);
  return (
    <View>
      {box.length > 1 ? (
        <SegmentedControl
          values={box.map((entry) => entry.name || entry.abbr)}
          selectedIndex={side}
          onChange={(event) => onSideChange(event.nativeEvent.selectedSegmentIndex)}
          accessibilityLabel="Team"
          style={styles.toggle}
        />
      ) : null}
      <View style={styles.table}>
        <View style={{ width: nameWidth }}>
          {rows.map((row) => {
            switch (row.kind) {
              case 'heading':
                return (
                  <View key={row.key} style={[styles.cell, styles.nameCell, { height: rowHeight }]}>
                    <Text maxFontSizeMultiplier={MAX_TABLE_SCALE} accessibilityRole="header" style={typography.label}>
                      {row.label}
                    </Text>
                  </View>
                );
              case 'player':
                return (
                  <RowLink key={row.key} href={playerHref({ league, id: row.player.id })}
                      accessibilityLabel={playerLabel(row.player)}
                      style={[
                        styles.cell,
                        styles.nameCell,
                        styles.divider,
                        { height: rowHeight },
                      ]}
                    >
                      {row.player.onCourt ? <View style={styles.onCourt} /> : null}
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={MAX_TABLE_SCALE}
                        style={[
                          typography.subhead,
                          styles.name,
                          { color: row.player.didNotPlay ? colors.textTertiary : colors.text },
                        ]}
                      >
                        {row.player.name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_TABLE_SCALE} style={typography.caption}>
                        {row.player.position}
                      </Text>
                  </RowLink>
                );
              case 'totals':
                return (
                  <View
                    key={row.key}
                    accessible
                    accessibilityLabel={`Team totals, ${spokenStats(row.totals)}`}
                    style={[styles.cell, styles.nameCell, styles.divider, { height: rowHeight }]}
                  >
                    <Text maxFontSizeMultiplier={MAX_TABLE_SCALE} style={[typography.subhead, styles.name]}>
                      Team
                    </Text>
                  </View>
                );
              default: {
                const exhaustive: never = row;
                return exhaustive;
              }
            }
          })}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          contentContainerStyle={{ paddingRight: layout.screenPadding }}
        >
          <View style={{ width: statsWidth }}>
            {rows.map((row) => {
              if (row.kind === 'heading') {
                return (
                  <View key={row.key} style={[styles.statsRow, { height: rowHeight }]}>
                    {COLUMNS.map((column) => (
                      <Text
                        key={column.key}
                        maxFontSizeMultiplier={MAX_TABLE_SCALE}
                        style={[typography.caption, styles.stat, { width: Math.round(column.width * scale) }]}
                      >
                        {column.label}
                      </Text>
                    ))}
                  </View>
                );
              }
              const stats = row.kind === 'player' ? row.player : row.totals;
              if (row.kind === 'player' && row.player.didNotPlay) {
                return (
                  <View key={row.key} style={[styles.statsRow, styles.divider, { height: rowHeight }]}>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_TABLE_SCALE}
                      style={[typography.footnote, { paddingLeft: space.sm }]}
                    >
                      {row.player.note ? `DNP · ${row.player.note}` : 'DNP'}
                    </Text>
                  </View>
                );
              }
              return (
                <View key={row.key} style={[styles.statsRow, styles.divider, { height: rowHeight }]}>
                  {COLUMNS.map((column) => (
                    <Text
                      key={column.key}
                      maxFontSizeMultiplier={MAX_TABLE_SCALE}
                      style={[
                        typography.subhead,
                        styles.stat,
                        {
                          width: Math.round(column.width * scale),
                          color: column.strong || row.kind === 'totals' ? colors.text : colors.textSecondary,
                          fontWeight: column.strong ? '700' : '400',
                        },
                      ]}
                    >
                      {stats[column.key]}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
      {team.stats.length > 0 ? (
        <>
          <SectionLabel>{`${team.name || team.abbr} team stats`}</SectionLabel>
          <InfoRows lines={team.stats} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    marginHorizontal: layout.screenPadding,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  table: {
    flexDirection: 'row',
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameCell: {
    gap: space.xs,
    paddingLeft: layout.screenPadding,
    paddingRight: space.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  name: {
    flexShrink: 1,
    fontWeight: '600',
    color: colors.text,
  },
  onCourt: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
