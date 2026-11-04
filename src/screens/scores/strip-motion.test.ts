/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cellEmphasis,
  cellOnScreen,
  pagerPosition,
  STRIP_BUFFER,
  STRIP_CELLS,
  STRIP_RADIUS,
  stripOffsets,
  stripTranslate,
} from './strip-motion';

const RADIUS = 30;
const PAGE = 400;

describe('pagerPosition', () => {
  test('puts the anchor page at the anchor offset', () => {
    assert.equal(pagerPosition(RADIUS * PAGE, PAGE, 0, RADIUS), 0);
    assert.equal(pagerPosition(RADIUS * PAGE, PAGE, 45, RADIUS), 45);
  });

  test('moves one day per page and tracks a partial swipe', () => {
    assert.equal(pagerPosition((RADIUS + 1) * PAGE, PAGE, 0, RADIUS), 1);
    assert.equal(pagerPosition((RADIUS - 1) * PAGE, PAGE, 0, RADIUS), -1);
    assert.equal(pagerPosition(RADIUS * PAGE + PAGE / 4, PAGE, 0, RADIUS), 0.25);
  });

  test('holds at the anchor before the pager has a width', () => {
    assert.equal(pagerPosition(1234, 0, 7, RADIUS), 7);
  });
});

describe('stripTranslate', () => {
  test('centers the day at the position', () => {
    const cell = 50;
    // A cell at offset `o` sits at `o * cell`; the center slot starts at
    // `STRIP_RADIUS * cell`.
    for (const position of [0, 3, -2, 12]) {
      assert.equal(position * cell + stripTranslate(position, cell), STRIP_RADIUS * cell);
    }
  });

  test('slides one cell left per day swiped forward', () => {
    assert.equal(stripTranslate(0.5, 50) - stripTranslate(0, 50), -25);
    assert.equal(stripTranslate(1, 50) - stripTranslate(0, 50), -50);
  });
});

describe('cellEmphasis', () => {
  test('is full at the center and fades over one cell', () => {
    assert.equal(cellEmphasis(4, 4), 1);
    assert.equal(cellEmphasis(4, 4.25), 0.75);
    assert.equal(cellEmphasis(4, 3.5), 0.5);
    assert.equal(cellEmphasis(4, 5), 0);
    assert.equal(cellEmphasis(4, 9), 0);
  });
});

describe('stripOffsets', () => {
  test('covers the visible cells plus a buffer on each side', () => {
    const offsets = stripOffsets(10);
    assert.equal(offsets.length, STRIP_CELLS + STRIP_BUFFER * 2);
    assert.equal(offsets[0], 10 - STRIP_RADIUS - STRIP_BUFFER);
    assert.equal(offsets.at(-1), 10 + STRIP_RADIUS + STRIP_BUFFER);
    assert.ok(offsets.includes(10));
  });
});

describe('cellOnScreen', () => {
  test('keeps exactly the seven resting cells reachable', () => {
    const reachable = stripOffsets(0).filter((offset) => cellOnScreen(offset, 0));
    assert.deepEqual(reachable, [-3, -2, -1, 0, 1, 2, 3]);
  });
});
