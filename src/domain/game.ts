import type { League } from './league';

type ShareableGame = {
  readonly id: string;
  readonly league: League;
  readonly state: 'pre' | 'in' | 'post';
  readonly away: { readonly abbr: string; readonly score: string };
  readonly home: { readonly abbr: string; readonly score: string };
};

export function gameTitle(game: ShareableGame): string {
  if (game.state === 'pre' || game.away.score === '' || game.home.score === '') {
    return `${game.away.abbr} @ ${game.home.abbr}`;
  }
  return `${game.away.abbr} ${game.away.score} – ${game.home.score} ${game.home.abbr}`;
}

export function gameWebUrl(game: Pick<ShareableGame, 'id' | 'league'>): string {
  return `https://www.espn.com/${game.league}/game/_/gameId/${encodeURIComponent(game.id)}`;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(value)) return 0;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

// Stops for one team-color light beam: strong, fading, clear. Near-white team
// colors glare at full strength on the dark page, so they get softer stops.
export function beamStops(hex: string): readonly [string, string, string] {
  return luminance(hex) > 0.6
    ? [`${hex}4D`, `${hex}1A`, `${hex}00`]
    : [`${hex}B3`, `${hex}40`, `${hex}00`];
}
