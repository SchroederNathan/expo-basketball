import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexFailure, withCodexRetry } from './codex-failure';

const exited = (stderr: string, stdout = '') => codexFailure({ termination: { kind: 'exited', code: 1 }, stdout, stderr });

test('names the failure category, exit code, and HTTP status', () => {
  assert.equal(exited('ERROR: You have hit your usage limit. Try again later.'), 'Codex did not finish successfully (exit 1, usage limit).');
  assert.equal(exited('stream error: unexpected status 429 Too Many Requests'), 'Codex did not finish successfully (exit 1, rate limit, HTTP 429).');
  assert.equal(exited('unexpected status 401 Unauthorized: refresh token expired'), 'Codex did not finish successfully (exit 1, authentication, HTTP 401).');
  assert.equal(exited("The model 'gpt-6.1-sol' does not exist or is not supported"), 'Codex did not finish successfully (exit 1, model unavailable).');
  assert.equal(exited('unexpected status 400: {"error":{"type":"overloaded"}}'), 'Codex did not finish successfully (exit 1, provider overloaded, HTTP 400).');
  assert.equal(exited('ERROR: Selected model is at capacity. Please try a different model.'), 'Codex did not finish successfully (exit 1, provider overloaded).');
  assert.equal(exited('The model gpt-x does not exist'), 'Codex did not finish successfully (exit 1, model unavailable).');
  assert.equal(exited('stream disconnected before completion'), 'Codex did not finish successfully (exit 1, network).');
  assert.equal(exited('something else entirely'), 'Codex did not finish successfully (exit 1, unrecognized error).');
});

test('never repeats the raw output', () => {
  const secret = 'placeholder-secret-value-0123456789';
  assert.ok(!exited(`usage limit for account ${secret}`).includes(secret));
  assert.equal(codexFailure({ termination: { kind: 'timeout', reason: 'timeout' }, stdout: secret, stderr: '' }), 'Codex did not finish successfully (timed out).');
});

const run = (code: number, stderr = '') => ({ termination: { kind: 'exited' as const, code }, stdout: '', stderr });

test('retries a provider overload and a dropped stream, then succeeds', async () => {
  const results = [run(1, 'unexpected status 503 Service Unavailable'), run(1, 'stream disconnected before completion'), run(0)];
  let resets = 0;
  const result = await withCodexRetry({ run: async () => results.shift()!, beforeRetry: async () => { resets++; }, delaysMs: [0, 0] });
  assert.equal(result.attempts, 3);
  assert.equal(result.termination.kind === 'exited' && result.termination.code, 0);
  assert.equal(resets, 2);
});

test('stops after the last delay and returns the last failure', async () => {
  let calls = 0;
  const result = await withCodexRetry({ run: async () => { calls++; return run(1, 'server overloaded'); }, delaysMs: [0, 0] });
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(codexFailure(result), 'Codex did not finish successfully (exit 1, provider overloaded).');
});

test('does not retry usage limits, authentication, timeouts, or unknown errors', async () => {
  for (const result of [run(1, 'You have hit your usage limit.'), run(1, '401 Unauthorized'), run(1, 'something else'),
    { termination: { kind: 'timeout' as const, reason: 'timeout' as const }, stdout: '', stderr: 'overloaded' }]) {
    let calls = 0;
    await withCodexRetry({ run: async () => { calls++; return result; }, delaysMs: [0, 0] });
    assert.equal(calls, 1);
  }
});
