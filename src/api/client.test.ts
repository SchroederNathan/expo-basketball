/// <reference types="node" />
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { parseYmd, parseZone } from '@/domain/dates';
import { isGameId, isTeamId } from '@/domain/ids';
import { fetchLeaders, fetchPlays, fetchScoreboard, fetchTeam } from './endpoints';
import { ApiError, loadErrorMessage } from './errors';

const realFetch = globalThis.fetch;
const requests: URL[] = [];
const cachePolicies: (RequestCache | undefined)[] = [];

function serve(respond: (url: URL) => Response | Promise<Response>): void {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    cachePolicies.push(init?.cache);
    return respond(url);
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  requests.length = 0;
  cachePolicies.length = 0;
});

const date = parseYmd('20261026');
const zone = parseZone('America/Toronto');
const gameId = '401909861';
assert.ok(date && zone && isGameId(gameId));

function side(id: string, abbr: string, score: string, winner: boolean) {
  return {
    id,
    abbr,
    name: abbr,
    fullName: abbr,
    location: abbr,
    logo: '',
    color: '#552583',
    accent: '#552583',
    record: '1–0',
    score,
    linescores: ['30', '30', '30', '30'],
    winner,
    leading: winner,
    rank: '',
  };
}

function scoreboard(overrides: Record<string, unknown> = {}) {
  return {
    league: 'nba',
    date: '20261026',
    dateLabel: 'Monday, October 26',
    hasLive: false,
    pollSeconds: 120,
    games: [
      {
        id: gameId,
        league: 'nba',
        state: 'post',
        startTime: '2026-10-25T21:00Z',
        status: 'Final',
        detail: 42,
        period: 0,
        periodLabel: '',
        clock: '',
        regulationPeriods: 4,
        broadcast: 'TV',
        odds: '',
        venue: '',
        shortName: 'LAL @ UTAH',
        away: side('13', 'LAL', '132', true),
        home: side('', 'TBD', '123', false),
      },
    ],
    ...overrides,
  };
}

async function rejection(task: Promise<unknown>): Promise<ApiError> {
  try {
    await task;
  } catch (error) {
    assert.ok(error instanceof ApiError, 'expected an ApiError');
    return error;
  }
  assert.fail('expected the request to fail');
}

describe('scoreboard requests', () => {
  test('send league, date, and zone, and parse into typed games', async () => {
    serve(() => Response.json(scoreboard()));
    const board = await fetchScoreboard({ league: 'nba', date, zone });
    const url = requests[0];
    assert.ok(url);
    assert.equal(url.pathname, '/api/scoreboard');
    assert.equal(url.searchParams.get('league'), 'nba');
    assert.equal(url.searchParams.get('date'), '20261026');
    assert.equal(url.searchParams.get('tz'), 'America/Toronto');
    assert.equal(url.searchParams.has('_'), false);
    const game = board.games[0];
    assert.ok(game);
    assert.equal(game.away.id, '13');
    // A participant without an id stays unlinked instead of failing the day.
    assert.equal(game.home.id, null);
    // A malformed display field becomes empty text instead of failing the day.
    assert.equal(game.detail, '');
  });

  test('a manual refresh bypasses the HTTP cache', async () => {
    serve(() => Response.json(scoreboard()));
    await fetchScoreboard({ league: 'nba', date, zone }, { fresh: true });
    assert.equal(cachePolicies[0], 'no-store');
  });

  test('an answer for another day or league never fills the request', async () => {
    serve(() => Response.json(scoreboard({ date: '20261027' })));
    const wrongDay = await rejection(fetchScoreboard({ league: 'nba', date, zone }));
    assert.equal(wrongDay.kind, 'contract');
    serve(() => Response.json(scoreboard({ league: 'wnba' })));
    const wrongLeague = await rejection(fetchScoreboard({ league: 'nba', date, zone }));
    assert.equal(wrongLeague.kind, 'contract');
  });

  test('a missing game id is a contract error with its path', async () => {
    const body = scoreboard();
    body.games = [{ ...body.games[0], id: '' }];
    serve(() => Response.json(body));
    const error = await rejection(fetchScoreboard({ league: 'nba', date, zone }));
    assert.equal(error.kind, 'contract');
    assert.equal(error.issuePath, 'games.0.id');
  });
});

describe('failures', () => {
  test('an empty HTTP 200 team response is treated as missing', async () => {
    const id = '999999';
    assert.ok(isTeamId(id));
    serve(() => Response.json({ team: { id, name: '', abbr: '' }, roster: [], results: [], upcoming: [] }));
    const missing = await rejection(fetchTeam({ ref: { league: 'nba', id }, zone }));
    assert.equal(missing.kind, 'not-found');
  });
  test('map to typed kinds and never expose the server detail', async () => {
    serve(() => Response.json({ error: 'Not found', detail: 'Error: upstream https://example.invalid/x' }, { status: 404 }));
    const missing = await rejection(fetchPlays({ ref: { league: 'nba', id: gameId } }));
    assert.equal(missing.kind, 'not-found');
    assert.equal(missing.status, 404);
    assert.doesNotMatch(loadErrorMessage(missing), /upstream|example/);

    serve(() => new Response('{"error":"Upstream data is unavailable"}', { status: 502 }));
    assert.equal((await rejection(fetchPlays({ ref: { league: 'nba', id: gameId } }))).kind, 'unavailable');

    serve(() => new Response('<html>gateway</html>', { status: 200 }));
    assert.equal((await rejection(fetchPlays({ ref: { league: 'nba', id: gameId } }))).kind, 'contract');

    serve(() => {
      throw new TypeError('Network request failed');
    });
    assert.equal((await rejection(fetchPlays({ ref: { league: 'nba', id: gameId } }))).kind, 'network');
  });

  test('a leaders answer for a different stat is rejected', async () => {
    serve(() => Response.json({ stat: 'points', label: 'PPG', season: '2026–27', players: [] }));
    assert.equal((await rejection(fetchLeaders({ league: 'nba', stat: 'blocks' }))).kind, 'contract');
  });
});

describe('play feed parsing', () => {
  test('separates plays from dividers and normalizes empty team fields', async () => {
    serve(() =>
      Response.json({
        gameId,
        state: 'post',
        periods: [
          { id: 'all', label: 'All' },
          { id: '4', label: 'Q4' },
        ],
        plays: [
          { id: '1', kind: 'divider', period: 4, periodLabel: 'Q4', clock: '0.0', awayScore: '132', homeScore: '123', text: 'END OF 4TH' },
          {
            id: '2',
            kind: 'play',
            period: 4,
            periodLabel: 'Q4',
            clock: '5.8',
            awayScore: '132',
            homeScore: '123',
            text: 'Rebound',
            teamId: '',
            logo: '',
            assist: '',
            scoring: false,
            badge: '',
            highlight: false,
            scoredBy: '',
          },
        ],
      }),
    );
    const feed = await fetchPlays({ ref: { league: 'nba', id: gameId } });
    assert.deepEqual(
      feed.periods.map((chip) => chip.period),
      [null, 4],
    );
    const [divider, play] = feed.plays;
    assert.equal(divider?.kind, 'divider');
    assert.ok(play?.kind === 'play');
    assert.equal(play.teamId, null);
    assert.equal(play.scoredBy, null);
  });
});
