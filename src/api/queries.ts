import {
  hashKey,
  onlineManager,
  queryOptions,
  skipToken,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import type { IanaZone, Ymd } from '@/domain/dates';
import type { GameRef, PlayerRef, TeamRef } from '@/domain/ids';
import type { LeaderStat } from '@/domain/leaders';
import type { League } from '@/domain/league';
import { isSettledDay, pollIntervalMs } from '@/domain/polling';
import type { SearchQuery } from '@/domain/search';
import {
  fetchGame,
  fetchLeaders,
  fetchPlayer,
  fetchPlays,
  fetchScoreboard,
  fetchSearch,
  fetchStandings,
  fetchTeam,
  fetchTeams,
} from './endpoints';
import { loadable, type Loadable } from './loadable';
import type { Game, GameState, Scoreboard } from './schemas';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const queryKeys = {
  scoreboard: (league: League, date: Ymd, zone: IanaZone) => ['scoreboard', league, date, zone] as const,
  game: (ref: GameRef, zone: IanaZone) => ['game', ref.league, ref.id, zone] as const,
  plays: (ref: GameRef) => ['plays', ref.league, ref.id] as const,
  standings: (league: League, zone: IanaZone) => ['standings', league, zone] as const,
  teams: (league: League) => ['teams', league] as const,
  team: (ref: TeamRef, zone: IanaZone) => ['team', ref.league, ref.id, zone] as const,
  leaders: (league: League, stat: LeaderStat) => ['leaders', league, stat] as const,
  player: (ref: PlayerRef, zone: IanaZone) => ['player', ref.league, ref.id, zone] as const,
  search: (league: League, query: SearchQuery | null) => ['search', league, query] as const,
};

// Each scoreboard game is also stored under its own key, so a game screen can
// draw its header at once while the detail request runs.
function seedOptions(ref: GameRef) {
  return queryOptions<Game>({ queryKey: ['game-seed', ref.league, ref.id], staleTime: Infinity });
}

const freshKeys = new Set<string>();

function takeFresh(key: QueryKey): boolean {
  return freshKeys.delete(hashKey(key));
}

function subscribeOnline(listener: () => void) {
  return onlineManager.subscribe(listener);
}

function isOnline() {
  return onlineManager.isOnline();
}

export type Refreshable<T> = {
  readonly state: Loadable<T>;
  readonly refreshing: boolean;
  readonly refresh: () => void;
  readonly retry: () => void;
};

function useRefreshable<T>(queryKey: QueryKey, query: UseQueryResult<T, Error>): Refreshable<T> {
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const [refreshing, setRefreshing] = useState(false);
  return {
    state: loadable(query, online),
    refreshing: refreshing && online,
    refresh: () => {
      if (!onlineManager.isOnline()) return;
      freshKeys.add(hashKey(queryKey));
      setRefreshing(true);
      void query.refetch().finally(() => setRefreshing(false));
    },
    retry: () => {
      if (!onlineManager.isOnline()) return;
      void query.refetch();
    },
  };
}

function staleTimeFor(state: GameState | undefined): number {
  switch (state) {
    case 'in':
      return 5 * SECOND;
    case 'pre':
      return MINUTE;
    case 'post':
      return 5 * MINUTE;
    default:
      return 0;
  }
}

export function useScoreboard({
  league,
  date,
  zone,
  visible,
}: {
  readonly league: League;
  readonly date: Ymd;
  readonly zone: IanaZone;
  readonly visible: boolean;
}): Refreshable<Scoreboard> {
  const focused = useIsFocused();
  const client = useQueryClient();
  const queryKey = queryKeys.scoreboard(league, date, zone);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const board = await fetchScoreboard({ league, date, zone }, { signal, fresh: takeFresh(queryKey) });
      for (const game of board.games) {
        client.setQueryData(seedOptions({ league, id: game.id }).queryKey, game);
      }
      return board;
    },
    staleTime: (current) => (current.state.data?.hasLive ? 5 * SECOND : MINUTE),
    refetchInterval: (current) => {
      const board = current.state.data;
      if (!board) return false;
      return pollIntervalMs({
        pollSeconds: board.pollSeconds,
        settled: isSettledDay(board.games),
        focused: focused && visible,
      });
    },
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function useSeedGame(ref: GameRef): Game | null {
  const client = useQueryClient();
  const [seed] = useState(() => client.getQueryData(seedOptions(ref).queryKey) ?? null);
  return seed;
}

export function useGame({ ref, zone }: { readonly ref: GameRef; readonly zone: IanaZone }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.game(ref, zone);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchGame({ ref, zone }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: (current) => staleTimeFor(current.state.data?.game.state),
    refetchInterval: (current) => {
      const detail = current.state.data;
      if (!detail) return false;
      return pollIntervalMs({
        pollSeconds: detail.pollSeconds,
        settled: detail.game.state === 'post',
        focused,
      });
    },
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function usePlays({
  ref,
  enabled,
  pollSeconds,
  live,
}: {
  readonly ref: GameRef;
  readonly enabled: boolean;
  readonly pollSeconds: number;
  readonly live: boolean;
}) {
  const focused = useIsFocused();
  const queryKey = queryKeys.plays(ref);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchPlays({ ref }, { signal, fresh: takeFresh(queryKey) }),
    enabled,
    staleTime: live ? 5 * SECOND : 5 * MINUTE,
    refetchInterval: pollIntervalMs({ pollSeconds, settled: !live, focused: focused && enabled }),
    subscribed: focused && enabled,
  });
  return useRefreshable(queryKey, query);
}

export function useStandings({ league, zone }: { readonly league: League; readonly zone: IanaZone }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.standings(league, zone);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchStandings({ league, zone }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function useTeams({ league }: { readonly league: League }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.teams(league);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTeams({ league }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: 60 * MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function useTeam({ ref, zone }: { readonly ref: TeamRef; readonly zone: IanaZone }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.team(ref, zone);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTeam({ ref, zone }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: 2 * MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function useLeaders({ league, stat }: { readonly league: League; readonly stat: LeaderStat }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.leaders(league, stat);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchLeaders({ league, stat }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: 30 * MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function usePlayer({ ref, zone }: { readonly ref: PlayerRef; readonly zone: IanaZone }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.player(ref, zone);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchPlayer({ ref, zone }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: 30 * MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, query);
}

export function useSearch({ league, query }: { readonly league: League; readonly query: SearchQuery | null }) {
  const focused = useIsFocused();
  const queryKey = queryKeys.search(league, query);
  const result = useQuery({
    queryKey,
    queryFn:
      query === null
        ? skipToken
        : ({ signal }) => fetchSearch({ league, query }, { signal, fresh: takeFresh(queryKey) }),
    staleTime: 5 * MINUTE,
    subscribed: focused,
  });
  return useRefreshable(queryKey, result);
}
