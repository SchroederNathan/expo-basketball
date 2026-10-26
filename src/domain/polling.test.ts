/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSettledDay, pollIntervalMs } from './polling';

test('polls at the API hint only while the screen is focused and data can change', () => {
  assert.equal(pollIntervalMs({ pollSeconds: 15, settled: false, focused: true }), 15_000);
  assert.equal(pollIntervalMs({ pollSeconds: 120, settled: false, focused: true }), 120_000);
  assert.equal(pollIntervalMs({ pollSeconds: 15, settled: false, focused: false }), false);
  assert.equal(pollIntervalMs({ pollSeconds: 15, settled: true, focused: true }), false);
});

test('a zero or invalid hint stops polling, and tiny hints are floored', () => {
  assert.equal(pollIntervalMs({ pollSeconds: 0, settled: false, focused: true }), false);
  assert.equal(pollIntervalMs({ pollSeconds: Number.NaN, settled: false, focused: true }), false);
  assert.equal(pollIntervalMs({ pollSeconds: -10, settled: false, focused: true }), false);
  assert.equal(pollIntervalMs({ pollSeconds: 1, settled: false, focused: true }), 5_000);
});

test('a day is settled when every game is final', () => {
  assert.equal(isSettledDay([{ state: 'post' }, { state: 'post' }]), true);
  assert.equal(isSettledDay([{ state: 'post' }, { state: 'in' }]), false);
  assert.equal(isSettledDay([{ state: 'pre' }]), false);
  assert.equal(isSettledDay([]), true);
});
