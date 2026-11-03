import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexFailure } from './codex-failure';

const exited = (stderr: string, stdout = '') => codexFailure({ termination: { kind: 'exited', code: 1 }, stdout, stderr });

test('names the failure category, exit code, and HTTP status', () => {
  assert.equal(exited('ERROR: You have hit your usage limit. Try again later.'), 'Codex did not finish successfully (exit 1, usage limit).');
  assert.equal(exited('stream error: unexpected status 429 Too Many Requests'), 'Codex did not finish successfully (exit 1, rate limit, HTTP 429).');
  assert.equal(exited('unexpected status 401 Unauthorized: refresh token expired'), 'Codex did not finish successfully (exit 1, authentication, HTTP 401).');
  assert.equal(exited("The model 'gpt-6.1-sol' does not exist or is not supported"), 'Codex did not finish successfully (exit 1, model unavailable).');
  assert.equal(exited('unexpected status 400: {"error":{"type":"overloaded"}}'), 'Codex did not finish successfully (exit 1, provider overloaded, HTTP 400).');
  assert.equal(exited('stream disconnected before completion'), 'Codex did not finish successfully (exit 1, network).');
  assert.equal(exited('something else entirely'), 'Codex did not finish successfully (exit 1, unrecognized error).');
});

test('never repeats the raw output', () => {
  const secret = 'placeholder-secret-value-0123456789';
  assert.ok(!exited(`usage limit for account ${secret}`).includes(secret));
  assert.equal(codexFailure({ termination: { kind: 'timeout', reason: 'timeout' }, stdout: secret, stderr: '' }), 'Codex did not finish successfully (timed out).');
});
