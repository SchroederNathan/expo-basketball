import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { executeChange, assertChangedPaths } from './change';
import { demoIssueMarker, readAcceptance, issueDigest } from './issue';
import { digest, issueVerdictSchema } from './result';
import type { CheckOptions } from './run';

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function setup(kind: string, inspect: (context: {
  options: CheckOptions & { remote: string }; cwd: string; root: string;
  mutations: string[]; counts: { agents: number; prs: number }; setIssueBody: (body: string) => void;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lob-change-test-'));
  const cwd = join(root, 'repo');
  for (const path of ['src', 'demo/fixtures', 'demo/issues', '.eas/agents']) await mkdir(join(cwd, path), { recursive: true });
  for (const path of ['demo/fixtures/prizepicks-v1.json', 'demo/issues/player-label.md', '.eas/agents/check-ios.md', '.eas/agents/change.md']) {
    await copyFile(resolve(path), join(cwd, path));
  }
  const tsc = resolve('node_modules/typescript/lib/tsc.js');
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'lob-synthetic-controller-test', private: true, scripts: {
    typecheck: `bun ${tsc} --ignoreConfig --noEmit --strict --skipLibCheck --types node --typeRoots ${resolve('node_modules/@types')} src/label.ts`,
    test: 'bun test ./src',
  } }));
  await writeFile(join(cwd, 'src/label.ts'), "export function label() { return ''; }\n");
  await writeFile(join(cwd, 'src/label.test.ts'), "import { expect, test } from 'bun:test'; import { label } from './label'; test('baseline seed', () => expect(label()).toBe(''));\n");
  await writeFile(join(cwd, '.gitignore'), 'node_modules/\nagent-output/\n');
  execFileSync('bun', ['install'], { cwd, stdio: 'ignore' });
  git(cwd, ['init', '-b', 'release/prizepicks-demo']);
  git(cwd, ['add', '.']);
  git(cwd, ['-c', 'user.name=Controller fixture', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Reviewed fixture baseline']);
  const sha = git(cwd, ['rev-parse', 'HEAD']);
  const remote = join(root, 'remote.git');
  git(cwd, ['clone', '--bare', cwd, remote]);
  const seed = join(root, 'synthetic-auth.json');
  await writeFile(seed, JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: {
    access_token: 'synthetic-access', id_token: 'synthetic-id', refresh_token: 'synthetic-refresh',
  }, last_refresh: '2026-10-28T00:00:00Z' }));
  const fake = join(root, 'fake.mjs');
  await writeFile(fake, `
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, copyFileSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
const c = ${JSON.stringify({ root, kind })};
const [tool,...args]=process.argv.slice(2);
if(tool==='eas') {
  if(args[0]!=='env:update') process.exit(4);
  const path=args[args.indexOf('--value')+1];
  if(c.kind==='auth-writeback-failed' && readFileSync(path,'utf8').includes('refreshed')) process.exit(3);
  copyFileSync(path,join(c.root,'persisted.json'));
} else if(tool==='codex') {
  appendFileSync(join(c.root,'agents.log'),'agent\\n');
  for(const key of ['AGENT_GITHUB_WRITE_TOKEN','AGENT_GITHUB_READ_TOKEN','EXPO_TOKEN','OPENAI_API_KEY','CODEX_AUTH_JSON']) if(process.env[key]) process.exit(5);
  const auth=join(process.env.CODEX_HOME,'auth.json');
  const parsed=JSON.parse(readFileSync(auth,'utf8'));parsed.tokens.refresh_token='refreshed-synthetic';writeFileSync(auth,JSON.stringify(parsed));
  if(c.kind==='timeout') await new Promise(r=>setTimeout(r,30000));
  if(c.kind==='forbidden') { mkdirSync('.eas/workflows',{recursive:true});writeFileSync('.eas/workflows/evil.yml','forbidden'); }
  else if(c.kind==='fixture') writeFileSync('demo/fixtures/prizepicks-v1.json','{}');
  else if(c.kind==='deleted-test') unlinkSync('src/label.test.ts');
  else if(c.kind==='permissions') chmodSync('src/label.ts',0o777);
  else if(c.kind==='symlink') symlinkSync(join(c.root,'synthetic-auth.json'),'src/escape.ts');
  else if(!['no-change','inconclusive-zero-diff','ready-zero-diff'].includes(c.kind)) {
    writeFileSync('src/label.ts',"export function label() { return 'PTS'; }\\n");
    if(c.kind!=='failing-checks') writeFileSync('src/label.test.ts',"import { expect, test } from 'bun:test'; import { label } from './label'; test('historical label repair', () => expect(label()).toBe('PTS'));\\n");
  }
  const last=args[args.indexOf('--output-last-message')+1];
  const state=c.kind==='no-change'||c.kind==='no-change-with-diff'?'NO_CHANGE':c.kind==='inconclusive-zero-diff'?'INCONCLUSIVE':'READY';
  if(c.kind!=='missing-verdict') writeFileSync(last,c.kind==='invalid-verdict'?'READY':JSON.stringify({state,summary:'Synthetic source fix and regression test.'}));
}
`);
  const mutations: string[] = [];
  const counts = { agents: 0, prs: 0 };
  let issueBody = `${demoIssueMarker}\nJordan's points label is missing. Use the original repository criteria.`;
  let failPR = kind === 'retry';
  let failAfterPR = kind === 'retry-after-pr';
  let targetMoved = false;
  const moveTarget = () => {
    if (targetMoved) return;
    const tree = git(remote, ['rev-parse', `${sha}^{tree}`]);
    const moved = git(remote, ['-c', 'user.name=Human', '-c', 'user.email=human@example.invalid', 'commit-tree', tree, '-p', sha, '-m', 'Concurrent target advance']);
    git(remote, ['update-ref', 'refs/heads/release/prizepicks-demo', moved]);
    targetMoved = true;
  };
  const prs: { number: number; html_url: string; state: string; body: string; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string; sha: string; repo: { full_name: string } } }[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const url = request.url ?? '';
    const repository = { full_name: 'trusted/lob-demo', private: false };
    if (request.method === 'POST') {
      mutations.push(url);
      let body = ''; for await (const bytes of request) body += bytes;
      if (failPR) { failPR = false; response.statusCode = 503; response.end('{}'); return; }
      const input = JSON.parse(body);
      if (kind === 'target-create-race') moveTarget();
      const pr = { number: 8, html_url: 'https://github.com/trusted/lob-demo/pull/8', state: 'open', body: input.body,
        head: { ref: input.head, sha: git(remote, ['rev-parse', `refs/heads/${input.head}`]), repo: repository },
        base: { ref: input.base, sha: git(remote, ['rev-parse', `refs/heads/${input.base}`]), repo: repository } };
      prs.push(pr); counts.prs++;
      if (kind === 'target-post-pr-race') moveTarget();
      if (failAfterPR) { failAfterPR = false; response.statusCode = 503; response.end('{}'); return; }
      response.end(JSON.stringify(pr)); return;
    }
    if (url.includes('/branches/')) {
      const ref = decodeURIComponent(url.split('/branches/')[1] ?? '');
      response.end(JSON.stringify({ name: ref, commit: { sha: kind === 'invalid-source' ? 'b'.repeat(40) : git(remote, ['rev-parse', `refs/heads/${ref}`]) } }));
    } else if (url.includes('/issues/')) {
      response.end(JSON.stringify({ id: 123, node_id: 'I_demo', number: kind === 'unknown-issue' ? 99 : 7, title: 'Jordan label', body: issueBody,
        state: 'open', updated_at: '2026-10-28T00:00:00Z', html_url: 'https://github.com/trusted/lob-demo/issues/7', author_association: 'OWNER' }));
    } else if (url.includes('/pulls?')) {
      const branch = new URL(`http://fixture${url}`).searchParams.get('head')?.split(':')[1] ?? '';
      if (kind === 'target-race') moveTarget();
      if (kind === 'push-conflict') {
        const tree = git(remote, ['rev-parse', `${sha}^{tree}`]);
        const human = git(remote, ['-c', 'user.name=Human', '-c', 'user.email=human@example.invalid', 'commit-tree', tree, '-p', sha, '-m', 'Concurrent human branch']);
        git(remote, ['update-ref', `refs/heads/${branch}`, human]);
      }
      if (kind === 'closed-pr') {
        response.end(JSON.stringify([{ number: 8, html_url: 'https://github.com/trusted/lob-demo/pull/8', state: 'closed', body: 'Closed human PR',
          head: { ref: branch, sha, repo: repository }, base: { ref: 'release/prizepicks-demo', sha, repo: repository } }]));
      } else response.end(JSON.stringify(kind === 'reused-pr-base-mismatch' ? prs.map(pr => ({ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } })) : prs));
    }
    else response.end(JSON.stringify(repository));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options: CheckOptions & { remote: string } = {
    cwd, remote, outputRoot: join(root, 'output'), signal: new AbortController().signal,
    env: { PATH: process.env.PATH, HOME: root, EXPO_TOKEN: 'synthetic-expo', CODEX_AUTH_JSON: seed, AGENT_AUTH_WRITE_TOKEN: 'synthetic-write-token',
      AGENT_TRUSTED_AUTOMATION: 'enabled', AGENT_TRUSTED_REPOSITORY: 'trusted/lob-demo', AGENT_REPOSITORY: 'trusted/lob-demo',
      AGENT_WORKFLOW_BASELINE_SHA: sha, AGENT_SOURCE_SHA: sha, AGENT_SOURCE_REF: 'release/prizepicks-demo', AGENT_ISSUE_NUMBER: '7',
      AGENT_GITHUB_WRITE_TOKEN: 'synthetic-github-write', AGENT_GITHUB_READ_TOKEN: 'synthetic-read' },
    githubApiBase: `http://127.0.0.1:${address.port}`,
    executables: { eas: { file: process.execPath, args: [fake, 'eas'] }, codex: { file: process.execPath, args: [fake, 'codex'] },
      device: { file: 'false', args: [] }, ffmpeg: { file: 'false', args: [] }, ffprobe: { file: 'false', args: [] } },
    limits: { authMs: 2000, agentMs: kind === 'timeout' ? 250 : 3000, startupMs: 100, cleanupMs: 100, deviceMs: 100 },
  };
  try {
    await inspect({ options, cwd, root, mutations, counts, setIssueBody: (body) => { issueBody = body; } });
  } finally {
    server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
}

