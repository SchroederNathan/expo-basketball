import fixture from '../../demo/fixtures/prizepicks-v1.json';
import { ApiError } from './errors';
import { isYmd } from '@/domain/dates';

export function demoResponse({ path, params }: {
  path: `/${string}`;
  params: Readonly<Record<string, string>>;
}): unknown {
  if (params.league !== fixture.league) throw new ApiError('not-found', 'This league has no demo fixture.');
  const keys = Object.keys(params).sort().join(',');
  if (path === '/scoreboard' && keys === 'date,league,tz' && params.tz === fixture.zone) {
    if (!params.date || !isYmd(params.date)) throw new ApiError('not-found', 'This date has no demo fixture.');
    return { ...fixture.scoreboard, date: params.date, dateLabel: params.date === fixture.date ? fixture.scoreboard.dateLabel : params.date,
      games: params.date === fixture.date ? fixture.scoreboard.games : [] };
  }
  if (keys === 'league,tz' && params.tz === fixture.zone) {
    const player = fixture.players.find((page) => path === `/players/${page.player.id}`);
    if (player) return JSON.parse(JSON.stringify(player));
    if (path === '/games/demo-game-1') return JSON.parse(JSON.stringify(fixture.game));
  }
  if (path === '/games/demo-game-1/plays' && keys === 'league,period' && params.period === 'all') {
    return { gameId: 'demo-game-1', state: 'post', periods: fixture.game.periods, plays: [] };
  }
  if (path === '/search' && keys === 'league,q' && typeof params.q === 'string') {
    const query = params.q;
    return {
      query,
      results: fixture.players.filter(({ player }) => player.name.toLowerCase().includes(query.toLowerCase()))
        .map(({ player }) => ({ type: 'player', id: player.id, name: player.name, image: '', subtitle: 'Comets · Guard' })),
    };
  }
  throw new ApiError('not-found', 'This request has no demo fixture. Live API fallback is disabled.');
}
