/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addDays,
  dayCells,
  dayWindow,
  daysBetween,
  isYmd,
  localNoon,
  parseYmd,
  parseZone,
  todayIn,
  windowIndex,
  ymdFromLocalDate,
  type IanaZone,
  type Ymd,
} from './dates';

function ymd(value: string): Ymd {
  const parsed = parseYmd(value);
  assert.ok(parsed, `${value} should be a calendar date`);
  return parsed;
}

function zone(value: string): IanaZone {
  const parsed = parseZone(value);
  assert.ok(parsed, `${value} should be a time zone`);
  return parsed;
}

describe('calendar dates', () => {
  test('accept only real calendar days', () => {
    assert.equal(isYmd('20280229'), true);
    assert.equal(isYmd('20270229'), false);
    assert.equal(isYmd('20261301'), false);
    assert.equal(isYmd('20261100'), false);
    assert.equal(isYmd('2026-10-26'), false);
    assert.equal(parseYmd(20261026), null);
  });

  test('day arithmetic crosses months, years, and leap days', () => {
    assert.equal(addDays(ymd('20261031'), 1), '20261101');
    assert.equal(addDays(ymd('20261231'), 1), '20270101');
    assert.equal(addDays(ymd('20280228'), 1), '20280229');
    assert.equal(addDays(ymd('20260301'), -1), '20260228');
    assert.equal(daysBetween(ymd('20261026'), ymd('20270101')), 67);
    assert.equal(daysBetween(ymd('20270101'), ymd('20261026')), -67);
  });

  test('day arithmetic ignores daylight saving changes in the process zone', () => {
    // 2026-11-01 and 2027-03-14 are North American clock changes.
    assert.equal(addDays(ymd('20261031'), 2), '20261102');
    assert.equal(addDays(ymd('20270313'), 2), '20270315');
    assert.equal(daysBetween(ymd('20270313'), ymd('20270315')), 2);
  });
});

describe('today in a time zone', () => {
  test('uses the zone, not the device clock zone', () => {
    const instant = new Date('2026-10-27T03:30:00Z');
    assert.equal(todayIn(zone('America/Los_Angeles'), instant), '20261026');
    assert.equal(todayIn(zone('America/New_York'), instant), '20261026');
    assert.equal(todayIn(zone('Europe/London'), instant), '20261027');
    assert.equal(todayIn(zone('Pacific/Kiritimati'), instant), '20261027');
  });

  test('follows the zone through the end of daylight saving time', () => {
    const newYork = zone('America/New_York');
    assert.equal(todayIn(newYork, new Date('2026-11-01T03:59:00Z')), '20261031');
    assert.equal(todayIn(newYork, new Date('2026-11-01T04:00:00Z')), '20261101');
    assert.equal(todayIn(newYork, new Date('2026-11-02T04:59:00Z')), '20261101');
    assert.equal(todayIn(newYork, new Date('2026-11-02T05:00:00Z')), '20261102');
  });

  test('rejects unknown zones', () => {
    assert.equal(parseZone('Mars/Olympus_Mons'), null);
    assert.equal(parseZone(''), null);
  });
});

describe('date strip and pager window', () => {
  test('marks today and labels weekdays without a request', () => {
    const cells = dayCells(ymd('20261026'), ymd('20261027'), 1);
    assert.deepEqual(
      cells.map((cell) => [cell.date, cell.weekday, cell.day, cell.isToday]),
      [
        ['20261025', 'SUN', 25, false],
        ['20261026', 'MON', 26, false],
        ['20261027', 'TUE', 27, true],
      ],
    );
  });

  test('indexes days inside the window and rejects days outside it', () => {
    const anchor = ymd('20261026');
    const days = dayWindow(anchor, 30);
    assert.equal(days.length, 61);
    assert.equal(days[0], '20260926');
    assert.equal(days[60], '20261125');
    assert.equal(windowIndex(anchor, ymd('20261026'), 30), 30);
    assert.equal(windowIndex(anchor, ymd('20261125'), 30), 60);
    assert.equal(windowIndex(anchor, ymd('20261126'), 30), null);
  });

  test('picker dates round-trip through local noon across clock changes', () => {
    for (const value of ['20261101', '20270314', '20261026', '20280229']) {
      assert.equal(ymdFromLocalDate(localNoon(ymd(value))), value);
    }
  });
});
