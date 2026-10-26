import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { StandingRow } from '@/api/schemas';
import type { League } from '@/domain/league';
import { teamHref } from '@/navigation/hrefs';
import { colors, layout, space, typography } from '@/theme';
import { RowLink } from './row-link';
import { SectionLabel } from './section-label';
import { TeamLogo } from './team-logo';

export type StandingsSection = {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly StandingRow[];
};

type Column = {
  readonly label: string;
  readonly accessibilityName: string;
  readonly width: number;
  readonly value: (row: StandingRow) => string;
  readonly strong?: boolean;
};

const RECORD: Column = { label: 'W–L', accessibilityName: 'record', width: 52, value: (row) => row.record, strong: true };
const PCT: Column = { label: 'PCT', accessibilityName: 'win percentage', width: 48, value: (row) => row.pct };
const GB: Column = { label: 'GB', accessibilityName: 'games back', width: 40, value: (row) => row.gb };
const LAST_TEN: Column = { label: 'L10', accessibilityName: 'last ten', width: 44, value: (row) => row.lastTen };
const STREAK: Column = { label: 'STRK', accessibilityName: 'streak', width: 44, value: (row) => row.streak };

// Numeric cells stop growing at this text scale. Team names keep growing and wrap.
const MAX_CELL_SCALE = 1.6;

function columnsFor(fontScale: number): readonly Column[] {
  return fontScale > 1.2 ? [RECORD, GB, STREAK] : [RECORD, PCT, GB, LAST_TEN, STREAK];
}

function rowLabel(row: StandingRow, columns: readonly Column[]): string {
  const values = columns
    .map((column) => (column.value(row) ? `${column.accessibilityName} ${column.value(row)}` : ''))
    .filter((part) => part.length > 0);
  return [`${row.rank}. ${row.name}`, row.live ? 'playing now' : '', ...values]
    .filter((part) => part.length > 0)
    .join(', ');
}

export function StandingsTable({ league, sections }: { league: League; sections: readonly StandingsSection[] }) {
  const { fontScale } = useWindowDimensions();
  const columns = columnsFor(fontScale);
  const cellScale = Math.min(fontScale, MAX_CELL_SCALE);
  return (
    <View>
      {sections.map((section) => (
        <View key={section.key}>
          <SectionLabel>{section.title}</SectionLabel>
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[styles.row, styles.headerRow]}
          >
            <Text style={[typography.caption, { flex: 1 }]}>TEAM</Text>
            {columns.map((column) => (
              <Text
                key={column.label}
                maxFontSizeMultiplier={MAX_CELL_SCALE}
                style={[typography.caption, styles.cell, { width: column.width * cellScale }]}
              >
                {column.label}
              </Text>
            ))}
          </View>
          {section.rows.map((row) => (
            <RowLink
              key={row.teamId}
              href={teamHref({ league, id: row.teamId })}
              accessibilityLabel={rowLabel(row, columns)}
              style={[styles.row, row.highlight ? { backgroundColor: colors.fill } : null]}
            >
              <Text maxFontSizeMultiplier={MAX_CELL_SCALE} style={[typography.footnote, styles.rank]}>
                {row.rank}
              </Text>
              <TeamLogo uri={row.logo} abbr={row.abbr} size={22} />
              <View style={styles.team}>
                <Text
                  numberOfLines={2}
                  style={[
                    typography.subhead,
                    { color: colors.text, fontWeight: row.highlight ? '700' : '500', flexShrink: 1 },
                  ]}
                >
                  {row.name}
                </Text>
                {row.live ? <View style={styles.liveDot} /> : null}
              </View>
              {columns.map((column) => (
                <Text
                  key={column.label}
                  maxFontSizeMultiplier={MAX_CELL_SCALE}
                  style={[
                    typography.subhead,
                    styles.cell,
                    {
                      width: column.width * cellScale,
                      color: column.strong ? colors.text : colors.textSecondary,
                      fontWeight: column.strong ? '600' : '400',
                    },
                  ]}
                >
                  {column.value(row) || '—'}
                </Text>
              ))}
            </RowLink>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerRow: {
    minHeight: 0,
    paddingVertical: space.xs,
  },
  rank: {
    width: 20,
    textAlign: 'right',
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  team: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  cell: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
});
