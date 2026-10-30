import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../demo/fixtures/prizepicks-v1.json';
import { demoEnabled, DEMO_CALENDAR } from '@/demo/config';
import { seasonStatTiles } from '@/domain/player-stats';
import { demoResponse } from './demo';
import { gameDetailSchema, playerPageSchema, scoreboardSchema, searchResultsSchema } from './schemas';

test('demo scores are stable, synthetic, and pass the real API schemas', () => {
  const request = { path: '/scoreboard', params: { league: 'nba', date: '20261026', tz: 'America/Toronto' } } satisfies Parameters<typeof demoResponse>[0];
  const board = scoreboardSchema.parse(demoResponse(request));
  assert.equal(board.games[0]?.away.score, '100');
  assert.equal(board.games[0]?.home.score, '108');
  assert.equal(board.games[0]?.state, 'post');
  assert.deepEqual(demoResponse(request), demoResponse(request));
  const nextDay = scoreboardSchema.parse(demoResponse({ ...request, params: { ...request.params, date: '20261027' } }));
  assert.deepEqual(nextDay.games, []);
  assert.equal(DEMO_CALENDAR.today, fixture.date);
  assert.equal(DEMO_CALENDAR.zone, fixture.zone);
  const game = gameDetailSchema.parse(demoResponse({ path: '/games/demo-game-1', params: { league: 'nba', tz: fixture.zone } }));
  assert.equal(game.leaders[0]?.name, 'Avery Stone');
  assert.equal(game.game.id, board.games[0]?.id);
});

test('two players support search and profiles with current, historical, and unknown stat labels', () => {
  for (const player of fixture.players) {
    const name = player.player.name;
    const query = name.split(' ')[0] ?? name;
    const results = searchResultsSchema.parse(demoResponse({ path: '/search', params: { league: 'nba', q: query } }));
    assert.equal(results.results[0]?.id, player.player.id);
    const page = playerPageSchema.parse(demoResponse({ path: `/players/${player.player.id}`, params: { league: 'nba', tz: fixture.zone } }));
    assert.equal(page.player.name, name);
    if (name === 'Avery Stone') {
      assert.deepEqual(page.player.stats, [
        { label: 'PTS', value: '24.0', rank: '1st' },
        { label: 'REB', value: '6.0', rank: '2nd' },
        { label: 'AST', value: '8.0', rank: '1st' },
      ]);
    }
    if (name === 'Jordan Vale') {
      assert.deepEqual(page.player.stats, [
        { label: 'PTS', value: '18.5', rank: '3rd' },
        { label: 'REB', value: '7.0', rank: '1st' },
        { label: 'Stat', value: '4.2', rank: '' },
      ]);
    }
    assert.equal(page.games[0]?.id, 'demo-game-1');
  }
  const empty = searchResultsSchema.parse(demoResponse({ path: '/search', params: { league: 'nba', q: 'Nobody' } }));
  assert.deepEqual(empty.results, []);
  assert.ok(!JSON.stringify(fixture).includes('https://'));
});

test('season tiles expose historical and unknown labels with accessible values and unique keys', () => {
  const page = playerPageSchema.parse(demoResponse({ path: '/players/demo-jordan', params: { league: 'nba', tz: fixture.zone } }));
  const tiles = seasonStatTiles(page.player.stats);
  assert.deepEqual(
    tiles.map(({ label, value, accessibilityLabel }) => ({ label, value, accessibilityLabel })),
    [
      { label: 'PTS', value: '18.5', accessibilityLabel: 'PTS 18.5, ranked 3rd' },
      { label: 'REB', value: '7.0', accessibilityLabel: 'REB 7.0, ranked 1st' },
      { label: 'Stat', value: '4.2', accessibilityLabel: 'Stat 4.2' },
    ],
  );

  const repeated = playerPageSchema.parse({
    ...page,
    player: {
      ...page.player,
      stats: [
        ...page.player.stats,
        { label: 'PTS', name: 'demoUnknownMetric', value: '2.0' },
        { name: 'demoUnknownMetric', value: '5.0' },
        { label: '   ', name: 'anotherUnknownMetric', value: '1.0' },
        { label: null, name: 42, value: '0' },
      ],
    },
  });
  const repeatedTiles = seasonStatTiles(repeated.player.stats);
  assert.deepEqual(repeatedTiles.map((tile) => tile.label), ['PTS', 'REB', 'Stat', 'PTS', 'Stat', 'Stat', 'Stat']);
  assert.ok(repeatedTiles.every((tile) => tile.label.trim() && tile.accessibilityLabel.includes(tile.value)));
  assert.equal(new Set(repeatedTiles.map((tile) => tile.key)).size, repeatedTiles.length);
});

test('unknown fixture configuration and unmatched request identities fail closed', () => {
  assert.equal(demoEnabled(undefined), false);
  assert.equal(demoEnabled(''), false);
  assert.equal(demoEnabled('prizepicks-v1'), true);
  assert.throws(() => demoEnabled('typo'), /Unknown demo fixture/);
  const invalid: Parameters<typeof demoResponse>[0][] = [
    { path: '/unknown', params: { league: 'nba' } },
    { path: '/scoreboard', params: { league: 'wnba', date: fixture.date, tz: fixture.zone } },
    { path: '/scoreboard', params: { league: 'nba', date: '20260230', tz: fixture.zone } },
    { path: '/players/demo-avery', params: { league: 'nba', tz: 'UTC' } },
    { path: '/players/demo-avery', params: { league: 'nba', tz: fixture.zone, unexpected: 'yes' } },
  ];
  for (const request of invalid) assert.throws(() => demoResponse(request));
});
