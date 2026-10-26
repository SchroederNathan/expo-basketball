/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYmd } from '@/domain/dates';
import { isGameId, isPlayerId, isTeamId } from '@/domain/ids';
import {
  gameHref,
  parseGameParams,
  parsePlayerParams,
  parseScoresParams,
  parseTeamParams,
  playerHref,
  scoresHref,
  teamHref,
} from './hrefs';

function paramsOf(href: unknown): Record<string, string> {
  assert.ok(typeof href === 'object' && href !== null && 'params' in href);
  const { params } = href;
  assert.ok(typeof params === 'object' && params !== null);
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
}

test('entity links carry their league and parse back to the same ref', () => {
  const gameId = '401909861';
  const teamId = '239';
  const playerId = '4277905';
  assert.ok(isGameId(gameId) && isTeamId(teamId) && isPlayerId(playerId));
  const game = { league: 'wnba', id: gameId } as const;
  const team = { league: 'mens-college-basketball', id: teamId } as const;
  const player = { league: 'nba', id: playerId } as const;
  assert.deepEqual(parseGameParams(paramsOf(gameHref(game))), game);
  assert.deepEqual(parseTeamParams(paramsOf(teamHref(team))), team);
  assert.deepEqual(parsePlayerParams(paramsOf(playerHref(player))), player);
});

test('an entity link without a supported league never falls back to another league', () => {
  assert.equal(parseGameParams({ gameId: '401909861' }), null);
  assert.equal(parseGameParams({ gameId: '401909861', league: 'nhl' }), null);
  assert.equal(parseTeamParams({ teamId: '13', league: ['nba', 'wnba'] }), null);
  assert.equal(parsePlayerParams({ playerId: '../secrets', league: 'nba' }), null);
  assert.deepEqual(parseTeamParams({ teamId: ['lal'], league: ['nba'] }), { league: 'nba', id: 'lal' });
});

test('scores links carry the league and an optional calendar date', () => {
  const date = parseYmd('20261020');
  assert.ok(date);
  assert.deepEqual(paramsOf(scoresHref({ league: 'wnba', date: null })), { league: 'wnba' });
  const withDate = paramsOf(scoresHref({ league: 'nba', date }));
  assert.deepEqual(withDate, { league: 'nba', date: '20261020' });
  assert.deepEqual(parseScoresParams(withDate), { league: 'nba', date: '20261020' });
  assert.deepEqual(parseScoresParams({ date: '20261332', league: 'xfl' }), { league: null, date: null });
});
