import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSubscription, validateSubscription } from './auth';

test('subscription validation accepts native Codex token metadata and preserves the complete credential file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lob-auth-metadata-'));
  const seedFile = join(root, 'seed.json');
  const subscription = {
    auth_mode: 'chatgpt', OPENAI_API_KEY: null,
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
