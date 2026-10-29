import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistSubscription, seedSubscription, subscriptionConfig, validateSubscription } from './auth';

test('subscription validation accepts native Codex token metadata and preserves the complete credential file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lob-auth-metadata-'));
  const seedFile = join(root, 'seed.json');
  const subscription = {
    auth_mode: 'chatgpt', OPENAI_API_KEY: null,
    agent_identity: null,
    tokens: {
      access_token: 'synthetic-access', id_token: 'synthetic-id', refresh_token: 'synthetic-refresh',
      account_id: 'synthetic-account', login_owner_id: 'synthetic-login',
      oauth_provenance: { issuer: 'https://auth.openai.com', client_id: 'synthetic-client' },
    },
    last_refresh: '2026-10-29T00:00:00.000Z',
  };
  const bytes = JSON.stringify(subscription, null, 2);
  try {
    await writeFile(seedFile, bytes);
    const seeded = await seedSubscription({ seedFile, directory: join(root, 'codex') });
    assert.equal(validateSubscription(subscription).auth_mode, 'chatgpt');
    assert.equal(await readFile(seeded.file, 'utf8'), bytes);
    assert.equal(await readFile(seedFile, 'utf8'), bytes);
    assert.ok(seeded.secrets.includes('synthetic-refresh'));
    assert.throws(() => validateSubscription({ ...subscription, auth_mode: 'apikey' }));
    assert.throws(() => validateSubscription({ ...subscription, tokens: { ...subscription.tokens, refresh_token: '' } }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeback uses its dedicated credential and excludes unrelated secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lob-auth-writer-'));
  const file = join(root, 'auth.json');
  const capture = join(root, 'environment.json');
  const script = join(root, 'writer.mjs');
  try {
    await writeFile(file, JSON.stringify({ auth_mode: 'chatgpt', tokens: {
      access_token: 'synthetic-access', id_token: 'synthetic-id', refresh_token: 'synthetic-refresh',
    }, last_refresh: '2026-10-29T00:00:00.000Z' }));
    await writeFile(script, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.env));`);
    const env = { PATH: process.env.PATH, HOME: root, EXPO_TOKEN: 'synthetic-simulator-token',
      AGENT_AUTH_WRITE_TOKEN: 'synthetic-writer-token', AGENT_GITHUB_WRITE_TOKEN: 'synthetic-github-token', CODEX_AUTH_JSON: file };
    await persistSubscription({ file, eas: { file: process.execPath, args: [script] }, cwd: root, env, timeoutMs: 2000 });
    const observed = JSON.parse(await readFile(capture, 'utf8'));
    assert.equal(observed.EXPO_TOKEN, env.AGENT_AUTH_WRITE_TOKEN);
    assert.equal(observed.AGENT_AUTH_WRITE_TOKEN, undefined);
    assert.equal(observed.AGENT_GITHUB_WRITE_TOKEN, undefined);
    assert.equal(observed.CODEX_AUTH_JSON, undefined);
    assert.throws(() => subscriptionConfig({ CODEX_AUTH_JSON: file }), /AGENT_AUTH_WRITE_TOKEN/);
    await assert.rejects(persistSubscription({ file, eas: { file: process.execPath, args: [script] }, cwd: root,
      env: { EXPO_TOKEN: 'synthetic-simulator-token' }, timeoutMs: 2000 }), /AGENT_AUTH_WRITE_TOKEN/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
