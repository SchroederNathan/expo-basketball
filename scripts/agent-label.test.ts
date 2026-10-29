import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBridge } from './agent-label.mjs';

const repo = 'SchroederNathan/expo-basketball';
const target = 'release/prizepicks-demo';
const candidate = 'a'.repeat(40);
const controller = 'b'.repeat(40);
const marker = '<!-- lob-demo:player-label -->';
const repository = () => ({ id: 101, full_name: repo, fork: false, default_branch: 'main' });
const event = () => ({
  repository: repository(), sender: { login: 'SchroederNathan' },
  action: 'labeled', issue: { number: 42 }, label: { name: 'agent' },
});
const issue = () => ({
  id: 202, node_id: 'I_demo', number: 42, state: 'open', title: 'Repair player labels',
  body: `${marker}\nUse the original demo criteria.`, author_association: 'OWNER',
  html_url: `https://github.com/${repo}/issues/42`, repository_url: `https://api.github.com/repos/${repo}`,
  labels: [{ name: 'agent' }, { name: 'agent-triage' }],
});
const environment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: 'issues', GITHUB_ACTOR: 'SchroederNathan',
  GITHUB_TRIGGERING_ACTOR: 'SchroederNathan', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: controller,
  GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/agent-label.yml@refs/heads/main`,
  GITHUB_WORKSPACE: '/trusted/controller', GITHUB_TOKEN: 'synthetic-read-token', EXPO_AGENT_TOKEN: 'synthetic-expo-token',
  PATH: '/synthetic/bin', HOME: '/synthetic/home', UNRELATED_SECRET: 'must-not-leak',
});
const ref = (sha = candidate, branch = target) => ({ ref: `refs/heads/${branch}`, object: { type: 'commit', sha } });
type FixtureOptions = {
  currentRepository?: unknown; currentIssue?: unknown; refs?: unknown[];
  permission?: string; permissionUser?: string;
  deniedActor?: string; failure?: { path: string; status: number; rawBody?: string; location?: string };
  spawnStatus?: number | null; spawnSignal?: NodeJS.Signals; spawnError?: Error; throwSpawn?: boolean;
  realSpawn?: boolean;
};

async function fixture(t: TestContext, options: FixtureOptions = {}) {
  const requests: { method: string | undefined; path: string; authorization: string | undefined }[] = [];
  const spawns: { file: string; args: readonly string[]; options: SpawnSyncOptionsWithStringEncoding }[] = [];
  let refReads = 0;
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '').replace(`/repos/${repo}`, ''));
    requests.push({ method: request.method, path, authorization: request.headers.authorization });
    if (options.failure?.path === path) {
      response.writeHead(options.failure.status, options.failure.location ? { Location: options.failure.location } : {});
      response.end(options.failure.rawBody ?? '{}');
      return;
    }
    let body: unknown;
    if (path === '') body = Object.hasOwn(options, 'currentRepository') ? options.currentRepository : repository();
    else if (path === '/issues/42') body = Object.hasOwn(options, 'currentIssue') ? options.currentIssue : issue();
    else if (path.startsWith('/collaborators/')) {
      const login = path.split('/')[2];
      body = { permission: login === options.deniedActor ? 'read' : (options.permission ?? 'write'),
        role_name: 'maintain', user: { login: options.permissionUser ?? login } };
    } else if (path.startsWith('/git/ref/heads/')) {
      const branch = path.replace('/git/ref/heads/', '');
      body = options.refs ? options.refs[Math.min(refReads++, options.refs.length - 1)] : ref(candidate, branch);
    } else {
      response.writeHead(404).end('{}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const run = (overrides: { env?: NodeJS.ProcessEnv; event?: unknown; dryRun?: boolean } = {}) => runBridge({
    env: overrides.env ?? environment(), event: overrides.event ?? event(), dryRun: overrides.dryRun ?? false,
    apiBase: `http://127.0.0.1:${address.port}`,
    spawnImpl: options.realSpawn ? undefined : (file: string, args: readonly string[], childOptions: SpawnSyncOptionsWithStringEncoding) => {
      spawns.push({ file, args, options: childOptions });
      if (options.throwSpawn) throw new Error('synthetic secret in spawn error');
      return { status: options.spawnStatus === undefined ? 0 : options.spawnStatus,
        signal: options.spawnSignal ?? null, error: options.spawnError };
    },
  });
  return { run, requests, spawns };
}

