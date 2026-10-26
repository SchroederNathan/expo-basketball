export const LEAGUE_IDS = [
  'nba',
  'wnba',
  'mens-college-basketball',
  'womens-college-basketball',
] as const;

export type League = (typeof LEAGUE_IDS)[number];

export const LEAGUES: Readonly<Record<League, { readonly label: string }>> = {
  nba: { label: 'NBA' },
  wnba: { label: 'WNBA' },
  'mens-college-basketball': { label: "Men's College" },
  'womens-college-basketball': { label: "Women's College" },
};

export const DEFAULT_LEAGUE: League = 'nba';

export function isLeague(value: unknown): value is League {
  return LEAGUE_IDS.some((id) => id === value);
}

export function parseLeague(value: unknown): League | null {
  return isLeague(value) ? value : null;
}
