/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadable } from './loadable';

test('cached data stays readable when a refresh fails', () => {
  const error = new Error('refresh failed');
  assert.deepEqual(loadable({ data: ['game'], error, fetchStatus: 'idle' }), {
    kind: 'ready',
    data: ['game'],
    refreshError: error,
  });
});

test('the first load is never shown as empty', () => {
  assert.deepEqual(loadable({ data: undefined, error: null, fetchStatus: 'fetching' }), { kind: 'loading' });
  assert.deepEqual(loadable({ data: undefined, error: null, fetchStatus: 'paused' }), { kind: 'offline' });
  const error = new Error('down');
  assert.deepEqual(loadable({ data: undefined, error, fetchStatus: 'idle' }), { kind: 'failed', error });
  assert.deepEqual(loadable({ data: [], error: null, fetchStatus: 'idle' }), {
    kind: 'ready',
    data: [],
    refreshError: null,
  });
});

test('offline cached content shows a connection notice instead of a pending refresh', () => {
  const state = loadable({ data: ['game'], error: null, fetchStatus: 'idle' }, false);
  assert.equal(state.kind, 'ready');
  if (state.kind !== 'ready') assert.fail('cached content must stay visible');
  assert.deepEqual(state.data, ['game']);
  assert.ok(state.refreshError);
  assert.deepEqual(loadable({ data: undefined, error: null, fetchStatus: 'idle' }, false), { kind: 'offline' });
});
