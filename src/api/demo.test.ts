import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../demo/fixtures/prizepicks-v1.json';
import { demoEnabled, DEMO_CALENDAR } from '@/demo/config';
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

test('two players support search and profiles while preserving the seeded label defect', () => {
  for (const player of fixture.players) {
    const name = player.player.name;
    const query = name.split(' ')[0] ?? name;
    const results = searchResultsSchema.parse(demoResponse({ path: '/search', params: { league: 'nba', q: query } }));
    assert.equal(results.results[0]?.id, player.player.id);
    const page = playerPageSchema.parse(demoResponse({ path: `/players/${player.player.id}`, params: { league: 'nba', tz: fixture.zone } }));
    assert.equal(page.player.name, name);
    if (name === 'Avery Stone') assert.deepEqual(page.player.stats.map((stat) => stat.label), ['PTS', 'REB', 'AST']);
    if (name === 'Jordan Vale') {
      assert.deepEqual(page.player.stats.map((stat) => stat.label), ['', 'REB', '']);
      assert.equal(page.player.stats[0]?.value, '18.5');
      assert.equal(page.player.stats[2]?.value, '4.2');
    }
    assert.equal(page.games[0]?.id, 'demo-game-1');
  }
  const empty = searchResultsSchema.parse(demoResponse({ path: '/search', params: { league: 'nba', q: 'Nobody' } }));
  assert.deepEqual(empty.results, []);
  assert.ok(!JSON.stringify(fixture).includes('https://'));
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
