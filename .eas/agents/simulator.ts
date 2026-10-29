import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { command, safeEnvironment, succeeded, type Command } from './process';
import { sessionSchema, type Cleanup, type Target } from './result';

const startSchema = z.object({
  id: z.uuid(), deviceRunSessionUrl: z.url(),
  remoteConfig: z.object({
    agentDeviceRemoteSessionUrl: z.url().regex(/^https:\/\//),
    agentDeviceRemoteSessionToken: z.string().min(1),
  }),
});
const stoppedSchema = z.object({ id: z.uuid(), status: z.literal('STOPPED') });
const listSchema = z.object({ sessions: z.array(z.object({ id: z.uuid(), name: z.string(), tags: z.array(z.string()) })) });

export async function writeSimulatorProject(sourceDirectory: string, directory: string) {
  const { expo } = z.object({ expo: z.object({
    name: z.string().min(1), slug: z.string().min(1), owner: z.string().min(1),
    extra: z.object({ eas: z.object({ projectId: z.uuid() }) }),
  }) }).parse(await readJson(join(sourceDirectory, 'app.json')));
  await writeFile(join(directory, 'app.json'), JSON.stringify({ expo }));
  await writeFile(join(directory, 'package.json'), '{"name":"lob-device","private":true}');
}

export class Simulator {
  private id: string | null = null;
  private attempted = false;
  private readonly tag: string;
  private readonly name: string;
  readonly expiresAt: string;

  constructor(private readonly options: {
    attemptId: string; cwd: string; env: NodeJS.ProcessEnv; eas: Command; startupMs: number; cleanupMs: number;
  }) {
    this.tag = `lob-${options.attemptId}`;
    this.name = this.tag;
    this.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  }

  async start({ buildId, signal }: { buildId: Target['native']['installed']; signal: AbortSignal }) {
    this.attempted = true;
    const result = await command({ executable: this.options.eas, cwd: this.options.cwd, env: this.options.env,
      timeoutMs: this.options.startupMs, signal,
      args: ['simulator:start', '--platform', 'ios', '--type', 'agent-device', '--build-id', buildId,
        '--name', this.name, '--tag', this.tag, '--max-duration-minutes', '30', '--json', '--non-interactive'],
    });
    if (!succeeded(result)) throw new Error('Simulator startup failed or exceeded its deadline.');
    const parsed = startSchema.parse(JSON.parse(result.stdout));
    this.id = parsed.id;
    const session = sessionSchema.parse({ id: parsed.id, url: parsed.deviceRunSessionUrl,
      attemptId: this.options.attemptId, expiresAt: this.expiresAt });
    return {
      session,
      env: {
        ...safeEnvironment(this.options.env),
        AGENT_DEVICE_DAEMON_BASE_URL: parsed.remoteConfig.agentDeviceRemoteSessionUrl,
        AGENT_DEVICE_DAEMON_AUTH_TOKEN: parsed.remoteConfig.agentDeviceRemoteSessionToken,
      },
      secret: parsed.remoteConfig.agentDeviceRemoteSessionToken,
    };
  }

  async cleanup(): Promise<Cleanup> {
    if (!this.attempted) return { state: 'not-needed' };
    const started = Date.now();
    const invoke = (args: string[]) => command({ executable: this.options.eas, args, cwd: this.options.cwd,
      env: this.options.env, timeoutMs: Math.max(1, this.options.cleanupMs - (Date.now() - started)) });
    try {
      if (!this.id) {
        const list = await invoke(['simulator:list', '--tag', this.tag, '--name', this.name, '--limit', '100', '--json', '--non-interactive']);
        if (!succeeded(list)) throw new Error('Owned session discovery failed.');
        const owned = listSchema.parse(JSON.parse(list.stdout)).sessions.filter((session) => session.name === this.name && session.tags.includes(this.tag));
        if (owned.length !== 1) throw new Error('Partial startup did not yield one owned session.');
        this.id = owned[0]?.id ?? null;
      }
      if (!this.id) throw new Error('Unknown session.');
      const stopped = await invoke(['simulator:stop', '--id', this.id, '--json', '--non-interactive']);
      if (!succeeded(stopped)) throw new Error('Scoped stop failed.');
      const receipt = stoppedSchema.parse(JSON.parse(stopped.stdout));
      if (receipt.id !== this.id) throw new Error('Scoped stop returned another session.');
      const observed = await invoke(['simulator:get', '--id', this.id, '--json', '--non-interactive']);
      if (!succeeded(observed) || stoppedSchema.parse(JSON.parse(observed.stdout)).id !== this.id) throw new Error('Stop unconfirmed.');
      return { state: 'stopped', sessionId: this.id };
    } catch {
      return { state: 'unconfirmed', sessionId: this.id, expiresAt: this.expiresAt };
    }
  }
}

const buildSchema = z.object({
  id: z.uuid(), status: z.literal('FINISHED'), platform: z.literal('IOS'),
  buildProfile: z.literal('agent-preview'), isForIosSimulator: z.literal(true),
  appIdentifier: z.literal('dev.expo.basketball'),
  gitCommitHash: z.string(), fingerprint: z.object({ hash: z.string() }),
  runtime: z.object({ version: z.literal('1.0.0') }),
});

export async function verifyBuild({ target, eas, cwd, env }: { target: Target; eas: Command; cwd: string; env: NodeJS.ProcessEnv }) {
  const read = async (id: string) => {
    const result = await command({ executable: eas, args: ['build:view', id, '--json'], cwd, env, timeoutMs: 60_000 });
    if (!succeeded(result)) throw new Error('Build metadata unavailable.');
    const build = buildSchema.parse(JSON.parse(result.stdout));
    if (build.id !== id || build.fingerprint.hash !== target.fingerprint) throw new Error('Build or fingerprint mismatch.');
    return build;
  };
  const installed = await read(target.native.installed);
  if (installed.gitCommitHash !== target.source.sha) throw new Error('Installed build SHA differs from the candidate.');
  if (target.native.kind === 'repacked') {
    const nativeSource = await read(target.native.source);
    if (nativeSource.gitCommitHash !== target.native.sourceSha) throw new Error('Native source build SHA mismatch.');
  } else if (installed.gitCommitHash !== target.native.sourceSha) throw new Error('Native source SHA mismatch.');
}

export function identityLabel(target: Target): string {
  return `Lob demo ${target.fixture.id} source=${target.source.sha} fixture=${target.fixture.sha256} runtime=${target.runtime} bundle=embedded`;
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
