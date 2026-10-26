/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseServiceUrl } from './config';
import {
  applyDraft,
  clockFromLocalDate,
  clockToLocalDate,
  EMPTY_DRAFT,
  isApnsToken,
  isClockTime,
  isDraftEmpty,
  parsePushDestination,
  preferenceFor,
  versionedPreferencesSchema,
  type ClockTime,
} from './model';

function clock(value: string): ClockTime {
  assert.ok(isClockTime(value), `${value} should be a clock time`);
  return value;
}

describe('push destinations', () => {
  test('open the game with the push league', () => {
    const payload = {
      aps: { alert: { title: 'Final', body: 'LAL 132-123' } },
      v: 1,
      notificationId: 'k57abc',
      league: 'wnba',
      destination: { screen: 'game', gameId: '401909861' },
    };
    assert.deepEqual(parsePushDestination(payload), {
      kind: 'game',
      deliveryId: 'k57abc',
      game: { league: 'wnba', id: '401909861' },
    });
  });

  test('recaps open scores for the push league, and older flat payloads still work', () => {
    assert.deepEqual(parsePushDestination({ notificationId: 'k1', league: 'nba', destination: { screen: 'scores' } }), {
      kind: 'scores',
      deliveryId: 'k1',
      league: 'nba',
      date: null,
    });
    assert.deepEqual(parsePushDestination({ id: 'k2', league: 'mens-college-basketball', screen: 'scores', date: '20261025' }), {
      kind: 'scores',
      deliveryId: 'k2',
      league: 'mens-college-basketball',
      date: '20261025',
    });
  });

  test('a game push with a bad id opens scores, and unknown payloads open nothing', () => {
    assert.equal(parsePushDestination({ league: 'nba', destination: { screen: 'game', gameId: '../x' } })?.kind, 'scores');
    assert.equal(parsePushDestination({ league: 'nhl', destination: { screen: 'game', gameId: '1' } }), null);
    assert.equal(parsePushDestination('not a payload'), null);
    assert.equal(parsePushDestination(null), null);
    assert.equal(parsePushDestination({ notificationId: 'bad id!', league: 'nba' })?.deliveryId, null);
  });
});

describe('preference drafts', () => {
  const stored = versionedPreferencesSchema.parse({
    revision: 4,
    preferences: {
      timeZone: 'America/Toronto',
      locale: 'en',
      recapTime: '09:00',
      quietStart: '22:00',
      quietEnd: '08:00',
      leagues: [
        {
          league: 'nba',
          enabled: true,
          favoriteTeamId: '13',
          scope: 'team',
          recap: true,
          tipoffs: false,
          finals: true,
          performances: false,
        },
      ],
    },
  });

  test('apply only edited fields on top of the stored bundle', () => {
    const next = applyDraft(
      stored.preferences,
      { leagues: { nba: { tipoffs: true } }, schedule: { quietStart: clock('23:30') } },
      'America/Vancouver',
    );
    assert.deepEqual(preferenceFor(next, 'nba'), { ...preferenceFor(stored.preferences, 'nba'), tipoffs: true });
    assert.equal(next.quietStart, '23:30');
    assert.equal(next.quietEnd, '08:00');
    assert.equal(next.timeZone, 'America/Vancouver');
  });

  test('clearing the favorite team widens a team-only scope to the league', () => {
    const next = applyDraft(stored.preferences, { leagues: { nba: { favoriteTeamId: '' } }, schedule: {} }, 'UTC');
    assert.equal(preferenceFor(next, 'nba').scope, 'league');
  });

  test('an edit for a league the service has not stored yet adds that league', () => {
    const next = applyDraft(stored.preferences, { leagues: { wnba: { enabled: true } }, schedule: {} }, 'UTC');
    assert.equal(next.leagues.length, 2);
    assert.deepEqual(preferenceFor(next, 'wnba'), { ...preferenceFor(stored.preferences, 'wnba'), enabled: true });
    assert.equal(isDraftEmpty(EMPTY_DRAFT), true);
    assert.equal(isDraftEmpty({ leagues: { wnba: {} }, schedule: {} }), true);
    assert.equal(isDraftEmpty({ leagues: {}, schedule: { recapTime: clock('07:00') } }), false);
  });
});

describe('device values', () => {
  test('only direct APNs tokens are accepted', () => {
    assert.equal(isApnsToken('a'.repeat(64)), true);
    assert.equal(isApnsToken('a'.repeat(63)), false);
    assert.equal(isApnsToken('ExponentPushToken[abc]'), false);
    assert.equal(isApnsToken('g'.repeat(64)), false);
  });

  test('clock times round-trip through local picker dates', () => {
    for (const value of ['00:00', '09:05', '23:59']) {
      assert.ok(isClockTime(value));
      assert.equal(clockFromLocalDate(clockToLocalDate(value)), value);
    }
    assert.equal(isClockTime('24:00'), false);
  });

  test('a notification service must be an https URL, with no default', () => {
    assert.equal(parseServiceUrl(undefined), null);
    assert.equal(parseServiceUrl(''), null);
    assert.equal(parseServiceUrl('http://insecure.example.com'), null);
    assert.equal(parseServiceUrl('https://push.example.com/'), 'https://push.example.com');
  });
});
