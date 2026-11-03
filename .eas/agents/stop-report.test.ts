import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopReport } from './stop-report';

const env = { AGENT_SOURCE_SHA: '9d178e0'.padEnd(40, '0'), AGENT_SOURCE_REF: 'fix/duo-header-rail', AGENT_REPOSITORY: 'SchroederNathan/expo-basketball',
  AGENT_RUN_URL: 'https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a19f15-b690-7ab7-a7a5-15787c0c7405' };

test('a rejected target names the reason in plain words', () => {
  const report = stopReport('PR target branch lacks the audited workflow baseline.', env);
  assert.ok(report.startsWith('### ⚪ Agentic CI iOS: not run\n[`9d178e0`](https://github.com/SchroederNathan/expo-basketball/commit/'));
  assert.ok(report.includes('[Workflow](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a19f15-b690-7ab7-a7a5-15787c0c7405)'));
  assert.ok(report.includes("This PR's target branch does not contain the reviewed agent workflows"));
});

test('unknown errors and untrusted inputs never reach the report', () => {
  const report = stopReport('token placeholder-secret-value-0123456789 leaked', { ...env, AGENT_RUN_URL: 'https://evil.example/x', AGENT_SOURCE_SHA: 'nope' });
  assert.ok(!report.includes('placeholder-secret')); assert.ok(!report.includes('evil.example')); assert.ok(!report.includes('[Workflow]'));
  assert.ok(report.includes('The source or setup checks did not pass'));
});
