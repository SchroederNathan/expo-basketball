import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { execFile, spawn, spawnSync } from 'node:child_process';

const [configuration, tool, ...args] = process.argv.slice(2);
const c = JSON.parse(readFileSync(configuration, 'utf8'));
const log = (value) => appendFileSync(c.log, `${JSON.stringify(value)}\n`);
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const lane = basename(process.cwd());
const affected = lane === 'scores';
const value = (flag) => args[args.indexOf(flag) + 1];
const identity = `Lob demo prizepicks-v1 source=${c.sha} fixture=${c.fixtureDigest} runtime=${c.runtime} bundle=${c.mode === 'wrong-bundle' && affected ? 'ota' : 'embedded'}`;

if (tool === 'runtime') {
  log({ tool, args, envKeys: Object.keys(process.env) });
  if (c.runtimeMode === 'hang') {
    log({ tool: 'descendant', pid: process.pid });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  process.stdout.write(JSON.stringify({ file: process.execPath, version: c.runtimeMode === 'old' ? '22.11.0' : process.versions.node }));
  process.exit(0);
}
if (args[0] === '--version') {
  log({ tool: 'version', name: tool, cwd: process.cwd(), envKeys: Object.keys(process.env), home: process.env.HOME });
  if (tool === 'installer') { process.stdout.write(c.installMode === 'wrong-bun' ? '1.3.0\n' : '1.2.22\n'); process.exit(0); }
  if (c.versionDelayMs) await new Promise((done) => setTimeout(done, c.versionDelayMs));
  const versions = { eas: `eas-cli/25.3.0 ${process.platform}-${process.arch} node-${process.version}`, server: 'codex-cli 0.165.0', device: '0.21.33' };
  if (c.versionTool === tool && c.versionMode === 'hang') {
    log({ tool: 'descendant', pid: process.pid });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (c.versionTool === tool && c.versionMode === 'fail') { process.stderr.write('synthetic-secret-do-not-publish'); process.exit(9); }
  if (c.versionTool === tool && c.versionMode === 'stderr') { process.stdout.write(c.versionStdout ?? ''); process.stderr.write(c.versionStderr); process.exit(9); }
  if (c.versionTool === tool && c.versionMode === 'signal') process.kill(process.pid, 'SIGTERM');
  if (c.versionTool === tool && c.versionMode === 'cleanup-fail') { chmodSync(c.root, 0o500); process.exit(9); }
  if (c.versionTool === tool && c.versionMode === 'nonzero-version') { process.stdout.write(`${versions[tool]}\n`); process.exit(9); }
  if (c.versionTool === tool || (c.mode === 'bad-version' && tool === 'device')) process.stdout.write('0.0.0\n');
  else process.stdout.write(`${versions[tool]}\n`);
  process.exit(0);
}
if (tool === 'installer') {
  log({ tool, args, cwd: process.cwd(), env: process.env });
  if (c.installMode === 'hang') {
    log({ tool: 'descendant', pid: process.pid });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (c.installMode === 'fail') { process.stderr.write('synthetic-secret-do-not-publish'); process.exit(8); }
  if (c.installMode === 'delay') await new Promise((done) => setTimeout(done, 250));
  if (c.installMode === 'no-packages') process.exit(0);
  const dependencies = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;
  const packages = [ ['eas-cli', 'eas', 'bin/run', 'eas'], ['@openai/codex', 'codex', 'bin/codex.js', 'server'],
    ['agent-device', 'agent-device', 'bin/agent-device.mjs', 'device'] ];
  for (const [name, bin, entry, fixtureTool] of packages) {
    const directory = join(process.cwd(), 'node_modules', name);
    mkdirSync(join(directory, 'bin'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, type: 'module',
      version: c.installMode === 'wrong-pin' && fixtureTool === 'device' ? '0.0.0' : dependencies[name],
      bin: { [bin]: c.installMode === 'bad-bin' && fixtureTool === 'device' ? '../escape.mjs' : entry } }));
    if (c.installMode === 'missing-bin' && fixtureTool === 'device') continue;
    if (c.installMode === 'bin-directory' && fixtureTool === 'device') { mkdirSync(join(directory, entry)); continue; }
    if (c.installMode === 'bad-metadata' && fixtureTool === 'device') writeFileSync(join(directory, 'package.json'), 'not json');
    const source = c.installMode === 'missing-semver' && fixtureTool === 'eas' ? `import { createRequire } from 'node:module'; createRequire(import.meta.url)('semver');`
      : c.installMode === 'missing-bundle' && fixtureTool === 'device' ? `import './missing-bundle.mjs';`
      : c.installMode === 'missing-native' && fixtureTool === 'server' ? `import './missing-native.mjs';`
      : `process.env.QA_FIXTURE_ENTRY = process.argv[1]; process.argv = [process.execPath, ${JSON.stringify(import.meta.filename)}, ${JSON.stringify(configuration)}, ${JSON.stringify(fixtureTool)}, ...process.argv.slice(2)]; await import(${JSON.stringify(import.meta.url)});`;
    writeFileSync(join(directory, entry), source);
  }
  process.exit(0);
}
if (tool === 'device' && args[0] === 'help') {
  if (c.mode === 'package-manager-after-ready') spawnSync('bunx', ['should-never-resolve']);
  process.stdout.write('agent-device workflow help\n'); process.exit(0);
}
if (tool === 'device' && args[0] === 'literal-args') { out({ args: args.slice(1) }); process.exit(0); }

if (tool === 'server') {
  log({ tool, pid: process.pid, entry: process.env.QA_FIXTURE_ENTRY, envKeys: Object.keys(process.env), codexHome: process.env.CODEX_HOME });
  if (c.mode === 'server-exit') process.exit(3);
  if (c.mode.includes('detached')) {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true, stdio: c.mode.includes('pipe') ? ['ignore', process.stdout, process.stderr] : 'ignore',
    });
    descendant.unref();
    log({ tool: 'descendant', pid: descendant.pid });
  }
  const threads = new Map();
  let count = 0;
  let refreshed = false;
  const lines = createInterface({ input: process.stdin });
  const send = (value) => {
    const line = `${JSON.stringify(value)}\n`;
    if (c.mode === 'fragmented') {
      process.stdout.write(line.slice(0, 9));
      process.stdout.write(line.slice(9));
    } else process.stdout.write(line);
  };
  const event = (method, params) => send({ method, params });
  const response = (id, result) => send({ id, result });
  const complete = (thread, status, text) => {
    event('item/completed', { threadId: thread.id, turnId: thread.turnId, completedAtMs: Date.now(),
      item: { type: 'agentMessage', id: `answer-${thread.id}`, phase: 'final_answer', text } });
    event('turn/completed', { threadId: thread.id, turn: { id: thread.turnId, status, items: [] } });
  };
  lines.on('line', async (line) => {
    const request = JSON.parse(line);
    const p = request.params;
    log({ tool: 'rpc', method: request.method, id: request.id, params: p });
    if (request.method === 'initialize') {
      if (c.mode === 'request-timeout') return;
      response(request.id, { userAgent: 'fake' });
    } else if (request.method === 'thread/start') {
      const n = ++count;
      const id = c.mode === 'duplicate-thread' ? 'thread-1' : `thread-${n}`;
      const thread = { id, n, cwd: p.cwd, env: p.config.shell_environment_policy.set };
      threads.set(id, thread);
      const reply = () => response(request.id, { thread: { id }, cwd: p.cwd, model: 'gpt-6.1-sol', modelProvider: 'openai',
        serviceTier: 'priority', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
      setTimeout(reply, 15 * (4 - n));
    } else if (request.method === 'turn/start') {
      const thread = threads.get(p.threadId);
      thread.turnId = `turn-${thread.n}`;
      const broken = thread.env.QA_LANE_MARKER ? thread.env.QA_LANE_MARKER === 'alpha' : thread.n === 1;
      const turn = { id: thread.turnId, status: 'inProgress', items: [] };
      if (c.mode !== 'missing-start' || !broken) event('turn/started', { threadId: thread.id, turn });
      if (c.mode !== 'early-notifications') response(request.id, { turn });
      if (!refreshed && process.env.CODEX_HOME && existsSync(join(process.env.CODEX_HOME, 'auth.json'))) {
        const path = join(process.env.CODEX_HOME, 'auth.json');
        const auth = JSON.parse(readFileSync(path, 'utf8'));
        auth.tokens.refresh_token = 'synthetic-refreshed-token';
        writeFileSync(path, JSON.stringify(auth));
        refreshed = true;
      }
      event('item/completed', { threadId: thread.id, turnId: thread.turnId, completedAtMs: Date.now(),
        item: { type: 'commandExecution', id: `command-${thread.id}`, aggregatedOutput: 'synthetic-secret-do-not-publish' } });
      event('item/completed', { threadId: thread.id, turnId: thread.turnId, completedAtMs: Date.now(),
        item: { type: 'agentMessage', id: `comment-${thread.id}`, phase: 'commentary', text: 'synthetic-secret-do-not-publish' } });
      if (['interactive', 'detached-fatal', 'detached-pipe-fatal'].includes(c.mode) && broken) { send({ id: 600, method: 'item/tool/requestUserInput', params: { threadId: thread.id } }); return; }
      if (c.mode === 'mismatched-turn' && broken) { event('turn/completed', { threadId: thread.id, turn: { ...turn, id: 'wrong', status: 'completed' } }); return; }
      if (c.mode === 'exit-mid-turn' && broken) { setTimeout(() => process.exit(5), 30); return; }
      if (['timeout', 'missing-turn', 'cancel'].includes(c.mode) && broken) {
        if (c.mode === 'missing-turn') event('item/completed', { threadId: thread.id, turnId: thread.turnId, completedAtMs: Date.now(),
          item: { type: 'agentMessage', id: `premature-${thread.id}`, phase: 'final_answer', text: JSON.stringify({ state: 'PASS' }) } });
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        log({ tool: 'descendant', pid: descendant.pid });
        return;
      }
      const finish = async () => {
        if (c.mode.startsWith('probe')) {
          execFile(process.execPath, ['probe.mjs'], { cwd: thread.cwd, env: { ...thread.env, CODEX_THREAD_ID: thread.id } }, (error, stdout) => {
            complete(thread, error ? 'failed' : 'completed', stdout);
          });
          return;
        }
        const laneId = basename(thread.cwd);
        if (thread.env.AGENT_EVIDENCE_DIR && !(c.mode === 'missing-screenshot' && broken)) {
          const prompt = p.input[0].text;
          const prefix = /^Use only (.+) <command> --platform ios --session ([\w-]+)\.$/m.exec(prompt);
          const help = /^Read (.+) help workflow if syntax is unclear\./m.exec(prompt);
          if (!prefix || !help) { complete(thread, 'failed', 'Prepared command missing.'); return; }
          const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
          const invocation = `${help[1]} help workflow && ${prefix[1]} screenshot ${quote(join(thread.env.AGENT_EVIDENCE_DIR, `${laneId}.png`))} --platform ios --session ${quote(prefix[2])} --json`;
          const env = c.mode === 'reduced-path' ? { ...thread.env, PATH: '/nonexistent' } : thread.env;
          log({ tool: 'model-shell', prefix: prefix[1], cwd: thread.cwd, env, session: prefix[2] });
          const ok = await new Promise((done) => execFile('/bin/sh', ['-c', invocation], { cwd: thread.cwd, env }, (error) => done(!error)));
          if (!ok) { complete(thread, 'failed', 'Prepared command failed.'); return; }
        }
        const verdict = thread.env.AGENT_EVIDENCE_DIR
          ? { id: c.mode === 'wrong-lane' && broken ? 'search-back' : laneId,
            state: c.mode === 'observed-fail' && broken ? 'FAIL' : 'PASS', detail: `Observed ${laneId}.`, screenshot: `${laneId}.png` }
          : { marker: thread.env.QA_LANE_MARKER };
        complete(thread, c.mode === 'failed-turn' && broken ? 'failed' : 'completed',
          c.mode === 'malformed' && broken ? 'PASS: claimed success' : JSON.stringify(verdict));
        if (c.mode === 'early-notifications') response(request.id, { turn });
      };
      setTimeout(finish, 100 + (4 - thread.n) * 20);
    } else if (request.method === 'turn/interrupt') {
      const thread = threads.get(p.threadId);
      if (c.mode === 'interrupt-timeout') return;
      response(request.id, {});
      event('turn/completed', { threadId: thread.id, turn: { id: thread.turnId, status: 'interrupted', items: [] } });
    }
  });
  lines.on('close', () => {
    if (c.mode.endsWith('exit-7')) process.exit(7);
    if (c.mode.endsWith('signal')) { process.kill(process.pid, 'SIGTERM'); return; }
    if (c.mode === 'ignore-eof') { setInterval(() => {}, 1000); return; }
    process.exit(0);
  });
} else if (tool === 'eas') {
  log({ tool, args, lane, entry: process.env.QA_FIXTURE_ENTRY });
  if (args[0] === 'env:update') {
    const text = readFileSync(value('--value'), 'utf8');
    if (c.mode === 'auth-preflight-failed' || (c.mode === 'auth-final-failed' && text.includes('refreshed'))) process.exit(1);
    copyFileSync(value('--value'), join(c.root, 'persisted.json'));
    out({ ok: true });
  } else if (args[0] === 'build:view') {
    out({ id: args[1], status: 'FINISHED', platform: 'IOS', buildProfile: 'agent-preview', isForIosSimulator: true,
      appIdentifier: 'dev.expo.basketball', gitCommitHash: c.mode === 'wrong-build' ? 'b'.repeat(40) : args[1] === c.nativeBuild ? 'c'.repeat(40) : c.sha,
      fingerprint: { hash: 'a'.repeat(40) }, runtime: { version: c.runtime } });
  } else if (args[0] === 'simulator:start') {
    const session = { id: c.mode === 'duplicate-session' ? c.installedBuild : randomUUID(), name: value('--name'), tags: [value('--tag')] };
    writeFileSync(join(process.cwd(), 'owned.json'), JSON.stringify(session));
    if (c.mode === 'partial-start' && affected) await new Promise((done) => setTimeout(done, 30_000));
    out({ id: session.id, deviceRunSessionUrl: `https://expo.dev/accounts/demo/projects/lob/simulator-sessions/${session.id}`,
      remoteConfig: { agentDeviceRemoteSessionUrl: `https://${lane}.example.invalid`, agentDeviceRemoteSessionToken: `synthetic-device-token-${lane}` } });
  } else if (args[0] === 'simulator:list') {
    out({ sessions: [JSON.parse(readFileSync(join(process.cwd(), 'owned.json'), 'utf8'))] });
  } else if (args[0] === 'simulator:stop' || args[0] === 'simulator:get') {
    out({ id: value('--id'), status: c.mode === 'cleanup-failed' && affected ? 'IN_PROGRESS' : 'STOPPED' });
  } else process.exit(3);
} else if (tool === 'device') {
  log({ tool, args, lane, entry: process.env.QA_FIXTURE_ENTRY ?? process.argv[1], home: process.env.HOME, state: process.env.AGENT_DEVICE_STATE_DIR, remote: process.env.AGENT_DEVICE_DAEMON_BASE_URL, token: process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN });
  if (process.env.AGENT_DEVICE_DAEMON_BASE_URL !== `https://${lane}.example.invalid` ||
    process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN !== `synthetic-device-token-${lane}`) process.exit(4);
  if (c.mode.startsWith('device-open-failed') && affected && args[0] === 'open') {
    if (c.mode === 'device-open-failed-json') out({ ok: false, error: { code: 'REMOTE_UNAVAILABLE',
      message: `Connection failed with synthetic-device-token-${lane} at https://example.invalid/device?token=private` } });
    else if (c.mode.endsWith('stderr')) process.stderr.write(`error: Tool resolution failed for synthetic-device-token-${lane} at https://example.invalid/device?token=private`);
    else process.stdout.write('Tool resolution failed.');
    process.exit(9);
  }
  if (args[0] === 'wait') {
    if (JSON.parse(args[1].slice('label='.length)) !== identity) process.exit(5);
  } else if (args[0] === 'record' && args[1] === 'start') {
    writeFileSync(join(process.cwd(), 'recording-path'), args[2]);
  } else if (args[0] === 'record' && args[1] === 'stop' && !(c.mode === 'missing-recording' && affected)) {
    copyFileSync(join(c.mediaDirectory, 'clip.mp4'), readFileSync(join(process.cwd(), 'recording-path'), 'utf8'));
  } else if (args[0] === 'screenshot') copyFileSync(join(c.mediaDirectory, 'screen.png'), args[1]);
  out(args[0] === 'snapshot' ? { label: identity, text: 'Orbits 100 Comets 108 Final' } : { ok: true });
}