for (const [label, operation, workflow] of [
  ['agent', 'issue-to-pr', '.eas/workflows/issue-to-pr.yml'],
  ['agent-triage', 'bug-triage', '.eas/workflows/bug-triage.yml'],
]) {
  test(`${label} dispatches only the fixed workflow at the exact target SHA`, async t => {
    const h = await fixture(t);
    const result = await h.run({ event: { ...event(), label: { name: label } } });
    assert.deepEqual(result, { status: 'dispatched', repository: repo, operation, workflow,
      targetRef: target, candidateSha: candidate, issueNumber: 42 });
    assert.equal(h.spawns.length, 1);
    const call = h.spawns[0];
    assert.ok(call);
    assert.equal(call.file, 'bunx');
    assert.deepEqual(call.args, ['eas-cli@25.3.0', 'workflow:run', workflow, '--ref', candidate,
      '-F', `repository=${repo}`, '-F', `target_ref=${target}`, '-F', `candidate_sha=${candidate}`,
      '-F', 'issue_number=42', '--non-interactive', '--no-wait', '--json']);
    assert.equal(call.options.cwd, '/trusted/controller');
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.env, { CI: '1', EXPO_NO_DOTENV: '1', EXPO_TOKEN: 'synthetic-expo-token',
      PATH: '/synthetic/bin', HOME: '/synthetic/home' });
    assert.equal(JSON.stringify(call.args).includes('token'), false);
    assert.ok(h.requests.every(request => request.method === 'GET' && request.authorization === 'Bearer synthetic-read-token'));
    assert.equal(h.requests.filter(request => request.path === `/git/ref/heads/${target}`).length, 2);
    assert.ok(h.requests.some(request => request.path === '/collaborators/SchroederNathan/permission'));
  });
}

for (const operation of ['issue-to-pr', 'bug-triage']) {
  test(`manual ${operation} uses its explicit target and verifies the current issue without a label`, async t => {
    const h = await fixture(t, { currentIssue: { ...issue(), labels: [] } });
    const result = await h.run({ env: { ...environment(), GITHUB_EVENT_NAME: 'workflow_dispatch', AGENT_DEMO_TARGET_REF: 'other/target' },
      event: { repository: repository(), sender: event().sender,
        inputs: { issue_number: '42', target_ref: 'reviewed/target', operation } } });
    assert.equal(result.status, 'dispatched');
    assert.ok('targetRef' in result);
    assert.equal(result.targetRef, 'reviewed/target');
    assert.ok(h.requests.some(request => request.path === '/git/ref/heads/reviewed/target'));
  });
}

test('the explicit repository variable supplies label targets', async t => {
  const h = await fixture(t);
  const result = await h.run({ env: { ...environment(), AGENT_DEMO_TARGET_REF: 'release/selected' } });
  assert.ok('targetRef' in result);
  assert.equal(result.targetRef, 'release/selected');
});

test('blank manual target falls back to the demo branch, never main', async t => {
  const h = await fixture(t);
  const result = await h.run({ env: { ...environment(), GITHUB_EVENT_NAME: 'workflow_dispatch' },
    event: { ...event(), inputs: { issue_number: '42', target_ref: '', operation: 'bug-triage' } } });
  assert.ok('targetRef' in result);
  assert.equal(result.targetRef, target);
});

test('an operator can explicitly choose main', async t => {
  const h = await fixture(t);
  const result = await h.run({ env: { ...environment(), AGENT_DEMO_TARGET_REF: 'main' } });
  assert.ok('targetRef' in result);
  assert.equal(result.targetRef, 'main');
});

for (const permission of ['write', 'maintain', 'admin']) {
  test(`actor permission ${permission} is admitted`, async t => {
    const h = await fixture(t, { permission });
    assert.equal((await h.run()).status, 'dispatched');
  });
}

for (const permission of ['read', 'triage', 'none', 'push', 'owner', '']) {
  test(`actor permission ${JSON.stringify(permission)} does not invoke EAS`, async t => {
    const h = await fixture(t, { permission });
    assert.equal((await h.run()).status, 'ignored');
    assert.equal(h.spawns.length, 0);
  });
}

test('a rerun also requires the triggering actor to have write access', async t => {
  const h = await fixture(t, { deniedActor: 'reader' });
  const result = await h.run({ env: { ...environment(), GITHUB_TRIGGERING_ACTOR: 'reader' } });
  assert.equal(result.status, 'ignored');
  assert.equal(h.spawns.length, 0);
  assert.ok(h.requests.some(request => request.path === '/collaborators/reader/permission'));
});

