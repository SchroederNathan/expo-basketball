import { Stack } from 'expo-router';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useTeams } from '@/api/queries';
import type { TeamSummary, TeamsIndex } from '@/api/schemas';
import { Chevron } from '@/components/chevron';
import { leagueHeaderOptions } from '@/components/league-picker';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { RowLink } from '@/components/row-link';
import { SectionLabel } from '@/components/section-label';
import { TeamLogo } from '@/components/team-logo';
import type { League } from '@/domain/league';
import { teamHref } from '@/navigation/hrefs';
import { setPreferredLeague, usePreferredLeague } from '@/state/preferences';
import { colors, layout, space, typography } from '@/theme';

type TeamSection = { readonly key: string; readonly title: string | null; readonly data: readonly TeamSummary[] };

// Pro leagues group teams by division. College leagues send no groups, so
// their 350-plus teams form one alphabetical, virtualized list.
function teamSections(index: TeamsIndex): TeamSection[] {
  if (index.groups.length === 0) return [{ key: 'all', title: null, data: index.teams }];
  return index.groups.map((group) => ({
    key: group.id,
    title: [group.conference, group.name].filter(Boolean).join(' · '),
    data: group.teams,
  }));
}

function TeamRow({ league, team }: { league: League; team: TeamSummary }) {
  return (
    <RowLink href={teamHref({ league, id: team.id })} accessibilityLabel={team.fullName || team.name} style={styles.row}>
      <TeamLogo uri={team.logo} abbr={team.abbr} size={32} />
      <Text numberOfLines={1} style={[typography.body, styles.name]}>
        {team.fullName || team.name}
      </Text>
      <Chevron />
    </RowLink>
  );
}

export function TeamsScreen() {
  const league = usePreferredLeague();
  const teams = useTeams({ league });
  const { state } = teams;
  const sections = state.kind === 'ready' && state.data.teams.length > 0 ? teamSections(state.data) : [];
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Teams',
          headerLargeTitleEnabled: true,
          ...leagueHeaderOptions({ value: league, onChange: setPreferredLeague }),
        }}
      />
      <SectionList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(team) => team.id}
        renderItem={({ item }) => <TeamRow league={league} team={item} />}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHeader}>
              <SectionLabel>{section.title}</SectionLabel>
            </View>
          ) : null
        }
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          state.kind === 'ready' && state.refreshError ? (
            <RefreshError error={state.refreshError} onRetry={teams.retry} />
          ) : undefined
        }
        ListEmptyComponent={
          state.kind === 'ready' ? (
            <Notice title="No teams yet" message="This league has no teams listed right now." />
          ) : (
            <QueryFallback state={state} subject="Teams" onRetry={teams.retry} />
          )
        }
        refreshControl={
          <RefreshControl refreshing={teams.refreshing} onRefresh={teams.refresh} tintColor={colors.textTertiary} />
        }
      />
    </>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sectionHeader: {
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
  },
  name: {
    flex: 1,
    fontWeight: '500',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: layout.screenPadding + 32 + space.md,
    backgroundColor: colors.hairline,
  },
});
