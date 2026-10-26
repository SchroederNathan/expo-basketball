import type { League } from './league';

export type GameId = string & { readonly __brand: 'GameId' };
export type TeamId = string & { readonly __brand: 'TeamId' };
export type PlayerId = string & { readonly __brand: 'PlayerId' };

// Ids travel inside URL and API paths, so a valid id is short and path-safe.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isGameId(value: string): value is GameId {
  return ID_PATTERN.test(value);
}

export function isTeamId(value: string): value is TeamId {
  return ID_PATTERN.test(value);
}

export function isPlayerId(value: string): value is PlayerId {
  return ID_PATTERN.test(value);
}

export type GameRef = { readonly league: League; readonly id: GameId };
export type TeamRef = { readonly league: League; readonly id: TeamId };
export type PlayerRef = { readonly league: League; readonly id: PlayerId };
