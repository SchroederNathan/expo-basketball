import type { Href } from 'expo-router';
import { parseYmd, type Ymd } from '@/domain/dates';
import {
  isGameId,
  isPlayerId,
  isTeamId,
  type GameRef,
  type PlayerRef,
  type TeamRef,
} from '@/domain/ids';
import { parseLeague, type League } from '@/domain/league';

export type RouteParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0] ?? null;
  return null;
}

// Entity links always carry their league. Team and player ids repeat across
// leagues, and a pushed screen must keep its league after a league switch.
export function gameHref(ref: GameRef): Href {
  return { pathname: '/game/[gameId]', params: { gameId: ref.id, league: ref.league } };
}

export function teamHref(ref: TeamRef): Href {
  return { pathname: '/team/[teamId]', params: { teamId: ref.id, league: ref.league } };
}

export function playerHref(ref: PlayerRef): Href {
  return { pathname: '/player/[playerId]', params: { playerId: ref.id, league: ref.league } };
}

export function scoresHref({ league, date }: { readonly league: League; readonly date: Ymd | null }): Href {
  return { pathname: '/', params: date === null ? { league } : { league, date } };
}

export function parseGameParams(params: RouteParams): GameRef | null {
  const league = parseLeague(single(params.league));
  const id = single(params.gameId);
  return league !== null && id !== null && isGameId(id) ? { league, id } : null;
}

export function parseTeamParams(params: RouteParams): TeamRef | null {
  const league = parseLeague(single(params.league));
  const id = single(params.teamId);
  return league !== null && id !== null && isTeamId(id) ? { league, id } : null;
}

export function parsePlayerParams(params: RouteParams): PlayerRef | null {
  const league = parseLeague(single(params.league));
  const id = single(params.playerId);
  return league !== null && id !== null && isPlayerId(id) ? { league, id } : null;
}

export type ScoresParams = { readonly league: League | null; readonly date: Ymd | null };

export function parseScoresParams(params: RouteParams): ScoresParams {
  return { league: parseLeague(single(params.league)), date: parseYmd(single(params.date)) };
}

// A detail entry is a game, team, or player screen shown beside a list in the
// split layout. It converts to and from the same hrefs the stack pushes.
export type DetailEntry =
  | { readonly kind: 'game'; readonly ref: GameRef }
  | { readonly kind: 'team'; readonly ref: TeamRef }
  | { readonly kind: 'player'; readonly ref: PlayerRef };

export function detailKey(entry: DetailEntry): string {
  return `${entry.kind}:${entry.ref.league}:${entry.ref.id}`;
}

export function detailHref(entry: DetailEntry): Href {
  switch (entry.kind) {
    case 'game':
      return gameHref(entry.ref);
    case 'team':
      return teamHref(entry.ref);
    case 'player':
      return playerHref(entry.ref);
  }
}

export function detailParams(entry: DetailEntry): RouteParams {
  switch (entry.kind) {
    case 'game':
      return { gameId: entry.ref.id, league: entry.ref.league };
    case 'team':
      return { teamId: entry.ref.id, league: entry.ref.league };
    case 'player':
      return { playerId: entry.ref.id, league: entry.ref.league };
  }
}

function entryFrom(kind: string, params: RouteParams): DetailEntry | null {
  if (kind === 'game') {
    const ref = parseGameParams(params);
    return ref ? { kind, ref } : null;
  }
  if (kind === 'team') {
    const ref = parseTeamParams(params);
    return ref ? { kind, ref } : null;
  }
  if (kind === 'player') {
    const ref = parsePlayerParams(params);
    return ref ? { kind, ref } : null;
  }
  return null;
}

const DETAIL_ROUTE = /^\/(game|team|player)\/\[(?:gameId|teamId|playerId)\]$/;

export function detailEntryFromHref(href: Href): DetailEntry | null {
  if (typeof href !== 'object' || href === null || typeof href.pathname !== 'string') return null;
  const kind = DETAIL_ROUTE.exec(href.pathname)?.[1];
  const params = ('params' in href ? href.params : undefined) as RouteParams | undefined;
  return kind ? entryFrom(kind, params ?? {}) : null;
}

const DETAIL_PATH = /^\/(game|team|player)\/([^/]+)$/;

// Reads the entry from a resolved pathname such as `/game/401909861` plus the
// global search params, which carry the league.
export function detailEntryFromPath(pathname: string, params: RouteParams): DetailEntry | null {
  const match = DETAIL_PATH.exec(pathname);
  if (!match) return null;
  const [, kind = '', rawId = ''] = match;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // Keep the raw segment. The id checks reject anything malformed.
  }
  return entryFrom(kind, { ...params, [`${kind}Id`]: id });
}
