import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSearch } from '@/api/queries';
import type { SearchHit } from '@/api/schemas';
import { Chevron } from '@/components/chevron';
import { Screen } from '@/components/screen';
import { Headshot } from '@/components/headshot';
import { leagueHeaderOptions } from '@/components/league-picker';
import { Notice } from '@/components/notice';
import { QueryFallback } from '@/components/query-fallback';
import { RefreshError } from '@/components/refresh-error';
import { RowLink } from '@/components/row-link';
import { TeamLogo } from '@/components/team-logo';
import { LEAGUES, type League } from '@/domain/league';
import { MIN_SEARCH_LENGTH, toSearchQuery } from '@/domain/search';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { playerHref, teamHref } from '@/navigation/hrefs';
import { setPreferredLeague, usePreferredLeague } from '@/state/preferences';
import { colors, layout, radius, space, typography } from '@/theme';

const DEBOUNCE_MS = 300;

function HitRow({ league, hit }: { league: League; hit: SearchHit }) {
  const href = hit.type === 'team' ? teamHref({ league, id: hit.id }) : playerHref({ league, id: hit.id });
  return (
    <RowLink
      href={href}
      accessibilityLabel={[hit.name, hit.type === 'team' ? 'team' : hit.subtitle].filter(Boolean).join(', ')}
      style={styles.row}
    >
      {hit.type === 'team' ? (
        <TeamLogo uri={hit.image} abbr={hit.name.slice(0, 3).toUpperCase()} size={40} />
      ) : (
        <Headshot uri={hit.image} name={hit.name} size={40} />
      )}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[typography.body, { fontWeight: '600' }]}>
          {hit.name}
        </Text>
        {hit.subtitle ? (
          <Text numberOfLines={1} style={typography.footnote}>
            {hit.subtitle}
          </Text>
        ) : null}
      </View>
      <Chevron />
    </RowLink>
  );
}

export function SearchScreen() {
  const league = usePreferredLeague();
  const [text, setText] = useState('');
  const settled = useDebouncedValue(text, DEBOUNCE_MS);
  // Typing changes the text at once, but a request starts only after a pause.
  // A new query replaces the old one, whose request is cancelled.
  const typed = toSearchQuery(text);
  const query = typed === null ? null : toSearchQuery(settled);
  const search = useSearch({ league, query });
  const { state } = search;
  const leagueName = LEAGUES[league].label;

  let empty = null;
  if (typed === null) {
    empty = (
      <Notice
        title={`Search ${leagueName}`}
        message={`Type at least ${MIN_SEARCH_LENGTH} letters to find teams and players.`}
      />
    );
  } else if (query === null || query !== typed) {
    empty = <QueryFallback state={{ kind: 'loading' }} subject="Results" onRetry={search.retry} />;
  } else if (state.kind === 'ready') {
    empty = (
      <Notice title={`Nothing matches “${query}”`} message={`Check the spelling, or search another league.`} />
    );
  } else {
    empty = <QueryFallback state={state} subject="Results" onRetry={search.retry} />;
  }

  const results = typed !== null && query === typed && state.kind === 'ready' ? state.data.results : [];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Search',
          headerLargeTitleEnabled: true,
          ...leagueHeaderOptions({ value: league, onChange: setPreferredLeague }),
          headerSearchBarOptions: {
            placeholder: `Teams and players`,
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (event) => setText(event.nativeEvent.text),
            onCancelButtonPress: () => setText(''),
          },
        }}
      />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={results}
        keyExtractor={(hit) => `${hit.type}-${hit.id}`}
        renderItem={({ item }) => <HitRow league={league} hit={item} />}
        ListHeaderComponent={
          <>
            {Platform.OS === 'web' ? (
              <TextInput
                accessibilityLabel="Search teams and players"
                placeholder="Teams and players"
                placeholderTextColor={colors.textTertiary}
                value={text}
                onChangeText={setText}
                autoCapitalize="none"
                style={styles.searchInput}
              />
            ) : null}
            {results.length > 0 && state.kind === 'ready' && state.refreshError ? (
              <RefreshError error={state.refreshError} onRetry={search.retry} />
            ) : null}
          </>
        }
        ListEmptyComponent={empty}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchInput: {
    ...typography.body,
    marginHorizontal: layout.screenPadding,
    marginVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: layout.minTouch,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.md,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  text: {
    flex: 1,
    gap: space.xxs,
  },
});
