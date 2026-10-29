import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { codexCommand } from './codex-server';
import { lanePrompt } from './qa-lanes';
import { command, succeeded } from './process';
import { prepareQaTools, qaToolPins, QaToolPreparationError } from './qa-tools';

type FixtureConfig = { installMode?: string; runtimeMode?: string; versionTool?: string; versionMode?: string; versionDelayMs?: number;
  versionStderr?: string; versionStdout?: string };
type Event = { tool: string; args?: string[]; cwd?: string; pid?: number; name?: string; home?: string; env?: NodeJS.ProcessEnv; envKeys?: string[] };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();

async function fixture(config: FixtureConfig, inspect: (context: {
  options: Parameters<typeof prepareQaTools>[0]; log: () => Promise<Event[]>; bin: string; root: string;
  executable: (name: string) => { file: string; args: string[] }; abort: () => void;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lob-qa-tools test's-"));
  const sourceDirectory = join(root, 'source');
  const bundle = join(sourceDirectory, '.eas/agents/qa-tools');
  const bin = join(root, 'bin');
  await mkdir(bundle, { recursive: true });
  await mkdir(bin);
  for (const name of ['package.json', 'bun.lock']) await copyFile(resolve('.eas/agents/qa-tools', name), join(bundle, name));
  const configuration = join(root, "fixture's config.json");
  const logFile = join(root, 'events.jsonl');
  await writeFile(configuration, JSON.stringify({ root, log: logFile, mode: 'normal', ...config }));
  const executable = (name: string) => ({ file: node, args: [resolve('.eas/agents/qa-test-fixture.mjs'), configuration, name] });
  for (const [name, tool] of [['bun', 'installer'], ['node', 'runtime']]) {
    const raw = executable(tool!);
    await writeFile(join(bin, name!), `#!/bin/sh\nexec ${[raw.file, ...raw.args].map(quote).join(' ')} "$@"\n`, { mode: 0o700 });
  }
  const cancellation = new AbortController();
  const options = { sourceDirectory, directory: join(root, "prepared tools' tree"),
    env: { PATH: bin, HOME: '/not-the-owned-home', EXPO_TOKEN: 'synthetic-secret-do-not-publish',
      CODEX_HOME: '/do-not-read-auth', AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'synthetic-remote-secret', NODE_OPTIONS: '--invalid' },
    signal: cancellation.signal, timeoutMs: 5000 };
  const log = async (): Promise<Event[]> => {
    try { return (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  try { await inspect({ options, log, bin, root, executable, abort: () => cancellation.abort() }); }
  finally {
    await chmod(root, 0o700);
    const survivors = (await log()).filter((event) => event.tool === 'descendant').filter((event) => {
      try { process.kill(event.pid!, 0); return true; } catch { return false; }
    });
    for (const event of survivors) { try { process.kill(event.pid!, 'SIGKILL'); } catch {} }
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(survivors, [], 'Preparation owns subprocess cleanup.');
  }
}

test('the production install branch freezes an isolated bundle and returns only probed direct commands', async () => {
  await fixture({}, async ({ options, log }) => {
    const prepared = await prepareQaTools(options);
    const calls = await log();
    const installs = calls.filter((event) => event.tool === 'installer');
    assert.equal(installs.length, 1);
    const installed = installs[0]!;
    const directory = await realpath(options.directory);
    assert.equal(installed.cwd, join(directory, 'install'));
    assert.deepEqual(installed.args, ['install', '--frozen-lockfile', '--ignore-scripts', '--omit', 'peer',
      '--backend', 'copyfile', '--cache-dir', join(directory, 'cache'), '--registry', 'https://registry.npmjs.org']);
    assert.equal(installed.env!.HOME, join(directory, 'home'));
    assert.equal(installed.env!.TMPDIR, join(directory, 'tmp'));
    assert.equal(installed.env!.BUN_INSTALL_CACHE_DIR, join(directory, 'cache'));
    for (const call of calls) {
      const keys = call.envKeys ?? Object.keys(call.env ?? {});
      for (const secret of ['EXPO_TOKEN', 'CODEX_HOME', 'AGENT_DEVICE_DAEMON_AUTH_TOKEN', 'NODE_OPTIONS']) assert.ok(!keys.includes(secret));
    }
    assert.deepEqual(calls.filter((event) => event.tool === 'version').map((event) => event.name), ['installer', 'eas', 'server', 'device']);
    for (const name of ['eas', 'codex'] as const) {
      assert.equal(prepared.commands[name].file, await realpath(node));
      assert.ok(prepared.commands[name].args[0]!.startsWith(join(directory, 'install', 'node_modules')));
    }
    assert.deepEqual(prepared.commands.device.args, []);
    assert.equal(prepared.commands.device.file, join(prepared.binDirectory, 'agent-device'));
    for (const name of ['package.json', 'bun.lock']) assert.deepEqual(await readFile(join(directory, 'install', name)),
      await readFile(join(options.sourceDirectory, '.eas/agents/qa-tools', name)));
    const values = ['with spaces', "with'apostrophe", '$(exit 99)', '`exit 99`', '$HOME', '--literal'];
    const prompt = lanePrompt('scores', 'owned-session', 'identity', prepared.commands.device.file);
    const prefix = /^Use only (.+) <command>/m.exec(prompt)?.[1];
    assert.ok(prefix);
    const result = await command({ executable: { file: '/bin/sh', args: [] },
      args: ['-c', `${prefix} literal-args ${values.map(quote).join(' ')}`], cwd: directory,
      env: { PATH: '/nonexistent' }, timeoutMs: 2000 });
    assert.ok(succeeded(result));
    assert.deepEqual(JSON.parse(result.stdout), { args: values });
    const shim = await readFile(prepared.commands.device.file, 'utf8');
    for (const value of ['synthetic-secret', 'owned-session', '/not-the-owned-home', 'bunx', 'npx']) assert.ok(!shim.includes(value));
  });
});

for (const [installMode, stage, tool, reason] of [
  ['wrong-bun', 'runtime', 'bun', 'incompatible-version'], ['fail', 'install', 'bun', 'command-failed'],
  ['no-packages', 'metadata', 'eas', 'io-failed'], ['wrong-pin', 'metadata', 'device', 'invalid-package'],
  ['bad-metadata', 'metadata', 'device', 'io-failed'], ['bad-bin', 'metadata', 'device', 'invalid-bin'],
  ['missing-bin', 'metadata', 'device', 'invalid-bin'], ['bin-directory', 'metadata', 'device', 'invalid-bin'],
  ['missing-bundle', 'probe', 'device', 'command-failed'], ['missing-native', 'probe', 'codex', 'command-failed'],
]) {
  test(`production preparation rejects ${installMode} and deletes the partial installation`, async () => {
    await fixture({ installMode }, async ({ options }) => {
      await assert.rejects(prepareQaTools(options), (error: unknown) => error instanceof QaToolPreparationError &&
        error.stage === stage && error.tool === tool && error.reason === reason && !error.message.includes('synthetic-secret'));
      await assert.rejects(lstat(options.directory));
    });
  });
}

for (const name of ['node', 'bun']) {
  test(`missing ${name} fails before installation`, async () => {
    await fixture({}, async ({ options, bin, log }) => {
      await rm(join(bin, name));
      await assert.rejects(prepareQaTools(options), { stage: 'runtime', tool: name, reason: 'unavailable' });
      assert.ok(!(await log()).some((event) => event.tool === 'installer'));
      await assert.rejects(lstat(options.directory));
    });
  });
}

test('an incompatible Node version fails before installation', async () => {
  await fixture({ runtimeMode: 'old' }, async ({ options, log }) => {
    await assert.rejects(prepareQaTools(options), { stage: 'runtime', tool: 'node', reason: 'incompatible-version' });
    assert.ok(!(await log()).some((event) => event.tool === 'installer'));
  });
});

for (const name of ['package.json', 'bun.lock']) {
  test(`missing protected ${name} fails before installation`, async () => {
    await fixture({}, async ({ options, log }) => {
      await rm(join(options.sourceDirectory, '.eas/agents/qa-tools', name));
      await assert.rejects(prepareQaTools(options), { stage: 'storage', tool: 'bundle', reason: 'io-failed' });
      assert.ok(!(await log()).some((event) => event.tool === 'installer'));
    });
  });
}

test('a drifted protected manifest and an empty lock cannot start an installer', async () => {
  await fixture({}, async ({ options, log }) => {
    const bundle = join(options.sourceDirectory, '.eas/agents/qa-tools');
    const manifest = join(bundle, 'package.json');
    const original = await readFile(manifest);
    await writeFile(manifest, JSON.stringify({ name: 'different-bundle' }));
    await assert.rejects(prepareQaTools(options), { stage: 'storage', tool: 'bundle', reason: 'invalid-bundle' });
    await writeFile(manifest, original);
    await writeFile(join(bundle, 'bun.lock'), '');
    await assert.rejects(prepareQaTools(options), { stage: 'storage', tool: 'bundle', reason: 'invalid-bundle' });
    assert.ok(!(await log()).some((call) => call.tool === 'installer'));
  });
});

for (const tool of ['eas', 'server', 'device']) {
  test(`injected ${tool} commands also require the exact working version`, async () => {
    await fixture({ versionTool: tool }, async ({ options, executable, log }) => {
      await assert.rejects(prepareQaTools({ ...options,
        commands: { eas: executable('eas'), codex: executable('server'), device: executable('device') } }),
      { stage: 'probe', tool: tool === 'server' ? 'codex' : tool, reason: 'version-mismatch' });
      assert.ok(!(await log()).some((event) => event.tool === 'installer'));
    });
  });
}

for (const name of ['eas', 'codex', 'device'] as const) {
  test(`an injected unavailable ${name} executable still fails readiness`, async () => {
    await fixture({}, async ({ options, executable }) => {
      const commands = { eas: executable('eas'), codex: executable('server'), device: executable('device') };
      commands[name] = { file: join(options.directory, 'missing-cli'), args: [] };
      await assert.rejects(prepareQaTools({ ...options, commands }),
        { stage: 'probe', tool: name, reason: name === 'device' ? 'command-failed' : 'unavailable' });
      await assert.rejects(lstat(options.directory));
    });
  });
}

test('a nonzero version process cannot publish ready commands', async () => {
  await fixture({ versionTool: 'device', versionMode: 'fail' }, async ({ options }) => {
    await assert.rejects(prepareQaTools(options), { stage: 'probe', tool: 'device', reason: 'command-failed' });
  });
});

test('pre-cancelled and expired preparations leave no directory or child process', async () => {
  await fixture({}, async ({ options, abort, log }) => {
    await assert.rejects(prepareQaTools({ ...options, timeoutMs: 0 }), { reason: 'deadline' });
    abort();
    await assert.rejects(prepareQaTools(options), { reason: 'cancelled' });
    assert.deepEqual(await log(), []);
    await assert.rejects(lstat(options.directory));
  });
});

test('preparation refuses to take ownership of an existing tree', async () => {
  await fixture({}, async ({ options }) => {
    await mkdir(options.directory);
    const marker = join(options.directory, 'existing');
    await writeFile(marker, 'keep');
    await assert.rejects(prepareQaTools(options), { stage: 'storage', reason: 'io-failed' });
    assert.equal(await readFile(marker, 'utf8'), 'keep');
  });
});

for (const cancel of [false, true]) {
  test(`${cancel ? 'cancellation' : 'deadline'} stops a non-exiting installer and removes owned storage`, { timeout: 6000 }, async () => {
    await fixture({ installMode: 'hang' }, async ({ options, log, abort }) => {
      const timer = cancel ? setInterval(() => { void log().then((calls) => {
        if (calls.some((call) => call.tool === 'descendant')) abort();
      }); }, 10) : undefined;
      try {
        await assert.rejects(prepareQaTools({ ...options, timeoutMs: cancel ? 5000 : 600 }),
          { stage: 'install', tool: 'bun', reason: cancel ? 'cancelled' : 'deadline' });
        assert.equal((await log()).filter((call) => call.tool === 'descendant').length, 1);
        await assert.rejects(lstat(options.directory));
      } finally { clearInterval(timer); }
    });
  });
}

test('installation and all version probes share one preparation deadline', async () => {
  await fixture({ installMode: 'delay', versionDelayMs: 500 }, async ({ options, log }) => {
    await assert.rejects(prepareQaTools({ ...options, timeoutMs: 1200 }), { reason: 'deadline' });
    assert.ok((await log()).some((call) => call.tool === 'installer'));
    await assert.rejects(lstat(options.directory));
  });
});

test('the QA Codex pin agrees with the unchanged shared command', () => {
  assert.deepEqual(codexCommand, { file: 'bunx', args: [`@openai/codex@${qaToolPins.codex}`] });
});

async function preparationFailure(options: Parameters<typeof prepareQaTools>[0]) {
  try { await prepareQaTools(options); }
  catch (error) { assert.ok(error instanceof QaToolPreparationError); return error; }
  assert.fail('Preparation must fail.');
}

for (const [versionMode, reason, exitCode, signal, matches] of [
  ['nonzero-version', 'command-failed', 9, null, true], ['signal', 'command-failed', null, 'SIGTERM', false],
  ['mismatch', 'version-mismatch', 0, null, false],
] as const) {
  test(`preparation diagnostics distinguish ${versionMode} without changing readiness`, async () => {
    await fixture({ versionTool: 'eas', versionMode }, async ({ options, log }) => {
      const error = await preparationFailure(options);
      assert.equal(error.reason, reason);
      const diagnostic = error.diagnostics!;
      assert.equal(diagnostic.nodeVersion, execFileSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' }).trim());
      assert.equal(diagnostic.packageChecks, 'validated');
      assert.equal(diagnostic.storageCleanup, 'removed');
      assert.equal(diagnostic.command?.stage, 'probe');
      assert.equal(diagnostic.command?.tool, 'eas');
      assert.equal(diagnostic.command?.trigger, 'exit');
      assert.equal(diagnostic.command?.exitCode, exitCode);
      assert.equal(diagnostic.command?.signal, signal);
      assert.equal(diagnostic.command?.versionOutputMatches, matches);
      assert.equal(diagnostic.command?.cleanup.confirmed, true);
      assert.ok(diagnostic.command!.elapsedMs >= 0 && diagnostic.command!.elapsedMs < 5000);
      assert.deepEqual((await log()).filter((event) => event.tool === 'version').map((event) => event.name), ['installer', 'eas']);
      await assert.rejects(lstat(options.directory));
    });
  });
}

test('a real Node loader failure identifies the trusted missing dependency and launcher', async () => {
  await fixture({ installMode: 'missing-semver' }, async ({ options }) => {
    const error = await preparationFailure(options);
    assert.equal(error.reason, 'command-failed');
    assert.equal(error.diagnostics?.command?.exitCode, 1);
    assert.deepEqual(error.diagnostics?.command?.stderr, { present: true, truncated: false,
      code: 'MODULE_NOT_FOUND', type: null, dependency: 'semver', target: 'locked-package', cause: 'MODULE_NOT_FOUND', origin: 'eas-launcher' });
  });
});

for (const [stderr, cause, dependency, target, truncated] of [
  ["Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@oclif/core' imported from /private/synthetic-secret?token=signed-url", 'ERR_MODULE_NOT_FOUND', '@oclif/core', 'locked-package', false],
  ["Error: Cannot find module 'semver/private-secret'\ncode: 'MODULE_NOT_FOUND'", 'MODULE_NOT_FOUND', 'semver', 'locked-package-subpath', false],
  ["Error: Cannot find module 'synthetic-secret'\ncode: 'MODULE_NOT_FOUND'", 'MODULE_NOT_FOUND', null, 'unrecognized-specifier', false],
  ["Error: Cannot find module '/private/synthetic-secret'\ncode: 'MODULE_NOT_FOUND'", 'MODULE_NOT_FOUND', null, 'absolute-file', false],
  ["Error: Cannot find module './synthetic-secret'\ncode: 'MODULE_NOT_FOUND'", 'MODULE_NOT_FOUND', null, 'relative-file', false],
  ["Error: EACCES: permission denied, open '/private/synthetic-secret'", 'EACCES', null, null, false],
  ["TypeError: synthetic-secret with https://example.invalid/?token=signed-url", 'TypeError', null, null, false],
  ["code: 'SYNTHETIC_SECRET'\nEXPO_TOKEN=synthetic-secret\nAuthorization: Bearer private-token", 'unclassified', null, null, false],
  ['synthetic-secret'.repeat(3000) + "\ncode: 'MODULE_NOT_FOUND'", 'unclassified', null, null, true],
] as const) {
  test(`stderr diagnostics classify ${cause}/${target}/${truncated} without echoing private text`, async () => {
    await fixture({ versionTool: 'eas', versionMode: 'stderr', versionStderr: stderr, versionStdout: 'synthetic-stdout-secret' }, async ({ options, root }) => {
      const error = await preparationFailure(options);
      assert.equal(error.diagnostics?.command?.stderr.cause, cause);
      assert.equal(error.diagnostics?.command?.stderr.dependency, dependency);
      assert.equal(error.diagnostics?.command?.stderr.target, target);
      assert.equal(error.diagnostics?.command?.stderr.truncated, truncated);
      const text = JSON.stringify(error);
      assert.ok(text.length < 2000);
      for (const secret of ['synthetic-secret', 'synthetic-stdout-secret', 'private-secret', 'signed-url', 'private-token', 'SYNTHETIC_SECRET', root, 'EXPO_TOKEN', 'Authorization']) assert.ok(!text.includes(secret), secret);
    });
  });
}

test('storage cleanup failure retains the original child failure and distinct cleanup health', async () => {
  await fixture({ versionTool: 'eas', versionMode: 'cleanup-fail' }, async ({ options }) => {
    const error = await preparationFailure(options);
    assert.equal(error.stage, 'probe');
    assert.equal(error.tool, 'eas');
    assert.equal(error.reason, 'command-failed');
    assert.equal(error.diagnostics?.command?.exitCode, 9);
    assert.equal(error.diagnostics?.command?.cleanup.confirmed, true);
    assert.equal(error.diagnostics?.storageCleanup, 'failed');
    assert.ok(await lstat(options.directory));
  });
});
