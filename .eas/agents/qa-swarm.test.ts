import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { probe } from './codex-probe';
import { laneIds, laneVerdictSchema } from './qa-lanes';
import { executeSwarm, type SwarmOptions } from './qa-swarm';
import { probeQaTools } from './qa-tools-probe';
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
  name?: string; cwd?: string; env?: NodeJS.ProcessEnv; prefix?: string; session?: string; entry?: string;
  home?: string; state?: string; remote?: string; token?: string;
  envKeys?: string[]; params?: { cwd?: string; threadId?: string; config?: { shell_environment_policy: { inherit: string; set: Record<string, string> } } } };

async function scenario(mode: string, inspect: (context: { options: SwarmOptions; root: string;
  events: () => Promise<Event[]>; abort: () => void }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lob-swarm-test-'));
  const cwd = join(root, 'repo');
  const files = ['demo/fixtures/prizepicks-v1.json', '.eas/agents/check-ios.md', '.eas/workflows/qa-swarm.yml', 'app.json', 'package.json', '.eas/agents/qa-tools/package.json', '.eas/agents/qa-tools/bun.lock'];
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
  await writeFile(config, JSON.stringify({ root, mode, sha, fixtureDigest, runtime: JSON.parse(await readFile(join(cwd, 'app.json'), 'utf8')).expo.version, log, mediaDirectory, installedBuild, nativeBuild }));
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
  const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
  const executable = (tool: string) => ({ file: node, args: [resolve('.eas/agents/qa-test-fixture.mjs'), config, tool] });
  const bin = join(root, 'bin');
  await mkdir(bin);
  for (const name of ['bunx', 'npx']) await writeFile(join(bin, name), `#!/bin/sh\nexec '${node}' -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({tool:"forbidden-package-manager"})+"\\n");process.exit(99)' '${log}'\n`, { mode: 0o700 });
  await writeFile(join(bin, 'bun'), `#!/bin/sh\nexec '${node}' '${resolve('.eas/agents/qa-test-fixture.mjs')}' '${config}' installer "$@"\n`, { mode: 0o700 });
  const cancellation = new AbortController();
  const options: SwarmOptions = { cwd, outputRoot: join(root, 'output'), signal: cancellation.signal,
    env: { PATH: bin + ':' + process.env.PATH, HOME: root, CODEX_AUTH_JSON: seed, EXPO_TOKEN: 'synthetic-expo-token', AGENT_AUTH_WRITE_TOKEN: 'synthetic-write-token',
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
    const forbidden = (await events()).filter((event) => event.tool === 'forbidden-package-manager');
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(forbidden, [], 'No runtime package resolution.');
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
    assert.equal(calls.filter((event) => event.tool === 'model-shell').length, 3);
    assert.equal(new Set(threads.map((event) => event.params!.config!.shell_environment_policy.set.HOME)).size, 3);
    assert.equal(new Set(threads.map((event) => event.params!.config!.shell_environment_policy.set.AGENT_DEVICE_STATE_DIR)).size, 3);
    for (const thread of threads) {
      const policy = thread.params!.config!.shell_environment_policy;
      assert.equal(policy.inherit, 'none');
      const lane = thread.params!.cwd!.split('/').at(-1);
      assert.equal(policy.set.AGENT_DEVICE_DAEMON_AUTH_TOKEN, `synthetic-device-token-${lane}`);
      assert.equal(policy.set.AGENT_DEVICE_DAEMON_BASE_URL, `https://${lane}.example.invalid`);
      assert.equal(policy.set.EXPO_TOKEN, undefined);
      assert.equal(policy.set.CODEX_HOME, undefined);
      const shell = calls.find((event) => event.tool === 'model-shell' && event.cwd === thread.params!.cwd)!;
      assert.deepEqual(shell.env, policy.set);
      assert.equal(shell.prefix, `'${join(policy.set.PATH!.split(':')[0]!, 'agent-device')}'`);
      const laneResult = result.lanes.find((value) => value.id === lane)!;
      assert.equal(shell.session, laneResult.attemptId);
      const devices = calls.filter((event) => event.tool === 'device' && event.lane === lane);
      assert.ok(devices.some((event) => event.args?.[0] === 'screenshot' && event.args[1]?.endsWith(`/${lane}.png`)));
      for (const event of devices) {
        assert.equal(event.home, policy.set.HOME);
        assert.equal(event.state, policy.set.AGENT_DEVICE_STATE_DIR);
        assert.equal(event.remote, policy.set.AGENT_DEVICE_DAEMON_BASE_URL);
        assert.equal(event.token, policy.set.AGENT_DEVICE_DAEMON_AUTH_TOKEN);
        assert.equal(event.args![event.args!.indexOf('--session') + 1], laneResult.attemptId);
      }
    }
    const ready = calls.filter((event) => event.tool === 'version');
    assert.deepEqual(ready.map((event) => event.name), ['eas', 'server', 'device']);
    assert.ok(ready.every((event) => calls.indexOf(event) < calls.findIndex((call) => call.args?.[0] === 'build:view')));
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

for (const mode of ['normal', 'reduced-path', 'partial-start', 'cancel']) {
  test(`the non-injected controller uses one prepared install through ${mode} cleanup`, { timeout: 15_000 }, async () => {
    await scenario(mode, async ({ options, events, abort }) => {
      delete options.executables;
      const timer = mode === 'cancel' ? setInterval(() => { void events().then((calls) => {
        if (calls.filter((call) => call.method === 'turn/start').length === 3) abort();
      }); }, 20) : undefined;
      try {
        const result = await executeSwarm(options);
        assert.equal(result.state, ['normal', 'reduced-path'].includes(mode) ? 'PASS' : 'INCONCLUSIVE');
        assert.equal(result.auth, 'persisted');
        assert.ok(result.lanes.every((lane) => lane.cleanup.state === 'stopped'));
        const calls = await events();
        const installs = calls.filter((call) => call.tool === 'installer');
        assert.equal(installs.length, 1);
        const install = installs[0]!.cwd!;
        const entries = { eas: join(install, 'node_modules/eas-cli/bin/run'),
          server: join(install, 'node_modules/@openai/codex/bin/codex.js'),
          device: join(install, 'node_modules/agent-device/bin/agent-device.mjs') };
        for (const [name, entry] of Object.entries(entries)) {
          const tools = calls.filter((call) => call.tool === name);
          assert.ok(tools.length > 0);
          assert.ok(tools.every((call) => call.entry === entry));
        }
        const versions = calls.filter((call) => call.tool === 'version' && call.name !== 'installer');
        assert.equal(versions.length, 3);
        assert.ok(versions.every((call) => calls.indexOf(call) < calls.findIndex((event) => event.args?.[0] === 'build:view')));
        assert.equal(calls.filter((call) => call.args?.[0] === 'env:update').length, 2);
        assert.equal(calls.filter((call) => call.args?.[0] === 'simulator:stop').length, 3);
        for (const shell of calls.filter((call) => call.tool === 'model-shell')) {
          assert.equal(shell.prefix, `'${join(dirname(install), 'bin/agent-device')}'`);
          if (mode === 'reduced-path') assert.equal(shell.env!.PATH, '/nonexistent');
        }
        await assert.rejects(lstat(dirname(install)));
      } finally { clearInterval(timer); }
    });
  });
}

for (const [installMode, stage, tool, reason] of [
  ['wrong-bun', 'runtime', 'bun', 'incompatible-version'], ['fail', 'install', 'bun', 'command-failed'],
  ['wrong-pin', 'metadata', 'device', 'invalid-package'], ['bad-bin', 'metadata', 'device', 'invalid-bin'],
  ['missing-bin', 'metadata', 'device', 'invalid-bin'], ['missing-native', 'probe', 'codex', 'command-failed'],
  ['hang', 'install', 'bun', 'deadline'],
]) {
  test(`${installMode} production preparation loads no auth and starts no resources`, { timeout: 10_000 }, async () => {
    await scenario('normal', async ({ options, root, events }) => {
      const configuration = join(root, 'config.json');
      await writeFile(configuration, JSON.stringify({ ...JSON.parse(await readFile(configuration, 'utf8')), installMode }));
      options.env.CODEX_AUTH_JSON = join(root, 'missing-auth-must-not-be-loaded.json');
      delete options.executables;
      if (installMode === 'hang') options.limits!.toolingMs = 800;
      const result = await executeSwarm(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      assert.deepEqual(result.preparation, { stage, tool, reason });
      assert.equal(result.preparationDiagnostics?.storageCleanup, 'removed');
      if (installMode === 'fail') {
        assert.equal(result.preparationDiagnostics?.command?.exitCode, 8);
        assert.equal(result.preparationDiagnostics?.command?.stderr.cause, 'unclassified');
        assert.equal(result.preparationDiagnostics?.command?.cleanup.confirmed, true);
      }
      assert.equal(result.auth, 'not-loaded');
      assert.equal(result.target, null);
      assert.equal(result.server.processId, null);
      assert.ok(result.lanes.every((lane) => lane.session === null && lane.cleanup.state === 'not-needed'));
      const calls = await events();
      assert.ok(!calls.some((call) => ['eas', 'server', 'device', 'rpc', 'model-shell'].includes(call.tool)));
      const install = calls.find((call) => call.tool === 'installer');
      if (install) await assert.rejects(lstat(dirname(install.cwd!)));
      const text = await publicText(join(options.outputRoot, 'public'));
      assert.ok(!text.includes('synthetic-secret-do-not-publish'));
    });
  });
}

test('an injected wrong version also fails before subscription-file loading', async () => {
  await scenario('bad-version', async ({ options, root, events }) => {
    options.env.CODEX_AUTH_JSON = join(root, 'missing-auth.json');
    const result = await executeSwarm(options);
    assert.deepEqual(result.preparation, { stage: 'probe', tool: 'device', reason: 'version-mismatch' });
    assert.equal(result.auth, 'not-loaded');
    assert.ok((await events()).every((call) => call.tool === 'version'));
  });
});

for (const mode of ['normal', 'package-manager-after-ready']) {
  test(`the no-auth preparation probe verifies production readiness and direct launches in ${mode}`, { timeout: 10_000 }, async () => {
    await scenario(mode, async ({ options, root, events }) => {
      const output = join(root, 'tools-probe.json');
      const result = await probeQaTools({ cwd: options.cwd, env: options.env, output, signal: options.signal,
        githubApiBase: options.githubApiBase });
      assert.equal(result.status, mode === 'normal' ? 'PASS' : 'INCONCLUSIVE');
      assert.equal(result.outcomes.length, 8);
      assert.equal(result.outcomes.at(-1)!.passed, mode === 'normal');
      const calls = await events();
      assert.equal(calls.filter((call) => call.tool === 'installer').length, 1);
      assert.ok(calls.every((call) => ['installer', 'version'].includes(call.tool)));
      const text = await readFile(output, 'utf8');
      assert.ok(!text.includes('synthetic-'));
      assert.ok(!text.includes(root));
    });
  });
}

test('the cloud probe receipt preserves a safe installed EAS loader diagnosis and no later outcomes', async () => {
  await scenario('normal', async ({ options, root, events }) => {
    const configuration = join(root, 'config.json');
    await writeFile(configuration, JSON.stringify({ ...JSON.parse(await readFile(configuration, 'utf8')), installMode: 'missing-semver' }));
    const output = join(root, 'tools-probe.json');
    const result = await probeQaTools({ cwd: options.cwd, env: options.env, output, signal: options.signal,
      githubApiBase: options.githubApiBase });
    assert.equal(result.status, 'INCONCLUSIVE');
    assert.equal(result.reason, 'QA tool preparation probe/eas/command-failed.');
    assert.deepEqual(result.outcomes, []);
    assert.equal(result.preparationMs, null);
    assert.equal(result.cleanup, 'removed');
    assert.equal(result.preparation?.diagnostics?.storageCleanup, 'removed');
    assert.equal(result.preparation?.diagnostics?.packageChecks, 'validated');
    assert.equal(result.preparation?.diagnostics?.command?.exitCode, 1);
    assert.equal(result.preparation?.diagnostics?.command?.stderr.dependency, 'semver');
    const receipt = await readFile(output, 'utf8');
    assert.deepEqual(JSON.parse(receipt), result);
    assert.ok(!receipt.includes(root));
    assert.ok(!receipt.includes('synthetic-'));
    const calls = await events();
    assert.deepEqual(calls.filter((call) => call.tool === 'version').map((call) => call.name), ['installer']);
    assert.ok(calls.every((call) => ['installer', 'version'].includes(call.tool)));
  });
});

for (const failure of ['missing-node', 'old-node', 'missing-bun', 'version-deadline', 'preparation-cancelled']) {
  test(`${failure} cannot reach auth loading on the non-injected controller path`, { timeout: 10_000 }, async () => {
    await scenario('normal', async ({ options, root, events, abort }) => {
      const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
      const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
      const bin = join(root, 'bin');
      const configuration = join(root, 'config.json');
      const config = JSON.parse(await readFile(configuration, 'utf8'));
      const runtimeMode = failure === 'old-node' ? 'old' : undefined;
      await writeFile(configuration, JSON.stringify({ ...config, runtimeMode,
        ...(failure === 'version-deadline' ? { versionTool: 'device', versionMode: 'hang' } : {}),
        ...(failure === 'preparation-cancelled' ? { installMode: 'hang' } : {}) }));
      await writeFile(join(bin, 'git'), `#!/bin/sh\nexec '${git}' "$@"\n`, { mode: 0o700 });
      if (failure !== 'missing-node') await writeFile(join(bin, 'node'),
        `#!/bin/sh\nexec '${node}' '${resolve('.eas/agents/qa-test-fixture.mjs')}' '${configuration}' runtime "$@"\n`, { mode: 0o700 });
      if (failure === 'missing-bun') await rm(join(bin, 'bun'));
      options.env.PATH = bin;
      options.env.CODEX_AUTH_JSON = join(root, 'missing-auth.json');
      delete options.executables;
      if (failure === 'version-deadline') options.limits!.toolingMs = 1500;
      const timer = failure === 'preparation-cancelled' ? setInterval(() => { void events().then((calls) => {
        if (calls.some((call) => call.tool === 'descendant')) abort();
      }); }, 10) : undefined;
      try {
        const result = await executeSwarm(options);
        assert.equal(result.state, 'INCONCLUSIVE');
        const expected = failure === 'old-node' ? { stage: 'runtime', tool: 'node', reason: 'incompatible-version' }
          : failure === 'version-deadline' ? { stage: 'probe', tool: 'device', reason: 'deadline' }
          : failure === 'preparation-cancelled' ? { stage: 'install', tool: 'bun', reason: 'cancelled' }
          : { stage: 'runtime', tool: failure === 'missing-node' ? 'node' : 'bun', reason: 'unavailable' };
        assert.deepEqual(result.preparation, expected);
        assert.equal(result.auth, 'not-loaded');
        assert.equal(result.target, null);
        assert.ok(!(await events()).some((call) => ['eas', 'server', 'device', 'rpc'].includes(call.tool)));
      } finally { clearInterval(timer); }
    });
  });
}

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

for (const mode of ['device-open-failed-json', 'device-open-failed-text', 'device-open-failed-stderr']) {
  test(`${mode} retains the failed operation and safe diagnostics through cleanup`, { timeout: 15_000 }, async () => {
    await scenario(mode, async ({ options, events }) => {
      const result = await executeSwarm(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      const lane = result.lanes.find((lane) => lane.id === 'scores');
      assert.ok(lane);
      assert.equal(lane.reason, 'Device open did not complete.');
      assert.equal(lane.deviceFailure?.operation, 'open');
      assert.deepEqual(lane.deviceFailure?.termination, { kind: 'exited', code: 9 });
      if (mode.endsWith('json')) {
        assert.equal(lane.deviceFailure?.error?.code, 'REMOTE_UNAVAILABLE');
        assert.ok(lane.deviceFailure?.error?.message.includes('[redacted]'));
        assert.ok(!JSON.stringify(lane.deviceFailure).includes('synthetic-device-token'));
        assert.ok(!JSON.stringify(lane.deviceFailure).includes('?token='));
      } else assert.equal(lane.deviceFailure?.error, null);
      if (mode.endsWith('stderr')) assert.ok(lane.deviceFailure?.stderr.includes('Tool resolution failed'));
      assert.ok(!JSON.stringify(lane.deviceFailure).includes('synthetic-device-token'));
      assert.ok(!JSON.stringify(lane.deviceFailure).includes('?token='));
      assert.equal(lane.threadId, null);
      assert.equal(result.auth, 'persisted');
      assert.ok(result.lanes.every((lane) => lane.cleanup.state === 'stopped'));
      assert.equal((await events()).filter((event) => event.args?.[0] === 'simulator:stop').length, 3);
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
