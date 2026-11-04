/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseYmd } from '@/domain/dates';
import { scoresNavigationTitle } from './title';

describe('Scores navigation title', () => {
  test('stays Scores for every selected date', () => {
    for (const value of ['20261025', '20261026']) {
      const date = parseYmd(value);
      assert.ok(date);
      assert.equal(scoresNavigationTitle(date), 'Scores');
    }
  });
});
