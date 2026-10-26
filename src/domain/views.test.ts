/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { latestPeriod, playsInPeriod, resolvePeriod } from './plays';
import { groupLabel, groupsForView, resolveView, standingsViews } from './standings';

describe('plays', () => {
  const chips = [
    { period: null, label: 'All' },
    { period: 1, label: 'Q1' },
    { period: 2, label: 'Q2' },
    { period: 5, label: 'OT' },
  ];

  test('open on the latest period, follow it until a choice is made, and filter locally', () => {
    assert.equal(latestPeriod(chips), 5);
    assert.equal(resolvePeriod(chips, { kind: 'latest' }), 5);
    assert.equal(resolvePeriod(chips, { kind: 'all' }), null);
    assert.equal(resolvePeriod(chips, { kind: 'period', period: 2 }), 2);
    // A choice that no longer exists falls back to the latest period.
    assert.equal(resolvePeriod(chips, { kind: 'period', period: 3 }), 5);
    assert.equal(latestPeriod([{ period: null }]), null);

    const plays = [{ period: 5 }, { period: 2 }, { period: 1 }];
    assert.deepEqual(playsInPeriod(plays, 2), [{ period: 2 }]);
    assert.equal(playsInPeriod(plays, null).length, 3);
  });
});

describe('standings views', () => {
  const group = (id: string, name: string, fullName: string) => ({ id, name, fullName });

  test('come from the data, with readable labels for abbreviated names', () => {
    const wnba = { conferences: [group('1', 'E', 'Eastern Conference'), group('2', 'W', 'Western Conference')], divisions: [] };
    assert.deepEqual(
      standingsViews(wnba).map((view) => [view.key, view.label]),
      [
        ['conference:1', 'Eastern'],
        ['conference:2', 'Western'],
      ],
    );
    assert.equal(groupLabel(group('1', 'aeast', 'America East Conference')), 'America East');
    assert.equal(groupLabel(group('4', 'Pacific', '')), 'Pacific');
  });

  test('add a divisions view only when divisions exist, and filter to the chosen view', () => {
    const nba = {
      conferences: [group('5', 'East', 'Eastern Conference'), group('6', 'West', 'Western Conference')],
      divisions: [group('1', 'Atlantic', 'Atlantic'), group('4', 'Pacific', 'Pacific')],
    };
    const views = standingsViews(nba);
    assert.deepEqual(
      views.map((view) => view.label),
      ['Eastern', 'Western', 'Divisions'],
    );
    const west = resolveView(views, 'conference:6');
    assert.ok(west);
    assert.deepEqual(
      groupsForView(nba, west).map((entry) => entry.id),
      ['6'],
    );
    const divisions = resolveView(views, 'divisions');
    assert.ok(divisions);
    assert.equal(groupsForView(nba, divisions).length, 2);
    // A key from another league resolves to this league's first view.
    assert.equal(resolveView(views, 'conference:999')?.key, 'conference:5');
    assert.equal(resolveView([], null), null);
  });
});