test('changed-path boundary allows app source/tests and rejects workflow, auth, identity, fixtures, renames and config paths', () => {
  assertChangedPaths(['src/api/schemas.ts', 'src/screens/player/index.tsx', 'src/api/demo.test.ts', 'app/(tabs)/index.tsx']);
  for (const path of ['.eas/agents/run.ts', '.github/workflows/test.yml', 'auth.json', 'src/demo/identity.tsx', 'src/api/demo.ts',
    'demo/fixtures/prizepicks-v1.json', 'demo/issues/player-label.md', 'app.config.ts', 'package.json', 'src/../run.ts', 'src/.auth.ts', 'src/evil.sh']) {
    assert.throws(() => assertChangedPaths([path]), /Forbidden/);
  }
});

test('issue verdict requires every original check and rejects a wrong-task or malformed observation', () => {
  for (const value of [null, {}, { state: 'REPLICATED', checks: [] }, { state: 'PASS', checks: ['scores'] }]) assert.throws(() => issueVerdictSchema.parse(value));
});

for (const [kind, state] of [
  ['missing-verdict', 'INCONCLUSIVE'], ['invalid-verdict', 'INCONCLUSIVE'], ['timeout', 'INCONCLUSIVE'],
  ['forbidden', 'REJECTED'], ['fixture', 'REJECTED'], ['symlink', 'REJECTED'], ['deleted-test', 'REJECTED'], ['permissions', 'REJECTED'],
  ['no-change', 'NO_CHANGE'], ['failing-checks', 'INCONCLUSIVE'], ['unknown-issue', 'INCONCLUSIVE'], ['invalid-source', 'INCONCLUSIVE'],
  ['inconclusive-zero-diff', 'INCONCLUSIVE'], ['ready-zero-diff', 'INCONCLUSIVE'], ['no-change-with-diff', 'INCONCLUSIVE'],
  ['auth-writeback-failed', 'INCONCLUSIVE'], ['closed-pr', 'CONFLICT'],
]) {
  test(`coding ${kind} produces ${state} without remote mutation`, async () => {
    await setup(kind, async ({ options, mutations }) => {
      const before = git(options.remote, ['show-ref']);
      const result = await executeChange(options);
      assert.equal(result.state, state, 'reason' in result ? result.reason : '');
      assert.deepEqual(mutations, []);
      assert.equal(git(options.remote, ['show-ref']), before);
      if (!['unknown-issue', 'invalid-source'].includes(kind)) assert.ok(result.auth !== 'not-loaded');
    });
  });
}

