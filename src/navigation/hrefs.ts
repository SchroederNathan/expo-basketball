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
