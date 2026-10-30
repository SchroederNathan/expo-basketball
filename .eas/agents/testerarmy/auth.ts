import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { command, safeEnvironment, succeeded, type Command } from '../process';

export const oauthSchema = z.strictObject({ openai: z.strictObject({
  access: z.string().min(1), refresh: z.string().min(1),
  expires: z.number().int().min(1_000_000_000_000).max(8_640_000_000_000_000),
  accountId: z.string().min(1).optional(), residency: z.string().min(1).optional(),
}) });

export function subscriptionConfig(env: NodeJS.ProcessEnv) {
  if (Object.keys(env).some((key) => /^(?:E2E_OAUTH_CREDENTIALS|E2E_CACHE_DIR|OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_ORG_ID|OPENAI_PROJECT_ID|CODEX_AUTH_TOKEN)$/.test(key) && env[key] !== undefined)) {
    throw new Error('Ambient OAuth, API-key, provider, and cache overrides are forbidden.');
  }
  if (!env.TESTERARMY_OAUTH_JSON || !isAbsolute(env.TESTERARMY_OAUTH_JSON)) throw new Error('TESTERARMY_OAUTH_JSON must be a dedicated e2e Secret file variable.');
  if (!env.AGENT_AUTH_WRITE_TOKEN) throw new Error('AGENT_AUTH_WRITE_TOKEN is required for dedicated e2e persistence.');
  return { file: env.TESTERARMY_OAUTH_JSON };
}

export async function seedSubscription(seed: string, directory: string) {
  const parsed = oauthSchema.parse(JSON.parse(await readFile(seed, 'utf8')));
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'e2e'), { mode: 0o700 });
  const file = join(directory, 'e2e/oauth.json');
  await writeFile(file, JSON.stringify(parsed), { flag: 'wx', mode: 0o600 });
  await chmod(directory, 0o700);
  return file;
}

export async function persistSubscription({ file, eas, cwd, env, timeoutMs = 60_000 }: {
  file: string; eas: Command; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number;
}) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error('Dedicated OAuth file must be private and regular.');
  oauthSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  if (!env.AGENT_AUTH_WRITE_TOKEN) throw new Error('Dedicated auth writer is unavailable.');
  const result = await command({ executable: eas, cwd, timeoutMs,
    env: { ...safeEnvironment(env), EXPO_TOKEN: env.AGENT_AUTH_WRITE_TOKEN, CI: '1', EAS_NO_VCS: '1' },
    args: ['env:update', 'preview', '--variable-name', 'TESTERARMY_OAUTH_JSON', '--type', 'file', '--value', file,
      '--visibility', 'secret', '--environment', 'preview', '--non-interactive'],
  });
  if (!succeeded(result)) throw new Error('Dedicated e2e subscription write-back failed.');
}

export async function finalizeSubscription(options: Parameters<typeof persistSubscription>[0] & {
  execution: 'not-started' | 'unfinished' | 'completed';
}) {
  try {
    await persistSubscription(options);
    return options.execution === 'unfinished' ? 'uncertain' : 'persisted';
  } catch {
    return options.execution === 'unfinished' ? 'uncertain' : 'write-back-failed';
  }
}

export function runnerEnvironment(env: NodeJS.ProcessEnv, home: string, xdg: string): NodeJS.ProcessEnv {
  if (!env.EXPO_TOKEN) throw new Error('The built-in Developer EXPO_TOKEN is required.');
  return { PATH: env.PATH, TMPDIR: env.TMPDIR, LANG: env.LANG, HOME: home, XDG_CONFIG_HOME: xdg,
    EXPO_TOKEN: env.EXPO_TOKEN, CI: '1', E2E_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', EXPO_NO_DOTENV: '1' };
}
