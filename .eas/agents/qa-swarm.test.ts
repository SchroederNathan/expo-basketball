import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probe } from './codex-probe';
import { laneIds, laneVerdictSchema } from './qa-lanes';
import { executeSwarm, type SwarmOptions } from './qa-swarm';
import { digest } from './result';

let mediaDirectory: string;
before(async () => {
  mediaDirectory = await mkdtemp(join(tmpdir(), 'lob-qa-media-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=200x300:d=1.2', '-c:v', 'mpeg4', join(mediaDirectory, 'clip.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(mediaDirectory, 'clip.mp4'), '-frames:v', '1', join(mediaDirectory, 'screen.png')]);
});
after(async () => { await rm(mediaDirectory, { recursive: true, force: true }); });

const fakeAuth = { auth_mode: 'chatgpt', OPENAI_API_KEY: null,
  tokens: { access_token: 'synthetic-access-token', id_token: 'synthetic-id-token', refresh_token: 'synthetic-refresh-token' },
  last_refresh: '2026-10-26T00:00:00.000Z' };
const installedBuild = '00000000-0000-4000-8000-000000000001';
const nativeBuild = '00000000-0000-4000-8000-000000000003';
type Event = { tool: string; args?: string[]; pid?: number; lane?: string; method?: string; codexHome?: string;
  envKeys?: string[]; params?: { cwd?: string; threadId?: string; config?: { shell_environment_policy: { inherit: string; set: Record<string, string> } } } };

async function scenario(mode: string, inspect: (context: { options: SwarmOptions; root: string;
  events: () => Promise<Event[]>; abort: () => void }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lob-swarm-test-'));
  const cwd = join(root, 'repo');
  const files = ['demo/fixtures/prizepicks-v1.json', '.eas/agents/check-ios.md', '.eas/workflows/qa-swarm.yml', 'app.json', 'package.json'];
  for (const file of files) {
    await mkdir(join(cwd, file, '..'), { recursive: true });
    await copyFile(resolve(file), join(cwd, file));
  }
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'candidate']);
  git(['add', '.']);
  git(['-c', 'user.name=QA test', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Fixture baseline']);
  const sha = git(['rev-parse', 'HEAD']);
  const fixtureDigest = digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json')));
  const config = join(root, 'config.json');
  const log = join(root, 'log.jsonl');
  await writeFile(config, JSON.stringify({ root, mode, sha, fixtureDigest, log, mediaDirectory, installedBuild, nativeBuild }));
  const seed = join(root, 'seed.json');
  await writeFile(seed, JSON.stringify(fakeAuth));
  const api = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url?.includes('/branches/')
      ? { name: 'candidate', commit: { sha } } : { full_name: 'SchroederNathan/expo-basketball', private: false }));
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const executable = (tool: string) => ({ file: process.execPath, args: [resolve('.eas/agents/qa-test-fixture.mjs'), config, tool] });
  const cancellation = new AbortController();
  const options: SwarmOptions = { cwd, outputRoot: join(root, 'output'), signal: cancellation.signal,
    env: { PATH: process.env.PATH, HOME: root, CODEX_AUTH_JSON: seed, EXPO_TOKEN: 'synthetic-expo-token', AGENT_AUTH_WRITE_TOKEN: 'synthetic-write-token',
      AGENT_TRUSTED_AUTOMATION: 'enabled', AGENT_TRUSTED_REPOSITORY: 'SchroederNathan/expo-basketball',
      AGENT_REPOSITORY: 'SchroederNathan/expo-basketball', AGENT_SOURCE_REF: 'candidate', AGENT_SOURCE_SHA: sha,
      AGENT_WORKFLOW_BASELINE_SHA: sha, AGENT_BUILD_ID: installedBuild, AGENT_FINGERPRINT: 'a'.repeat(40) },
    githubApiBase: `http://127.0.0.1:${address.port}`,
    executables: { eas: executable('eas'), codex: executable('server'), device: executable('device'),
      ffprobe: { file: 'ffprobe', args: [] }, ffmpeg: { file: 'ffmpeg', args: [] } },
    limits: { startupMs: 600, agentMs: 1000, cleanupMs: 2000, deviceMs: 2000, authMs: 2000, requestMs: 2000, stopMs: 1000 } };
  const events = async (): Promise<Event[]> => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  try { await inspect({ options, root, events, abort: () => cancellation.abort() }); }
  finally {
    api.closeAllConnections();
    await new Promise<void>((done) => api.close(() => done()));
    const survivors = (await events()).filter((event) => event.tool === 'server' || event.tool === 'descendant').filter((event) => {
      try { process.kill(event.pid!, 0); return true; } catch { return false; }
    });
    for (const event of survivors) { try { process.kill(event.pid!, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(survivors, [], 'No owned process may survive the controller.');
  }
}

async function publicText(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? publicText(join(root, entry.name))
    : /\.(json|md)$/.test(entry.name) ? readFile(join(root, entry.name), 'utf8') : ''))).join('\n');
}

test('three real subprocess lanes share one server and auth home with distinct owned sessions', { timeout: 15_000 }, async () => {
  await scenario('normal', async ({ options, events }) => {
    const result = await executeSwarm(options);
    assert.equal(result.state, 'PASS');
    assert.equal(result.concurrent, true);
    assert.equal(result.auth, 'persisted');
    assert.deepEqual(result.lanes.map((lane) => lane.id), laneIds);
    assert.equal(new Set(result.lanes.map((lane) => lane.session?.id)).size, 3);
    assert.equal(new Set(result.lanes.map((lane) => lane.threadId)).size, 3);
    for (const lane of result.lanes) {
      assert.equal(lane.cleanup.state, 'stopped');
      assert.equal(lane.recordingSessionId, lane.session!.id);
      assert.equal(lane.screenshots.length, 3);
    }
    const calls = await events();
    assert.equal(calls.filter((event) => event.tool === 'server').length, 1);
    const server = calls.find((event) => event.tool === 'server')!;
    assert.ok(!server.envKeys!.includes('EXPO_TOKEN'));
    assert.ok(!server.envKeys!.includes('AGENT_DEVICE_DAEMON_AUTH_TOKEN'));
    const threads = calls.filter((event) => event.method === 'thread/start');
    for (const thread of threads) {
      const policy = thread.params!.config!.shell_environment_policy;
      assert.equal(policy.inherit, 'none');
      const lane = thread.params!.cwd!.split('/').at(-1);
      assert.equal(policy.set.AGENT_DEVICE_DAEMON_AUTH_TOKEN, `synthetic-device-token-${lane}`);
      assert.equal(policy.set.AGENT_DEVICE_DAEMON_BASE_URL, `https://${lane}.example.invalid`);
      assert.equal(policy.set.EXPO_TOKEN, undefined);
      assert.equal(policy.set.CODEX_HOME, undefined);
    }
    const authWrites = calls.filter((event) => event.args?.[0] === 'env:update');
    assert.equal(authWrites.length, 2);
    assert.ok(calls.indexOf(authWrites[0]!) < calls.findIndex((event) => event.args?.[0] === 'simulator:start'));
    await assert.rejects(lstat(server.codexHome!));
    const text = await publicText(join(options.outputRoot, 'public'));
    for (const secret of ['synthetic-device-token', 'synthetic-access-token', 'synthetic-refreshed-token', 'synthetic-secret-do-not-publish']) {
      assert.ok(!text.includes(secret));
    }
    assert.ok(!text.includes('"aggregatedOutput"'));
  });
});

test('warm repack keeps native source and installed identities separate', { timeout: 15_000 }, async () => {
  await scenario('normal', async ({ options }) => {
    options.env.AGENT_NATIVE_SOURCE_BUILD_ID = nativeBuild;
    options.env.AGENT_NATIVE_SOURCE_SHA = 'c'.repeat(40);
    const result = await executeSwarm(options);
    assert.equal(result.state, 'PASS');
    assert.equal(result.target!.native.kind, 'repacked');
    assert.equal(result.target!.native.installed, installedBuild);
  });
});

test('an observed acceptance failure completes all lanes and preserves FAIL', { timeout: 15_000 }, async () => {
  await scenario('observed-fail', async ({ options, events }) => {
    const result = await executeSwarm(options);
    assert.equal(result.state, 'FAIL');
    assert.equal(result.lanes.filter((lane) => lane.state === 'PASS').length, 2);
    assert.equal((await events()).filter((event) => event.args?.[0] === 'simulator:stop').length, 3);
  });
});

for (const mode of ['malformed', 'failed-turn', 'wrong-lane', 'missing-turn', 'missing-screenshot', 'missing-recording',
  'partial-start', 'wrong-bundle', 'cleanup-failed', 'auth-final-failed', 'duplicate-session', 'exit-mid-turn', 'shutdown-exit-7', 'shutdown-signal', 'detached', 'detached-pipe']) {
  test(`${mode} fails closed and every owned simulator receives cleanup`, { timeout: 15_000 }, async () => {
    await scenario(mode, async ({ options, events }) => {
      const result = await executeSwarm(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      const calls = await events();
      assert.equal(calls.filter((event) => event.args?.[0] === 'simulator:stop').length, 3);
      assert.equal(calls.filter((event) => event.args?.[0] === 'env:update').length, 2);
      if (mode === 'duplicate-session') assert.ok(!calls.some((event) => event.tool === 'device' && event.args?.[0] === 'open'));
      if (['malformed', 'failed-turn', 'missing-turn', 'missing-screenshot'].includes(mode)) {
        assert.equal(result.lanes.filter((lane) => lane.state === 'PASS').length, 2);
      }
    });
  });
}

for (const mode of ['auth-preflight-failed', 'wrong-build']) {
  test(`${mode} prevents sessions and model turns`, { timeout: 15_000 }, async () => {
    await scenario(mode, async ({ options, events }) => {
      assert.equal((await executeSwarm(options)).state, 'INCONCLUSIVE');
      assert.ok(!(await events()).some((event) => event.args?.[0] === 'simulator:start' || event.method === 'turn/start'));
    });
  });
}

test('cancellation collects lane failures, stops all sessions, and persists auth', { timeout: 15_000 }, async () => {
  await scenario('cancel', async ({ options, events, abort }) => {
    const timer = setInterval(() => { void events().then((calls) => {
      if (calls.filter((event) => event.method === 'turn/start').length === 3) abort();
    }); }, 20);
    try {
      const result = await executeSwarm(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      assert.equal(result.auth, 'persisted');
      assert.ok(result.lanes.every((lane) => lane.cleanup.state === 'stopped'));
    } finally { clearInterval(timer); }
  });
});

test('lane verdict rejects extra fields, other checks, and a foreign screenshot', () => {
  const verdict = { id: 'scores', state: 'PASS', detail: 'Observed score.', screenshot: 'scores.png' };
  assert.ok(laneVerdictSchema.safeParse(verdict).success);
  for (const invalid of [{ ...verdict, checks: [] }, { ...verdict, id: 'unknown' }, { ...verdict, screenshot: 'search-back.png' },
    { ...verdict, state: 'PASS: yes' }, { ...verdict, detail: '' }]) assert.equal(laneVerdictSchema.safeParse(invalid).success, false);
});

test('the parent probe validates shell-written environment receipts and publishes no marker values', { timeout: 15_000 }, async () => {
  await scenario('probe', async ({ options, root }) => {
    const output = join(root, 'probe-receipt.json');
    const result = await probe({ env: options.env, cwd: options.cwd, output, signal: options.signal,
      codex: options.executables!.codex, eas: options.executables!.eas, timeoutMs: 6000 });
    assert.equal(result.state, 'PASS');
    assert.ok(result.lanes.every((lane) => lane.environmentVerified));
    assert.equal(result.authPersisted, true);
    const text = await readFile(output, 'utf8');
    assert.ok(!text.includes('synthetic-'));
    assert.ok(!text.includes('"marker"'));
    assert.ok(!text.includes('"cwd"'));
  });
});

test('a truncated faststart MP4 cannot satisfy the recording evidence gate', { timeout: 15_000 }, async () => {
  await scenario('normal', async ({ options, root }) => {
    const full = join(root, 'full.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=200x300:rate=25', '-t', '2',
      '-c:v', 'mpeg4', '-q:v', '2', '-movflags', '+faststart', full]);
    const bytes = await readFile(full);
    const truncated = join(root, 'clip.mp4');
    await writeFile(truncated, bytes.subarray(0, Math.floor(bytes.length * 0.6)));
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', truncated, '-frames:v', '1', '-f', 'null', '-'], { stdio: 'pipe' });
    assert.throws(() => execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', truncated, '-f', 'null', '-'], { stdio: 'pipe' }));
    await copyFile(join(mediaDirectory, 'screen.png'), join(root, 'screen.png'));
    const config = join(root, 'config.json');
    await writeFile(config, JSON.stringify({ ...JSON.parse(await readFile(config, 'utf8')), mediaDirectory: root }));
    const result = await executeSwarm(options);
    assert.equal(result.state, 'INCONCLUSIVE');
    assert.ok(result.lanes.every((lane) => lane.state === 'INCONCLUSIVE' && lane.recording === null));
    assert.ok(result.lanes.every((lane) => lane.cleanup.state === 'stopped'));
  });
});

for (const mode of ['probe-exit-7', 'probe-signal']) {
  test(`${mode} cannot certify the parent probe`, { timeout: 15_000 }, async () => {
    await scenario(mode, async ({ options, root }) => {
      const result = await probe({ env: options.env, cwd: options.cwd, output: join(root, 'probe.json'), signal: options.signal,
        codex: options.executables!.codex, eas: options.executables!.eas, timeoutMs: 6000 });
      assert.ok(result.lanes.every((lane) => lane.environmentVerified));
      assert.equal(result.state, 'INCONCLUSIVE');
      assert.equal(result.serverStop?.healthy, false);
      assert.equal(result.authPersisted, true);
    });
  });
}

test('a recording decode deadline fails closed and still cleans all simulators', { timeout: 15_000 }, async () => {
  await scenario('normal', async ({ options, root, events }) => {
    const decoder = join(root, 'decoder.mjs');
    await writeFile(decoder, `import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('-frames:v')) {
  process.exit(spawnSync('ffmpeg', args, { stdio: 'inherit' }).status ?? 1);
}
appendFileSync(${JSON.stringify(join(root, 'log.jsonl'))}, JSON.stringify({ tool: 'descendant', pid: process.pid }) + '\\n');
setInterval(() => {}, 1000);
`);
    options.executables!.ffmpeg = { file: process.execPath, args: [decoder] };
    options.limits!.mediaMs = 500;
    const result = await executeSwarm(options);
    assert.equal(result.state, 'INCONCLUSIVE');
    assert.ok(result.lanes.every((lane) => lane.recording === null && lane.cleanup.state === 'stopped'));
    assert.equal((await events()).filter((event) => event.tool === 'descendant').length, 3);
    assert.equal((await events()).filter((event) => event.args?.[0] === 'env:update').length, 2);
  });
});
