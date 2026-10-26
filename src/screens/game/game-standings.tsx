import SegmentedControl from '@expo/ui/community/segmented-control';
import { View } from 'react-native';
import type { StandingGroup } from '@/api/schemas';
import { Notice } from '@/components/notice';
import { StandingsTable } from '@/components/standings-table';
import type { League } from '@/domain/league';
import { groupLabel } from '@/domain/standings';
import { layout, space } from '@/theme';

type GameStandingsProps = {
  league: League;
  season: string;
  groups: readonly StandingGroup[];
  selected: number;
  onSelect: (index: number) => void;
};

const MAX_SEGMENTS = 4;

export function GameStandings({ league, season, groups, selected, onSelect }: GameStandingsProps) {
  const index = Math.min(selected, groups.length - 1);
  const group = groups[index];
  if (group === undefined) {
    return <Notice title="Standings aren’t available for this game." />;
  }
  const segmented = groups.length > 1 && groups.length <= MAX_SEGMENTS;
  const shown = segmented || groups.length === 1 ? [group] : groups;
  return (
    <View>
      {segmented ? (
        <SegmentedControl
          values={groups.map(groupLabel)}
          selectedIndex={index}
          onChange={(event) => onSelect(event.nativeEvent.selectedSegmentIndex)}
          accessibilityLabel="Standings group"
          style={{ marginHorizontal: layout.screenPadding, marginTop: space.lg }}
        />
      ) : null}
      <StandingsTable
        league={league}
        sections={shown.map((entry) => ({
          key: entry.id,
          title: [groupLabel(entry), season].filter(Boolean).join(' · '),
          rows: entry.rows,
        }))}
      />
    </View>
  );
}
