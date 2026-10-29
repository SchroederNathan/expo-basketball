import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { subscriptionConfig, validateSubscription } from './auth';
import { publishTriage } from './github';
import { demoIssueMarker, acceptanceMarker, acceptanceSchema, issueDigest } from './issue';
import { executeCheck, type CheckOptions } from './run';
import { getConfig } from '@expo/config';
import { writeSimulatorProject } from './simulator';
import { admitFile, digest, resultSchema, targetSchema, verdictSchema } from './result';
import { command, succeeded } from './process';

let mediaDirectory = '';
before(async () => {
  mediaDirectory = await mkdtemp(join(tmpdir(), 'lob-test-media-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=200x300:d=1.2', '-c:v', 'mpeg4', join(mediaDirectory, 'clip.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(mediaDirectory, 'clip.mp4'), '-frames:v', '1', join(mediaDirectory, 'screen.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=200x300:d=2', '-c:v', 'mpeg4', '-movflags', '+faststart', join(mediaDirectory, 'faststart.mp4')]);
});
after(async () => { await rm(mediaDirectory, { recursive: true, force: true }); });

const commandNode = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const commandEnvironment = { PATH: process.env.PATH };
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

for (const seconds of [0.05, 5]) {
  test(`command observes original group after launcher exit with a ${seconds}s helper`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lob-command-first-snapshot-'));
    const pidFile = join(directory, 'pids');
    const snapshotFile = join(directory, 'first-snapshot');
    const unrelated = spawn(commandNode, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: commandEnvironment });
    const unrelatedClosed = new Promise<void>((done) => unrelated.once('close', () => done()));
    let launcher: number | undefined;
    let helper: number | undefined;
    try {
      const result = await bounded(command({ executable: { file: '/bin/sh', args: [] },
        args: ['-c', `/bin/sleep ${seconds} >/dev/null 2>&1 & printf '%s %s' "$$" "$!" > "$1"`, 'owned-command', pidFile],
        cwd: directory, env: commandEnvironment, timeoutMs: 4000,
        processObserver: { file: '/bin/sh', args: ['-c', '/bin/sleep 0.015; file=$1; shift; if [ ! -f "$file" ]; then /bin/ps "$@" > "$file"; /bin/cat "$file"; else exec /bin/ps "$@"; fi', 'delayed-observer', snapshotFile] },
      }), 4500);
      [launcher, helper] = (await readFile(pidFile, 'utf8')).split(' ').map(Number);
      assert.ok(launcher && helper);
      const firstSnapshot = await readFile(snapshotFile, 'utf8');
      assert.ok(!new RegExp(`^\\s*${launcher}\\s`, 'm').test(firstSnapshot), 'The first real snapshot must miss the launcher.');
      assert.ok(new RegExp(`^\\s*${helper}\\s+\\d+\\s+${launcher}\\s`, 'm').test(firstSnapshot), 'The first real snapshot must observe the original group helper.');
      assert.equal(succeeded(result), seconds === 0.05, JSON.stringify(result.termination));
      const remaining = commandProcess(helper);
      assert.ok(remaining === null || remaining.group !== launcher || remaining.state.startsWith('Z'), 'Observed helper must terminate before command settles.');
      assert.ok(unrelated.pid && commandProcess(unrelated.pid), 'Unrelated process must remain alive.');
    } finally {
      if (!launcher || !helper) {
        try { [launcher, helper] = (await readFile(pidFile, 'utf8')).split(' ').map(Number); } catch {}
      }
      if (launcher && helper && commandProcess(helper)?.group === launcher) { try { process.kill(helper, 'SIGKILL'); } catch {} }
      unrelated.kill('SIGKILL');
      await unrelatedClosed;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Command did not settle within ${ms} ms.`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function commandProcess(pid: number): { group: number; state: string; args: string } | null {
  try {
    const row = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid=,stat=,args='], { encoding: 'utf8', timeout: 1000 });
    const match = /^\s*(\d+)\s+(\S+)\s+(.+)\s*$/.exec(row);
    assert.ok(match, 'Process inspection must return a valid row.');
    return { group: Number(match[1]), state: match[2]!, args: match[3]! };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1 && failure.stdout?.trim() === '') return null;
    throw error;
  }
}

async function commandDescendants(mode: 'timeout' | 'abort' | 'natural', pipes: boolean, nested = false, denySignals = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lob-command-test-'));
  const fixture = join(directory, 'owned.mjs');
  const pidFile = join(directory, 'pids');
  const ready = join(directory, 'ready');
  await writeFile(fixture, `
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const role = process.argv[2];
appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n');
if (role === 'launcher' || (${nested} && role === 'descendant')) {
  const child = spawn(process.execPath, [${JSON.stringify(fixture)}, role === 'launcher' ? 'descendant' : 'grandchild'], {
    detached: true, stdio: ${pipes ? "['ignore', 1, 2]" : "'ignore'"}
  });
  child.unref();
}
if (role === ${JSON.stringify(nested ? 'grandchild' : 'descendant')}) writeFileSync(${JSON.stringify(ready)}, 'ready');
if (role === 'launcher' && ${JSON.stringify(mode)} === 'natural') setTimeout(() => { console.log('launcher-done'); process.exit(0); }, 180);
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 5000);
`);
  const unrelated = spawn(commandNode, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: commandEnvironment });
  const unrelatedClosed = new Promise<void>((done) => unrelated.once('close', () => done()));
  const controller = new AbortController();
  const originalKill = process.kill;
  if (denySignals) process.kill = () => { throw Object.assign(new Error('Synthetic permission denial.'), { code: 'EPERM' }); };
  const started = performance.now();
  const invocation = command({ executable: { file: commandNode, args: [] }, args: [fixture, 'launcher'],
    cwd: directory, env: commandEnvironment, signal: controller.signal, timeoutMs: mode === 'timeout' ? 250 : 5000 });
  const lateAbort = mode === 'timeout' && denySignals ? setTimeout(() => controller.abort(), 350) : undefined;
  let pids: number[] = [];
  try {
    if (mode === 'abort') {
      await bounded((async () => {
        const deadline = performance.now() + 900;
        while (performance.now() < deadline) {
          try { await readFile(ready); return; } catch { await delay(10); }
        }
        throw new Error('Descendants never became ready.');
      })(), 1000);
      controller.abort();
    }
    const result = await bounded(invocation, 4000);
    const elapsed = performance.now() - started;
    pids = (await readFile(pidFile, 'utf8')).trim().split('\n').map(Number);
    assert.equal(pids.length, nested ? 3 : 2, 'the fixture must create every descendant');
    assert.equal(succeeded(result), false);
    assert.equal(result.termination.kind, mode === 'timeout' ? 'timeout' : 'signal');
    if (denySignals) {
      assert.ok(result.termination.reason.includes('cleanup was not confirmed'));
      assert.ok(pids.some((pid) => commandProcess(pid)?.state.startsWith('S')), 'the denied signal must leave a live descendant for fixture cleanup');
    }
    if (mode === 'natural') assert.equal(result.stdout, 'launcher-done\n');
    assert.ok(elapsed < 4000, `cleanup took ${elapsed} ms`);
    for (const pid of denySignals ? [] : pids) {
      const observed = commandProcess(pid);
      assert.ok(observed === null || !observed.args.includes(fixture) || observed.state.startsWith('Z'), `owned process ${pid} survived command()`);
    }
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.ok(unrelated.pid && commandProcess(unrelated.pid), 'unrelated process must survive cleanup');
  } finally {
    clearTimeout(lateAbort);
    process.kill = originalKill;
    controller.abort();
    try { pids = (await readFile(pidFile, 'utf8')).trim().split('\n').map(Number); } catch {}
    for (const pid of pids.reverse()) {
      const observed = commandProcess(pid);
      if (observed?.args.includes(fixture)) {
        try { process.kill(observed.group === pid ? -pid : pid, 'SIGKILL'); } catch {}
      }
    }
    unrelated.kill('SIGKILL');
    await bounded(unrelatedClosed, 1000);
    await bounded(invocation, 4000);
    await bounded((async () => {
      const deadline = performance.now() + 900;
      while (performance.now() < deadline) {
        if (pids.every((pid) => { const row = commandProcess(pid); return row === null || !row.args.includes(fixture) || row.state.startsWith('Z'); })) return;
        await delay(10);
      }
      throw new Error('Fixture processes survived cleanup.');
    })(), 1000);
    await rm(directory, { recursive: true, force: true });
  }
}

test('command timeout drains retained pipes and stops a detached descendant', async () => {
  await commandDescendants('timeout', true);
});

test('command cancellation stops detached descendant groups and preserves cancellation', async () => {
  await commandDescendants('abort', true, true);
});

test('command unconfirmed cleanup returns within its drain bound and cannot succeed', async () => {
  await commandDescendants('natural', true, false, true);
});

test('command retains the first timeout when cancellation arrives during unconfirmed cleanup', async () => {
  await commandDescendants('timeout', true, false, true);
});

for (const pipes of [true, false]) {
  test(`command natural exit cleans detached descendants with ${pipes ? 'retained' : 'ignored'} stdio and cannot succeed`, async () => {
    await commandDescendants('natural', pipes);
  });
}

test('command preserves stdin, arguments, cwd, environment, output, and ordinary exit codes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lob-command-normal-'));
  try {
    for (const code of [0, 7]) {
      const result = await command({ executable: { file: commandNode, args: ['-e'] }, args: [
        `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => { console.log(JSON.stringify({ input, args: process.argv.slice(1), cwd: process.cwd(), value: process.env.COMMAND_VALUE })); process.stderr.write('ordinary stderr'); process.exitCode = ${code}; });`,
        'argument with spaces',
      ], cwd: directory, env: { ...commandEnvironment, COMMAND_VALUE: 'synthetic' }, timeoutMs: 2000, input: 'hello\n世界' });
      assert.deepEqual(result.termination, { kind: 'exited', code });
      assert.equal(succeeded(result), code === 0);
      assert.deepEqual(JSON.parse(result.stdout), { input: 'hello\n世界', args: ['argument with spaces'], cwd: await realpath(directory), value: 'synthetic' });
      assert.equal(result.stderr, 'ordinary stderr');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('command executable failure settles without becoming a timeout', async () => {
  const result = await bounded(command({ executable: { file: '/nonexistent/lob-command-fixture', args: [] }, args: [],
    cwd: tmpdir(), env: commandEnvironment, timeoutMs: 2000 }), 1000);
  assert.equal(result.termination.kind, 'not-started');
  assert.equal(succeeded(result), false);
});

test('command reports an actual signal exit as unsuccessful', async () => {
  const result = await command({ executable: { file: commandNode, args: [] }, args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
    cwd: tmpdir(), env: commandEnvironment, timeoutMs: 2000 });
  assert.equal(result.termination.kind, 'signal');
  assert.equal(succeeded(result), false);
});

test('command already aborted or expired does not launch the executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lob-command-not-started-'));
  const marker = join(directory, 'started');
  try {
    for (const cancelled of [true, false]) {
      const controller = new AbortController();
      if (cancelled) controller.abort();
      const result = await command({ executable: { file: commandNode, args: [] },
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`],
        cwd: directory, env: commandEnvironment, signal: controller.signal, timeoutMs: cancelled ? 2000 : 0 });
      assert.equal(result.termination.kind, cancelled ? 'signal' : 'timeout');
      assert.equal(succeeded(result), false);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const installedBuild = '00000000-0000-4000-8000-000000000001';
