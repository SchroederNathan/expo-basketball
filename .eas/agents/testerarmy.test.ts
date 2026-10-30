import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { command, succeeded } from './process';

test('TesterArmy production runner, provider, OAuth, report, and media offline contracts under Node', { timeout: 125_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'testerarmy-node-test-'));
  try {
    const result = await command({ executable: { file: 'node', args: [] }, args: ['offline-check.mjs'],
      cwd: resolve('.eas/agents/testerarmy'), env: { PATH: process.env.PATH, HOME: home, CI: '1', E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' }, timeoutMs: 120_000 });
    if (!succeeded(result)) throw new Error(`${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes('"runtime":"v22.23.1"'));
    assert.ok(result.stdout.includes('"mode":"seed","status":"failed","exitCode":1'));
    assert.ok(result.stdout.includes('"mode":"repaired","status":"passed","exitCode":0'));
  } finally { await rm(home, { recursive: true, force: true }); }
});