test('a permission response for another account is rejected', async t => {
  const h = await fixture(t, { permissionUser: 'other' });
  assert.equal((await h.run()).status, 'ignored');
  assert.equal(h.spawns.length, 0);
});

const rejectedEvents: [string, unknown, NodeJS.ProcessEnv][] = [
  ['wrong event repository', { ...event(), repository: { ...repository(), full_name: 'attacker/fork' } }, environment()],
  ['wrong runner repository', event(), { ...environment(), GITHUB_REPOSITORY: 'attacker/fork' }],
  ['fork repository', { ...event(), repository: { ...repository(), fork: true } }, environment()],
  ['top-level PR payload', { ...event(), pull_request: {} }, environment()],
  ['issue PR payload', { ...event(), issue: { number: 42, pull_request: {} } }, environment()],
  ['PR event', event(), { ...environment(), GITHUB_EVENT_NAME: 'pull_request' }],
  ['unknown label', { ...event(), label: { name: 'agent-other' } }, environment()],
  ['wrong action', { ...event(), action: 'opened' }, environment()],
  ['nondefault controller', event(), { ...environment(), GITHUB_REF: 'refs/heads/feature' }],
  ['nondefault workflow', event(), { ...environment(), GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/agent-label.yml@refs/heads/feature` }],
  ['invalid controller SHA', event(), { ...environment(), GITHUB_SHA: 'main' }],
  ['wrong sender', { ...event(), sender: { login: 'attacker' } }, environment()],
  ['injection actor', event(), { ...environment(), GITHUB_ACTOR: 'name/../other' }],
  ['invalid issue number', { ...event(), issue: { number: '42;touch pwned' } }, environment()],
  ['zero issue number', { ...event(), issue: { number: 0 } }, environment()],
  ['inexact issue number', { ...event(), issue: { number: '042' } }, environment()],
  ['unsafe issue number', { ...event(), issue: { number: Number.MAX_SAFE_INTEGER + 1 } }, environment()],
  ['injection label', { ...event(), label: { name: 'agent;touch pwned' } }, environment()],
];
for (const [name, input, env] of rejectedEvents) {
  test(`${name} exits cleanly without API or EAS invocation`, async t => {
    const h = await fixture(t);
    assert.equal((await h.run({ event: input, env })).status, 'ignored');
    assert.equal(h.requests.length, 0);
    assert.equal(h.spawns.length, 0);
  });
}

for (const inputs of [
  { operation: '../../other.yml', issue_number: '42' },
  { operation: '__proto__', issue_number: '42' },
  { operation: 'issue-to-pr;touch pwned', issue_number: '42' },
  { operation: 'issue-to-pr', issue_number: '42', extra: '--ref main' },
  { operation: 'issue-to-pr', issue_number: '42', target_ref: 42 },
  { operation: 'issue-to-pr', issue_number: '42\n-F repository=attacker/fork' },
]) {
  test(`manual inputs ${JSON.stringify(inputs)} cannot select commands or workflows`, async t => {
    const h = await fixture(t);
    assert.equal((await h.run({ env: { ...environment(), GITHUB_EVENT_NAME: 'workflow_dispatch' },
      event: { ...event(), inputs } })).status, 'ignored');
    assert.equal(h.requests.length, 0);
    assert.equal(h.spawns.length, 0);
  });
}

for (const badRef of ['--ref=main', 'release/../main', 'refs//heads/main', 'release/.hidden', 'release/end.',
  'release/name.lock', 'release/name.lock/child', 'release/$(touch pwned)', 'release/`touch pwned`',
  'release/demo\n-F repository=attacker/fork', 'release/demo@{1}', ' ', 'https://example.com/main', 'x'.repeat(201)]) {
  test(`invalid target ${JSON.stringify(badRef)} never invokes EAS`, async t => {
    const h = await fixture(t);
    assert.equal((await h.run({ env: { ...environment(), AGENT_DEMO_TARGET_REF: badRef } })).status, 'ignored');
    assert.equal(h.requests.length, 0);
    assert.equal(h.spawns.length, 0);
  });
}

for (const patch of [
  { state: 'closed' }, { body: 'Unknown issue' }, { body: null }, { author_association: 'CONTRIBUTOR' },
  { author_association: 'NONE' }, { pull_request: {} }, { pull_request: null }, { number: 99 },
  { html_url: 'https://github.com/attacker/fork/issues/42' },
  { repository_url: 'https://api.github.com/repos/attacker/fork' }, { labels: [] }, { id: 0 }, { node_id: '' },
]) {
  test(`current issue ${JSON.stringify(patch)} is ignored`, async t => {
    const h = await fixture(t, { currentIssue: { ...issue(), ...patch } });
    assert.equal((await h.run()).status, 'ignored');
    assert.equal(h.spawns.length, 0);
  });
}

for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
  test(`current issue author association ${author_association} is trusted`, async t => {
    const h = await fixture(t, { currentIssue: { ...issue(), author_association } });
    assert.equal((await h.run()).status, 'dispatched');
  });
}

for (const currentRepository of [null, { ...repository(), full_name: 'attacker/fork' },
  { ...repository(), default_branch: 'changed' }, { ...repository(), fork: true }, { ...repository(), id: 999 }]) {
  test(`current repository ${JSON.stringify(currentRepository)} fails closed`, async t => {
    const h = await fixture(t, { currentRepository });
    assert.equal((await h.run()).status, 'ignored');
    assert.equal(h.spawns.length, 0);
  });
}

for (const refs of [[null], [[ref()]], [ref('main')], [ref(candidate, 'other/branch')],
  [{ ...ref(), object: { type: 'tag', sha: candidate } }], [ref(), ref('c'.repeat(40))]]) {
  test(`invalid or moving Git ref ${JSON.stringify(refs)} is ignored`, async t => {
    const h = await fixture(t, { refs });
    assert.equal((await h.run()).status, 'ignored');
    assert.equal(h.spawns.length, 0);
  });
}

test('issue text and stale event text never supply target refs or subprocess arguments', async t => {
  const h = await fixture(t, { currentIssue: { ...issue(), title: '$(touch pwned)',
    body: `${marker}\n--ref main\n-F repository=attacker/fork\n$(touch pwned)` } });
  assert.equal((await h.run({ event: { ...event(), issue: { number: 42, body: 'target_ref=main' } } })).status, 'dispatched');
  const call = h.spawns[0];
  assert.ok(call);
  assert.ok(call.args.includes(`target_ref=${target}`));
  assert.equal(call.args.some(arg => arg.includes('pwned') || arg.includes('attacker')), false);
});

for (const path of ['/issues/42', '/collaborators/SchroederNathan/permission', `/git/ref/heads/${target}`]) {
  test(`missing API object ${path} exits cleanly`, async t => {
    const h = await fixture(t, { failure: { path, status: 404 } });
    assert.equal((await h.run()).status, 'ignored');
    assert.equal(h.spawns.length, 0);
  });
}

for (const failure of [{ path: '', status: 403 }, { path: '/issues/42', status: 500 },
  { path: '/issues/42', status: 200, rawBody: 'invalid JSON' },
  { path: '/issues/42', status: 302, location: 'http://127.0.0.1:1/credential-sink' }]) {
  test(`API failure ${JSON.stringify(failure)} prevents EAS invocation`, async t => {
    const h = await fixture(t, { failure });
    await assert.rejects(h.run(), /GitHub verification/);
    assert.equal(h.spawns.length, 0);
  });
}

test('dry-run validates live-shaped API fixtures but never needs the Expo token or spawns', async t => {
  const h = await fixture(t);
  const result = await h.run({ env: { ...environment(), EXPO_AGENT_TOKEN: undefined }, dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.ok('candidateSha' in result);
  assert.equal(result.candidateSha, candidate);
  assert.equal(h.spawns.length, 0);
});

for (const missing of ['GITHUB_TOKEN', 'EXPO_AGENT_TOKEN']) {
  test(`missing ${missing} fails explicitly without dispatch`, async t => {
    const h = await fixture(t);
    await assert.rejects(h.run({ env: { ...environment(), [missing]: undefined } }), new RegExp(missing));
    assert.equal(h.spawns.length, 0);
  });
}

for (const options of [{ spawnStatus: 1 }, { spawnStatus: null },
  { spawnStatus: 0, spawnSignal: 'SIGTERM' }, { spawnStatus: 0, spawnError: new Error('synthetic spawn error') },
  { throwSpawn: true }] satisfies FixtureOptions[]) {
  test(`failed dispatch ${JSON.stringify(options)} is reported without retry or raw output`, async t => {
    const h = await fixture(t, options);
    await assert.rejects(h.run(), /^Error: EAS dispatch failed\. Acceptance is unknown\. Inspect EAS before retrying\.$/);
    assert.equal(h.spawns.length, 1);
  });
}

test('the actual CLI reads the structured event file and exits zero on ignored events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-label-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const eventPath = join(directory, 'event $(touch pwned).json');
  await writeFile(eventPath, JSON.stringify({ ...event(), label: { name: 'unrelated' } }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./agent-label.mjs', import.meta.url))], {
    env: { ...environment(), GITHUB_EVENT_PATH: eventPath }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'ignored');
});

for (const exitCode of [0, 1]) {
  test(`the real spawn boundary invokes only an inert bunx with an isolated environment, exit ${exitCode}`, async t => {
    const h = await fixture(t, { realSpawn: true });
    const directory = await mkdtemp(join(tmpdir(), 'agent-label-spawn-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'bunx'), `#!${process.execPath}\n` +
      'import { writeFileSync } from "node:fs";\n' +
      'writeFileSync(process.env.HOME + "/record.json", JSON.stringify({ args: process.argv.slice(2), env: process.env }));\n' +
      'process.stderr.write("synthetic child output must stay private");\n' +
      `process.exit(${exitCode});\n`, { mode: 0o755 });
    const run = h.run({ env: { ...environment(), PATH: directory, HOME: directory, GITHUB_WORKSPACE: directory } });
    if (exitCode === 0) assert.equal((await run).status, 'dispatched');
    else await assert.rejects(run, /^Error: EAS dispatch failed\. Acceptance is unknown\. Inspect EAS before retrying\.$/);
    const record = JSON.parse(await readFile(join(directory, 'record.json'), 'utf8'));
    assert.equal(record.args[0], 'eas-cli@25.3.0');
    assert.equal(record.args[record.args.indexOf('--ref') + 1], candidate);
    assert.equal(record.env.EXPO_TOKEN, 'synthetic-expo-token');
    for (const name of ['GITHUB_TOKEN', 'EXPO_AGENT_TOKEN', 'UNRELATED_SECRET']) assert.equal(record.env[name], undefined);
  });
}