const nativeBuild = '00000000-0000-4000-8000-000000000003';
const sessionId = '00000000-0000-4000-8000-000000000002';
const fakeAuth = {
  auth_mode: 'chatgpt', OPENAI_API_KEY: null,
  tokens: { access_token: 'synthetic-access-token', id_token: 'synthetic-id-token', refresh_token: 'synthetic-refresh-token' },
  last_refresh: '2026-10-26T00:00:00.000Z',
};

test('isolated simulator config resolves without app plugins or installed dependencies', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lob-simulator-config-'));
  try {
    await copyFile(resolve('app.json'), join(directory, 'app.json'));
    await writeFile(join(directory, 'package.json'), '{"name":"lob-device","private":true}');
    assert.throws(() => getConfig(directory, { skipSDKVersionRequirement: true }), /resolve plugin/);
    await writeSimulatorProject(process.cwd(), directory);
    const { exp } = getConfig(directory, { skipSDKVersionRequirement: true });
    const original = JSON.parse(await readFile('app.json', 'utf8')).expo;
    assert.equal(exp.extra?.eas.projectId, original.extra.eas.projectId);
    assert.equal(exp.owner, original.owner);
    assert.equal(exp.slug, original.slug);
    assert.deepEqual(exp.plugins ?? [], []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function scenario(kind: string, inspect: (context: { options: CheckOptions; log: string; root: string; seed: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lob-runner-test-'));
  const cwd = join(root, 'repo');
  await mkdir(join(cwd, 'demo/fixtures'), { recursive: true });
  await mkdir(join(cwd, 'demo/issues'), { recursive: true });
  await mkdir(join(cwd, '.eas/agents'), { recursive: true });
  for (const name of ['demo/fixtures/prizepicks-v1.json', '.eas/agents/check-ios.md', '.eas/agents/issue-ios.md', 'demo/issues/player-label.md', 'app.json', 'package.json']) {
    await copyFile(resolve(name), join(cwd, name));
  }
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'candidate']);
  git(['add', '.']);
  git(['-c', 'user.name=Runner test', '-c', 'user.email=runner@example.invalid', 'commit', '-m', 'Fixture baseline']);
  const sha = git(['rev-parse', 'HEAD']);
  const fixtureDigest = digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json')));
  const log = join(root, 'commands.jsonl');
  const seed = join(root, 'seed.json');
  await writeFile(seed, JSON.stringify(fakeAuth));
  const configuration = { root, kind, sha, fixtureDigest, mediaDirectory, installedBuild, nativeBuild, sessionId, log };
  const fake = join(root, 'fake.mjs');
  await writeFile(fake, `
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const c = ${JSON.stringify(configuration)};
const [tool, ...args] = process.argv.slice(2);
appendFileSync(c.log, JSON.stringify({tool,args})+'\\n');
const out = (value) => process.stdout.write(JSON.stringify(value));
if (tool === 'eas') {
  if (args[0] === 'env:update') {
    if (c.kind === 'auth-write-back-failed' && readFileSync(args[args.indexOf('--value')+1], 'utf8').includes('refreshed')) process.exit(1);
    copyFileSync(args[args.indexOf('--value')+1], join(c.root, 'persisted.json'));
    out({ok:true});
  } else if (args[0] === 'build:view') out({id:args[1],status:'FINISHED',platform:'IOS',buildProfile:'agent-preview',isForIosSimulator:true,appIdentifier:'dev.expo.basketball',gitCommitHash:c.kind === 'build-sha-mismatch' ? 'b'.repeat(40) : args[1] === c.nativeBuild ? 'c'.repeat(40) : c.sha,fingerprint:{hash:'a'.repeat(40)},runtime:{version:'1.0.0'}});
  else if (args[0] === 'simulator:start') {
    writeFileSync(join(c.root,'owned.json'),JSON.stringify({name:args[args.indexOf('--name')+1],tag:args[args.indexOf('--tag')+1]}));
    if (c.kind === 'partial-start') await new Promise(r=>setTimeout(r,30000));
    out({id:c.sessionId,deviceRunSessionUrl:'https://expo.dev/accounts/demo/projects/lob/simulator-sessions/'+c.sessionId,remoteConfig:{agentDeviceRemoteSessionUrl:'https://device.example.invalid',agentDeviceRemoteSessionToken:'synthetic-device-secret'}});
  } else if (args[0] === 'simulator:list') {
    const owned=JSON.parse(readFileSync(join(c.root,'owned.json'),'utf8'));
    out({sessions:[{id:c.sessionId,name:owned.name,tags:[owned.tag]}]});
  } else if (args[0] === 'simulator:stop' || args[0] === 'simulator:get') out({id:c.sessionId,status:c.kind === 'cleanup-unconfirmed' ? 'IN_PROGRESS' : 'STOPPED'});
  else process.exit(3);
} else if (tool === 'device') {
  if (args[0] === 'wait') {
    const label = JSON.parse(args[1].slice('label='.length));
    if (label !== 'Lob demo prizepicks-v1 source='+c.sha+' fixture='+c.fixtureDigest+' runtime=1.0.0 bundle=embedded') process.exit(4);
  }
  if (args[0] === 'record' && args[1] === 'start') writeFileSync(join(c.root,'recording-path'),args[2]);
  else if (args[0] === 'record' && args[1] === 'stop' && c.kind !== 'missing-recording') {
    const destination=readFileSync(join(c.root,'recording-path'),'utf8');
    if(c.kind==='corrupt-recording') {const bytes=readFileSync(join(c.mediaDirectory,'faststart.mp4'));writeFileSync(destination,bytes.subarray(0,Math.floor(bytes.length*0.6)));}
    else copyFileSync(join(c.mediaDirectory,'clip.mp4'),destination);
  }
  else if (args[0] === 'screenshot') copyFileSync(join(c.mediaDirectory,'screen.png'),args[1]);
  if(args[0] === 'snapshot') out({label:'Lob demo prizepicks-v1 source='+c.sha+' fixture='+c.fixtureDigest+' runtime=1.0.0 bundle='+(c.kind==='wrong-bundle'?'ota':'embedded'),text:'Orbits 100 Comets 108 Final'});
  else out({ok:true});
} else if (tool === 'codex') {
  const authPath=join(process.env.CODEX_HOME,'auth.json');
  const auth=JSON.parse(readFileSync(authPath,'utf8')); auth.tokens.refresh_token='refreshed-synthetic-token'; writeFileSync(authPath,JSON.stringify(auth));
  if(c.kind==='timeout') await new Promise(r=>setTimeout(r,30000));
  const checks=((c.kind.startsWith('triage')||c.kind.startsWith('acceptance'))?['historical-points','unknown-stat','current-player','search-back']:['scores','current-player','search-back']).map(id=>({id,state:(c.kind==='observed-fail'&&id==='scores'||(c.kind==='triage-replicated'||c.kind==='acceptance-seeded')&&id==='historical-points')?'FAIL':'PASS',detail:'Observed '+id+' on the device.',screenshot:id+'.png'}));
  for(const check of checks) if(c.kind!=='missing-screenshot'&&c.kind!=='triage-missing-screenshot') copyFileSync(join(c.mediaDirectory,'screen.png'),join(process.env.AGENT_EVIDENCE_DIR,check.screenshot));
  writeFileSync(args[args.indexOf('--output-last-message')+1],c.kind==='malformed-verdict'||c.kind==='triage-malformed-verdict'?'PASS: all good':JSON.stringify({state:c.kind==='observed-fail'||c.kind==='triage-replicated'||c.kind==='acceptance-seeded'?'FAIL':'PASS',checks}));
  if(c.kind==='exit-nonzero') process.exit(1);
  out({done:true});
}
`);
  const issueInput = { id: 123, node_id: 'I_demo', number: 7, state: 'open', title: 'Jordan label', body: demoIssueMarker+' Original Jordan label issue.',
    updated_at: '2026-10-28T00:00:00Z', html_url: 'https://github.com/trusted/lob-demo/issues/7', author_association: 'OWNER' } satisfies Parameters<typeof issueDigest>[0];
  const receipt = acceptanceSchema.parse({ version: 1, repository: 'trusted/lob-demo', target: { ref: 'candidate', sha },
    issue: { number: 7, id: 123, nodeId: 'I_demo', sha256: issueDigest(issueInput) },
    criteriaSha256: digest(await readFile(join(cwd, 'demo/issues/player-label.md'))) });
  const comments: { id: number; body: string; html_url: string; user: { id: number } }[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/user') { response.end(JSON.stringify({ id: 42 })); return; }
    if (request.url?.includes('/comments')) {
      if (request.method === 'POST' || request.method === 'PATCH') {
        let raw = ''; request.on('data', (bytes) => { raw += bytes; });
        request.on('end', () => { const item = { id: 1, body: JSON.parse(raw).body, html_url: 'https://github.com/trusted/lob-demo/issues/7#issuecomment-1', user: { id: 42 } }; if (request.method === 'PATCH') comments[0] = item; else comments.push(item); response.end(JSON.stringify(item)); });
      } else response.end(JSON.stringify(comments));
      return;
    }
    if (request.url?.includes('/issues/')) {
      const number = kind === 'triage-unknown-issue' ? 99 : 7;
      response.end(JSON.stringify({ ...issueInput, number, body: issueInput.body + (kind === 'acceptance-issue-edited' ? ' changed' : '') })); return;
    }
    const repository = { full_name: 'trusted/lob-demo', private: kind !== 'public-repo' };
    const payload = request.url?.includes('/branches/') ? { name: 'candidate', commit: { sha } }
      : request.url?.includes('/pulls/') ? { body: kind.startsWith('acceptance') ? acceptanceMarker(receipt) : '', state: 'open', draft: false, author_association: 'OWNER',
        head: { sha: kind === 'pr-head-mismatch' ? 'b'.repeat(40) : sha, ref: 'candidate', repo: kind === 'fork-pr' ? { ...repository, full_name: 'fork/lob-demo' } : repository },
        base: { sha: kind === 'target-without-baseline' ? 'b'.repeat(40) : sha, ref: 'candidate', repo: repository } }
      : repository;
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const executable = (tool: string) => ({ file: process.execPath, args: [fake, tool] });
  const options: CheckOptions = {
    cwd, outputRoot: join(root, 'output'), signal: new AbortController().signal,
    env: { PATH: process.env.PATH, HOME: root, CODEX_AUTH_JSON: seed, EXPO_TOKEN: 'synthetic-expo-token', AGENT_AUTH_WRITE_TOKEN: 'synthetic-write-token',
      AGENT_TRUSTED_AUTOMATION: 'enabled', AGENT_TRUSTED_REPOSITORY: 'trusted/lob-demo', AGENT_GITHUB_READ_TOKEN: 'synthetic-read-token',
      AGENT_REPOSITORY: 'trusted/lob-demo', AGENT_SOURCE_REF: 'candidate', AGENT_SOURCE_SHA: sha,
      AGENT_WORKFLOW_BASELINE_SHA: sha, AGENT_BUILD_ID: installedBuild, AGENT_FINGERPRINT: 'a'.repeat(40) },
    githubApiBase: `http://127.0.0.1:${address.port}`,
    executables: { eas: executable('eas'), device: executable('device'), codex: executable('codex'),
      ffprobe: { file: 'ffprobe', args: [] }, ffmpeg: { file: 'ffmpeg', args: [] } },
    limits: { startupMs: 300, agentMs: 300, cleanupMs: 2000, deviceMs: 2000, authMs: 2000 },
  };
  try { await inspect({ options, log, root, seed }); }
  finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
}

test('subscription config accepts only managed file auth and forbids API/provider fallback', () => {
  assert.equal(validateSubscription(fakeAuth).auth_mode, 'chatgpt');
  for (const invalid of [{ ...fakeAuth, auth_mode: 'apikey' }, { ...fakeAuth, auth_mode: 'chatgptAuthTokens' },
    { ...fakeAuth, OPENAI_API_KEY: 'synthetic-key' }, { ...fakeAuth, tokens: { ...fakeAuth.tokens, refresh_token: '' } }]) {
    assert.throws(() => validateSubscription(invalid), /managed ChatGPT/);
  }
  assert.throws(() => subscriptionConfig({ CODEX_AUTH_JSON: 'inline-json' }), /file variable/);
  assert.throws(() => subscriptionConfig({ CODEX_AUTH_JSON: '/tmp/synthetic.json', OPENAI_API_KEY: 'synthetic-key' }), /forbidden/);
});

test('strict verdict rejects prefixes, duplicate checks, extra keys, and disagreement', () => {
  assert.throws(() => verdictSchema.parse('PASS: all good'));
  const checks = ['scores', 'current-player', 'search-back'].map((id) => ({ id, state: 'PASS', detail: 'Observed.', screenshot: `${id}.png` }));
  assert.throws(() => verdictSchema.parse({ state: 'FAIL', checks }));
  assert.throws(() => verdictSchema.parse({ state: 'PASS', checks: [checks[0], checks[0], checks[2]] }));
  assert.throws(() => verdictSchema.parse({ state: 'PASS', checks, extra: true }));
  assert.throws(() => verdictSchema.parse({ state: 'PASS', checks: checks.map((check) => ({ ...check, screenshot: 'evidence-output-placeholder.png' })) }));
  assert.throws(() => verdictSchema.parse({ state: 'PASS', checks: checks.map((check) => ({ ...check, screenshot: 'scores.png' })) }));
  assert.throws(() => targetSchema.parse({ source: { sha: 'a'.repeat(40) } }));
});

test('complete local fake-executable run requires decodable evidence and persists refreshed credentials', { timeout: 15_000 }, async () => {
  await scenario('pass', async ({ options, root, log, seed }) => {
    const result = await executeCheck(options);
    assert.equal(result.state, 'PASS');
    assert.equal(result.cleanup.state, 'stopped');
    assert.equal(result.auth, 'persisted');
    assert.equal(JSON.parse(await readFile(join(root, 'persisted.json'), 'utf8')).tokens.refresh_token, 'refreshed-synthetic-token');
    assert.equal(JSON.parse(await readFile(seed, 'utf8')).tokens.refresh_token, 'synthetic-refresh-token');
    assert.ok(result.evidence.screenshots.length >= 5);
    assert.ok(result.evidence.recording.bytes > 1000);
    assert.throws(() => resultSchema.parse({ ...result, state: 'FAIL' }));
    const serialized = await readFile(join(options.outputRoot, 'public', result.attemptId, 'result.json'), 'utf8');
    assert.ok(!serialized.includes('synthetic-'));
    const commands = await readFile(log, 'utf8');
    assert.ok(commands.includes('simulator:stop'));
    assert.ok(commands.includes('--id'));
    const second = await executeCheck(options);
    assert.notEqual(second.attemptId, result.attemptId);
    assert.equal(second.state, 'PASS');
  });
});

for (const kind of ['malformed-verdict', 'missing-screenshot', 'missing-recording', 'corrupt-recording', 'timeout', 'exit-nonzero', 'auth-write-back-failed', 'cleanup-unconfirmed', 'wrong-bundle', 'partial-start']) {
  test(`${kind} remains INCONCLUSIVE and stops only the owned simulator`, { timeout: 15_000 }, async () => {
    await scenario(kind, async ({ options, log }) => {
      const result = await executeCheck(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      if (kind === 'missing-recording' || kind === 'missing-screenshot') assert.equal(result.agentObservation?.state, 'PASS');
      const commands = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      const stops = commands.filter((item) => item.args[0] === 'simulator:stop');
      assert.equal(stops.length, 1);
      assert.deepEqual(stops[0].args, ['simulator:stop', '--id', sessionId, '--json', '--non-interactive']);
      if (kind === 'timeout') assert.equal(result.termination.kind, 'timeout');
      if (kind === 'cleanup-unconfirmed') assert.equal(result.cleanup.state, 'unconfirmed');
      else assert.equal(result.cleanup.state, 'stopped');
      if (kind === 'auth-write-back-failed') assert.equal(result.auth, 'write-back-failed');
    });
  });
}

for (const kind of ['untrusted-repo', 'build-sha-mismatch', 'source-sha-mismatch', 'fork-pr', 'pr-head-mismatch', 'target-without-baseline']) {
  test(`${kind} fails before credentials or simulator startup`, { timeout: 15_000 }, async () => {
    await scenario(kind, async ({ options, log }) => {
      if (kind === 'source-sha-mismatch') options.env.AGENT_SOURCE_SHA = 'b'.repeat(40);
      if (kind === 'untrusted-repo') options.env.AGENT_TRUSTED_REPOSITORY = 'another/repository';
      if (['fork-pr', 'pr-head-mismatch', 'target-without-baseline'].includes(kind)) options.env.AGENT_PR_NUMBER = '7';
      const result = await executeCheck(options);
      assert.equal(result.state, 'INCONCLUSIVE');
      assert.equal(result.auth, 'not-loaded');
      assert.equal(result.cleanup.state, 'not-needed');
      let commands = '';
      try { commands = await readFile(log, 'utf8'); } catch {}
      assert.ok(!commands.includes('simulator:start') && !commands.includes('env:update'));
    });
  });
}

test('the explicitly approved public repository passes the same trusted source checks', { timeout: 15_000 }, async () => {
  await scenario('public-repo', async ({ options }) => {
    const result = await executeCheck(options);
    assert.equal(result.state, 'PASS');
  });
});

test('an observed acceptance failure with full evidence is FAIL', { timeout: 15_000 }, async () => {
  await scenario('observed-fail', async ({ options }) => {
    const result = await executeCheck(options);
    assert.equal(result.state, 'FAIL');
  });
});

test('a repack keeps native source identity distinct from the embedded candidate and installed build', { timeout: 15_000 }, async () => {
  await scenario('repack', async ({ options }) => {
    options.env.AGENT_NATIVE_SOURCE_BUILD_ID = nativeBuild;
    options.env.AGENT_NATIVE_SOURCE_SHA = 'c'.repeat(40);
    const result = await executeCheck(options);
    assert.equal(result.state, 'PASS');
    assert.equal(result.target.native.kind, 'repacked');
    assert.equal(result.target.bundle.candidate, options.env.AGENT_SOURCE_SHA);
    assert.notEqual(result.target.native.sourceSha, result.target.bundle.candidate);
    assert.equal(result.target.native.installed, installedBuild);
  });
});

test('evidence admission rejects symlink escapes and stale files', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lob-file-test-'));
  try {
    await symlink(join(mediaDirectory, 'screen.png'), join(directory, 'escape.png'));
    await assert.rejects(admitFile({ directory, name: 'escape.png', kind: 'png', startedAt: 0 }));
    await copyFile(join(mediaDirectory, 'screen.png'), join(directory, 'stale.png'));
    await assert.rejects(admitFile({ directory, name: 'stale.png', kind: 'png', startedAt: Date.now() + 5000 }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const [kind, expected] of [
  ['triage-replicated', 'REPLICATED'], ['triage-not-replicated', 'NOT_REPLICATED'],
  ['triage-missing-screenshot', 'INCONCLUSIVE'], ['triage-malformed-verdict', 'INCONCLUSIVE'],
  ['triage-unknown-issue', 'INCONCLUSIVE'],
]) {
  test(`${kind} uses actual admitted media and the independent issue contract`, { timeout: 15_000 }, async () => {
    await scenario(kind, async ({ options, log }) => {
      options.env.AGENT_TASK = 'triage';
      options.env.AGENT_ISSUE_NUMBER = '7';
      const result = await executeCheck(options);
      assert.equal(result.state, expected);
      if (kind === 'triage-unknown-issue') {
        assert.equal(result.auth, 'not-loaded');
        assert.equal(result.cleanup.state, 'not-needed');
      } else {
        assert.equal(result.target?.criteria.path, 'demo/issues/player-label.md');
        assert.equal(result.target?.issue?.number, 7);
        assert.equal(result.cleanup.state, 'stopped');
      }
      if (expected !== 'INCONCLUSIVE') {
        options.env.AGENT_GITHUB_WRITE_TOKEN = 'synthetic-write-token';
        await assert.rejects(publishTriage({ result, cwd: options.cwd, env: options.env, outputRoot: options.outputRoot, apiBase: options.githubApiBase }), /cloud evidence link/);
        const linked = { ...result, runUrl: 'https://expo.dev/accounts/demo/projects/lob/workflows/run-1' };
        const published = await publishTriage({ result: linked, cwd: options.cwd, env: options.env, outputRoot: options.outputRoot, apiBase: options.githubApiBase });
        assert.equal(published.kind, 'created');
        await rm(join(options.outputRoot, 'public', result.attemptId, 'publication.json'));
        const reused = await publishTriage({ result: linked, cwd: options.cwd, env: options.env, outputRoot: options.outputRoot, apiBase: options.githubApiBase });
        assert.equal(reused.kind, 'reused');
        await rm(join(options.outputRoot, 'public', result.attemptId, 'publication.json'));
        const updated = await publishTriage({ result: { ...linked, runUrl: 'https://expo.dev/accounts/demo/projects/lob/workflows/run-2' }, cwd: options.cwd, env: options.env, outputRoot: options.outputRoot, apiBase: options.githubApiBase });
        assert.equal(updated.kind, 'updated');
        assert.ok((await readFile(log, 'utf8')).includes('simulator:stop'));
      }
    });
  });
}

for (const [kind, expected] of [['acceptance', 'PASS'], ['acceptance-seeded', 'FAIL'], ['acceptance-issue-edited', 'INCONCLUSIVE']]) {
  test(`PR ${kind} selects frozen original criteria independently of ordinary baseline CI`, { timeout: 15_000 }, async () => {
    await scenario(kind, async ({ options }) => {
      options.env.AGENT_PR_NUMBER = '8';
      const result = await executeCheck(options);
      assert.equal(result.state, expected);
      if (expected === 'INCONCLUSIVE') assert.equal(result.auth, 'not-loaded');
      else {
        assert.equal(result.target?.kind, 'acceptance');
        assert.equal(result.target?.criteria.path, 'demo/issues/player-label.md');
        assert.ok(result.state !== 'INCONCLUSIVE' && result.verdict.checks.some((check) => check.id === 'historical-points'));
      }
    });
  });
}

test('manual acceptance requires original issue and criteria digests', { timeout: 15_000 }, async () => {
  await scenario('acceptance', async ({ options }) => {
    options.env.AGENT_TASK = 'acceptance'; options.env.AGENT_ISSUE_NUMBER = '7';
    const result = await executeCheck(options);
    assert.equal(result.state, 'INCONCLUSIVE'); assert.equal(result.auth, 'not-loaded');
  });
});
