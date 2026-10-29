import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  if (process.env.EXPO_PUBLIC_AGENT_DEMO !== 'prizepicks-v1') {
    if (process.env.EXPO_PUBLIC_AGENT_DEMO) throw new Error('Unknown demo fixture.');
    return { ...config, name: config.name ?? 'Lob', slug: config.slug ?? 'expo-basketball' };
  }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const checkoutSha = git.status === 0 ? git.stdout.trim() : undefined;
  const sourceSha = process.env.EAS_BUILD_GIT_COMMIT_HASH ?? checkoutSha;
  if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Demo builds require an exact source SHA.');
  if (checkoutSha && checkoutSha !== sourceSha) {
    throw new Error('EAS source disagrees with the checkout. Dispatch at the exact candidate SHA.');
  }
  const fixtureSha256 = createHash('sha256').update(readFileSync('demo/fixtures/prizepicks-v1.json')).digest('hex');
  return {
    ...config,
    name: config.name ?? 'Lob',
    slug: config.slug ?? 'expo-basketball',
    updates: { ...config.updates, enabled: true, checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0 },
    extra: { ...config.extra, agentDemo: { sourceSha, fixtureId: 'prizepicks-v1', fixtureSha256, runtime: config.version } },
  };
}
