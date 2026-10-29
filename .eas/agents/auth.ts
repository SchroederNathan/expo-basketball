import { copyFile, mkdir, readFile, chmod, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { command, succeeded, type Command } from './process';

const subscriptionSchema = z.strictObject({
  auth_mode: z.literal('chatgpt'),
  OPENAI_API_KEY: z.null().optional(),
  tokens: z.strictObject({
    access_token: z.string().min(1), id_token: z.string().min(1),
    refresh_token: z.string().min(1), account_id: z.string().min(1).optional(),
  }),
  last_refresh: z.iso.datetime(),
});

export function validateSubscription(input: unknown) {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) throw new Error('CODEX_AUTH_JSON must be managed ChatGPT file auth with refresh tokens.');
  return parsed.data;
}

export function subscriptionConfig(env: NodeJS.ProcessEnv) {
  if (env.OPENAI_API_KEY || env.CODEX_API_KEY || env.OPENAI_BASE_URL || env.CODEX_AUTH_TOKEN) {
    throw new Error('API key, external token, and custom provider overrides are forbidden.');
  }
  const file = env.CODEX_AUTH_JSON;
  if (!file || !isAbsolute(file)) throw new Error('CODEX_AUTH_JSON must be a Secret EAS file variable.');
  return { file };
}

export async function seedSubscription({ seedFile, directory }: { seedFile: string; directory: string }) {
  const auth = validateSubscription(JSON.parse(await readFile(seedFile, 'utf8')));
  await mkdir(directory, { mode: 0o700 });
  const file = join(directory, 'auth.json');
  await copyFile(seedFile, file);
  await chmod(file, 0o600);
  await writeFile(join(directory, 'config.toml'), 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n', { mode: 0o600 });
  return { file, secrets: Object.values(auth.tokens) };
}

export async function persistSubscription({ file, eas, cwd, env, timeoutMs }: {
  file: string; eas: Command; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number;
}) {
  validateSubscription(JSON.parse(await readFile(file, 'utf8')));
  const result = await command({ executable: eas, cwd, env, timeoutMs,
    args: ['env:update', 'preview', '--variable-name', 'CODEX_AUTH_JSON', '--type', 'file',
      '--value', file, '--visibility', 'secret', '--environment', 'preview', '--non-interactive'],
  });
  if (!succeeded(result)) throw new Error('Subscription secure write-back failed. Reseed before another run.');
}
