import type { IanaZone, Ymd } from '@/domain/dates';
import type { GameRef, PlayerRef, TeamRef } from '@/domain/ids';
import type { LeaderStat } from '@/domain/leaders';
import type { League } from '@/domain/league';
import type { SearchQuery } from '@/domain/search';
import { apiGet, type RequestOptions } from './client';
import { ApiError } from './errors';
import {
  gameDetailSchema,
  leadersSchema,
  playerPageSchema,
  playFeedSchema,
  scoreboardSchema,
  searchResultsSchema,
  standingsSchema,
  teamPageSchema,
  teamsIndexSchema,
  type GameDetail,
  type Leaders,
  type PlayerPage,
  type PlayFeed,
  type Scoreboard,
  type SearchResults,
  type Standings,
  type TeamPage,
  type TeamsIndex,
} from './schemas';

function mismatch(field: string): ApiError {
  return new ApiError('contract', `The response answered for a different ${field}.`, {
    issuePath: field,
  });
}

export async function fetchScoreboard(
  { league, date, zone }: { readonly league: League; readonly date: Ymd; readonly zone: IanaZone },
  options: RequestOptions = {},
): Promise<Scoreboard> {
  const board = await apiGet({
    path: '/scoreboard',
    params: { league, date, tz: zone },
    schema: scoreboardSchema,
    ...options,
  });
  if (board.league !== league) throw mismatch('league');
  if (board.date !== date) throw mismatch('date');
  return board;
}

export async function fetchGame(
  { ref, zone }: { readonly ref: GameRef; readonly zone: IanaZone },
  options: RequestOptions = {},
): Promise<GameDetail> {
  const detail = await apiGet({
    path: `/games/${encodeURIComponent(ref.id)}`,
    params: { league: ref.league, tz: zone },
    schema: gameDetailSchema,
    ...options,
  });
  if (detail.game.league !== ref.league) throw mismatch('league');
  if (detail.game.id !== ref.id) throw mismatch('game');
  return detail;
}

export async function fetchPlays(
  { ref }: { readonly ref: GameRef },
  options: RequestOptions = {},
): Promise<PlayFeed> {
  const feed = await apiGet({
    path: `/games/${encodeURIComponent(ref.id)}/plays`,
    params: { league: ref.league, period: 'all' },
    schema: playFeedSchema,
    ...options,
  });
  if (feed.gameId !== ref.id) throw mismatch('game');
  return feed;
}

export function fetchStandings(
  { league, zone }: { readonly league: League; readonly zone: IanaZone },
  options: RequestOptions = {},
): Promise<Standings> {
  return apiGet({ path: '/standings', params: { league, tz: zone }, schema: standingsSchema, ...options });
}

export function fetchTeams(
  { league }: { readonly league: League },
  options: RequestOptions = {},
): Promise<TeamsIndex> {
  return apiGet({ path: '/teams', params: { league }, schema: teamsIndexSchema, ...options });
}

export async function fetchTeam(
  { ref, zone }: { readonly ref: TeamRef; readonly zone: IanaZone },
  options: RequestOptions = {},
): Promise<TeamPage> {
  const page = await apiGet({
    path: `/teams/${encodeURIComponent(ref.id)}`,
    params: { league: ref.league, tz: zone },
    schema: teamPageSchema,
    ...options,
  });
  if (page.team.name === '' && page.team.abbr === '') {
    throw new ApiError('not-found', 'The team is not available.');
  }
  return page;
}

export async function fetchLeaders(
  { league, stat }: { readonly league: League; readonly stat: LeaderStat },
  options: RequestOptions = {},
): Promise<Leaders> {
  const leaders = await apiGet({
    path: '/players',
    params: { league, stat },
    schema: leadersSchema,
    ...options,
  });
  if (leaders.stat !== stat) throw mismatch('stat');
  return leaders;
}

export function fetchPlayer(
  { ref, zone }: { readonly ref: PlayerRef; readonly zone: IanaZone },
  options: RequestOptions = {},
): Promise<PlayerPage> {
  return apiGet({
    path: `/players/${encodeURIComponent(ref.id)}`,
    params: { league: ref.league, tz: zone },
    schema: playerPageSchema,
    ...options,
  });
}

export function fetchSearch(
  { league, query }: { readonly league: League; readonly query: SearchQuery },
  options: RequestOptions = {},
): Promise<SearchResults> {
  return apiGet({ path: '/search', params: { league, q: query }, schema: searchResultsSchema, ...options });
}