test('GitHub Actions YAML keeps trusted dispatches independent until the EAS subscription queue', async () => {
  const workflowPath = fileURLToPath(new URL('../.github/workflows/agent-label.yml', import.meta.url));
  const parsed = spawnSync(process.execPath, ['-e',
    'process.stdout.write(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))', workflowPath],
  { env: { NODE_ENV: 'test', PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const workflow = JSON.parse(parsed.stdout);
  assert.deepEqual(Object.keys(workflow.on).sort(), ['issues', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.issues.types, ['labeled']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs).sort(), ['issue_number', 'operation', 'target_ref']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ['issue-to-pr', 'bug-triage']);
  assert.deepEqual(workflow.permissions, { contents: 'read', issues: 'read' });
  assert.equal(workflow.concurrency, undefined);
  assert.equal(workflow.jobs.dispatch.concurrency, undefined);
  const job = workflow.jobs.dispatch;
  assert.match(job.if, /github\.repository == 'SchroederNathan\/expo-basketball'/);
  assert.match(job.if, /github\.event\.repository\.fork == false/);
  assert.match(job.if, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(job.if, /!github\.event\.pull_request && !github\.event\.issue\.pull_request/);
  assert.equal(job.steps.length, 4);
  assert.equal(job.steps[0].uses, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683');
  assert.deepEqual(job.steps[0].with, { repository: repo, ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false });
  assert.equal(job.steps[1].uses, 'oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76');
  assert.equal(job.steps[1].with['bun-version'], '1.2.22');
  assert.equal(job.steps[2].run, 'bun install --frozen-lockfile');
  assert.equal(job.steps[2].env, undefined);
  assert.equal(job.steps[3].run, 'bun scripts/agent-label.mjs');
  assert.deepEqual(job.steps[3].env, { GITHUB_TOKEN: '${{ github.token }}',
    AGENT_DEMO_TARGET_REF: '${{ vars.AGENT_DEMO_TARGET_REF }}', EXPO_AGENT_TOKEN: '${{ secrets.EXPO_AGENT_TOKEN }}' });
  for (const step of job.steps) if (step.run) assert.doesNotMatch(step.run, /\$\{\{/);
  const controllerSource = await readFile(new URL('./agent-label.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(controllerSource, /execSync|shell:\s*true/);
});