test('missing write token fails before subscription credentials are loaded', async () => {
  await setup('missing-token', async ({ options, mutations }) => {
    delete options.env.AGENT_GITHUB_WRITE_TOKEN;
    const result = await executeChange(options);
    assert.equal(result.state, 'INCONCLUSIVE'); assert.equal(result.auth, 'not-loaded'); assert.deepEqual(mutations, []);
  });
});

for (const kind of ['success', 'retry', 'retry-after-pr']) {
  test(`controller ${kind} validates, fast-forwards once, and reuses exactly one PR on retry`, async () => {
    await setup(kind, async ({ options, root, cwd, mutations, counts }) => {
      const baseline = git(cwd, ['rev-parse', 'HEAD']);
      const fixtureBefore = await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'), 'utf8');
      const first = await executeChange(options);
      if (kind === 'success') assert.equal(first.state, 'PR_READY', 'reason' in first ? first.reason : '');
      else assert.equal(first.state, 'INCONCLUSIVE');
      const second = await executeChange(options);
      assert.equal(second.state, 'PR_READY', 'reason' in second ? second.reason : '');
      assert.equal(second.auth, 'not-loaded');
      if (second.state !== 'PR_READY') assert.fail('Missing candidate');
      assert.equal(git(options.remote, ['rev-parse', `${second.branch}^`]), baseline);
      assert.equal(counts.prs, 1);
      assert.equal((await readFile(join(root, 'agents.log'), 'utf8')).trim().split('\n').length, 1);
      const receipt = readAcceptance(git(options.remote, ['show', '-s', '--format=%B', second.candidate]));
      assert.equal(receipt?.target.ref, 'release/prizepicks-demo');
      assert.equal(receipt?.criteriaSha256, digest(await readFile(join(cwd, 'demo/issues/player-label.md'))));
      assert.equal(git(cwd, ['rev-parse', 'HEAD']), baseline);
      assert.equal(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'), 'utf8'), fixtureBefore);
      assert.equal(JSON.parse(await readFile(join(root, 'persisted.json'), 'utf8')).tokens.refresh_token, 'refreshed-synthetic');
      assert.ok(mutations.length <= 2);
    });
  });
}

test('human changes to the issue branch produce a conflict without another agent, push, or PR', async () => {
  await setup('success', async ({ options, root, mutations }) => {
    const first = await executeChange(options); assert.equal(first.state, 'PR_READY');
    if (first.state !== 'PR_READY') assert.fail('Missing candidate');
    const human = join(root, 'human'); git(root, ['clone', options.remote, human]);
    git(human, ['checkout', first.branch]); await writeFile(join(human, 'human.txt'), 'human change'); git(human, ['add', '.']);
    git(human, ['-c', 'user.name=Human', '-c', 'user.email=human@example.invalid', 'commit', '-m', 'Human change']);
    git(human, ['push', 'origin', first.branch]);
    const head = git(options.remote, ['rev-parse', first.branch]); const writes = mutations.length;
    const second = await executeChange(options);
    assert.equal(second.state, 'CONFLICT', 'reason' in second ? second.reason : '');
    assert.equal(mutations.length, writes); assert.equal(git(options.remote, ['rev-parse', first.branch]), head);
  });
});

test('a changed issue digest fails closed rather than silently rewriting the acceptance contract', async () => {
  await setup('success', async ({ options, setIssueBody, mutations }) => {
    const first = await executeChange(options); assert.equal(first.state, 'PR_READY');
    setIssueBody(`${demoIssueMarker}\nChanged issue input.`);
    const second = await executeChange(options);
    assert.equal(second.state, 'CONFLICT', 'reason' in second ? second.reason : '');
    assert.equal(mutations.length, 1);
  });
});

test('a branch race causes an ordinary push rejection and never creates a PR or force-pushes', async () => {
  await setup('push-conflict', async ({ options, mutations }) => {
    const result = await executeChange(options);
    assert.equal(result.state, 'CONFLICT', 'reason' in result ? result.reason : '');
    assert.ok('reason' in result && result.reason.includes('Non-force push failed'));
    assert.deepEqual(mutations, []);
  });
});

for (const kind of ['target-race', 'target-create-race', 'target-post-pr-race']) {
  test(`${kind} cannot report PR_READY against a moving frozen target`, async () => {
    await setup(kind, async ({ options, counts }) => {
      const result = await executeChange(options);
      assert.equal(result.state, 'CONFLICT', 'reason' in result ? result.reason : '');
      assert.notEqual(git(options.remote, ['rev-parse', 'refs/heads/release/prizepicks-demo']), options.env.AGENT_SOURCE_SHA);
      assert.equal(counts.prs, kind === 'target-race' ? 0 : 1);
    });
  });
}

test('an existing PR with the expected base ref and a different base SHA is a conflict', async () => {
  await setup('reused-pr-base-mismatch', async ({ options, counts, mutations }) => {
    const first = await executeChange(options);
    assert.equal(first.state, 'PR_READY', 'reason' in first ? first.reason : '');
    const writes = mutations.length;
    const second = await executeChange(options);
    assert.equal(second.state, 'CONFLICT', 'reason' in second ? second.reason : '');
    assert.equal(counts.prs, 1);
    assert.equal(mutations.length, writes);
  });
});

test('issue content digest ignores comment timestamps and changes when the reported input changes', () => {
  const issue = { id: 1, node_id: 'I_1', number: 7, title: 'Jordan', body: demoIssueMarker, state: 'open',
    updated_at: '2026-10-28T00:00:00Z', html_url: 'https://github.com/trusted/lob-demo/issues/7', author_association: 'OWNER' } satisfies Parameters<typeof issueDigest>[0];
  assert.equal(issueDigest(issue), issueDigest({ ...issue, updated_at: '2026-10-29T00:00:00Z' }));
  assert.notEqual(issueDigest(issue), issueDigest({ ...issue, body: `${demoIssueMarker} edited` }));
});
