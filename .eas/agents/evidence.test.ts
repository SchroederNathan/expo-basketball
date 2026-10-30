import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitHub, PublicationConflict } from './github';
import { assetUrl, evidenceBytes, publicBytes } from './evidence-files';
import { derivePlayback, probeMedia, verifyPlaybackReadiness } from './evidence-media';
import { deliverySchema, destination, finalizedEvidence, plain, publicationStatus, renderEvidence, stageEvidence, type Manifest, type Slot } from './evidence';
import { deliverManifest, publishEvidenceComment } from './evidence-publisher';
import { evidencePhase } from './evidence-phase';
import { ghPin, prepareEvidenceWriter, type EvidenceWriter } from './evidence-tools';
import { qaResultSchema } from './qa-result';
import { admitFile, digest, resultSchema, targetSchema, type FileRef } from './result';
import { acceptanceMarker, acceptanceSchema, demoIssueMarker, issueDigest } from './issue';

let media = '';
let png: Buffer;
let mp4: Buffer;
const repository = 'owner/repo';
const sourceSha = 'a'.repeat(40);
const runId = '01a18906-6503-7785-8de9-f9d00384177e';
const runUrl = `https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/${runId}`;
const target = targetSchema.parse({ kind: 'check', issue: null, controller: { ref: 'feature/demo', sha: sourceSha }, source: { ref: 'feature/demo', sha: sourceSha }, repository,
  pullRequest: 4, platform: 'ios', appId: 'dev.expo.basketball', profile: 'agent-preview', environment: 'preview', fingerprint: '1'.repeat(40), runtime: '1.0.0',
  fixture: { id: 'prizepicks-v1', sha256: '2'.repeat(64), date: '20261026', zone: 'America/Toronto' }, criteria: { path: '.eas/agents/check-ios.md', sha256: '3'.repeat(64) },
  native: { kind: 'built', installed: '11111111-1111-4111-8111-111111111111', sourceSha }, bundle: { kind: 'embedded', candidate: sourceSha } });
const ref = (path: string, bytes: Uint8Array | string): FileRef => ({ path, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) });
before(async () => {
  media = await mkdtemp(join(tmpdir(), 'lob-evidence-tests-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=200x300:r=12:d=1.5', '-c:v', 'mpeg4', join(media, 'session.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(media, 'session.mp4'), '-frames:v', '1', join(media, 'screen.png')]);
  png = await readFile(join(media, 'screen.png')); mp4 = await readFile(join(media, 'session.mp4'));
});
after(async () => { await rm(media, { recursive: true, force: true }); });

function deviceResult() {
  const sessionId = randomUUID(), attemptId = randomUUID();
  const ids = ['scores', 'current-player', 'search-back'] as const;
  return resultSchema.parse({ version: 1, state: 'PASS', runId, runUrl, attemptId, jobKey: 'check-ios', target,
    session: { id: sessionId, url: `https://expo.dev/sessions/${sessionId}`, attemptId, expiresAt: '2026-10-29T21:00:00.000Z' },
    startedAt: '2026-10-29T19:00:00.000Z', finishedAt: '2026-10-29T19:05:00.000Z', termination: { kind: 'exited', code: 0 },
    cleanup: { state: 'stopped', sessionId }, auth: 'persisted', tools: { bun: '1.2.22', eas: '25.3.0', codex: '0.165.0', agentDevice: '0.21.33' },
    verdict: { state: 'PASS', checks: ids.map((id) => ({ id, state: 'PASS', detail: 'Observed synthetic UI.', screenshot: `${id}.png` })) },
    evidence: { identity: ref('identity.json', '{}'), screenshots: ['controller-start', ...ids, 'controller-end'].map((name) => ref(`${name}.png`, png)),
      recording: ref('session.mp4', mp4), recordingSessionId: sessionId } });
}
async function fixture() {
  const directory = await mkdtemp(join(media, 'case-'));
  const result = deviceResult();
  if (result.state === 'INCONCLUSIVE') throw new Error('Fixture is definitive.');
  for (const file of result.evidence.screenshots) await writeFile(join(directory, file.path), png);
  await writeFile(join(directory, 'session.mp4'), mp4); await writeFile(join(directory, 'identity.json'), '{}');
  return { directory, result };
}

for (const path of ['../screen.png', '/screen.png', 'x/../../screen.png', 'scores\\screen.png', '%2e%2e/screen.png', 'scores/%2f.png']) {
  test(`publication rejects unsafe path ${path}`, async () => { await assert.rejects(evidenceBytes(media, path)); });
}
test('publication rejects symlinks, hard links, parent escapes, corrupt hashes and oversized files', async () => {
  const root = await mkdtemp(join(media, 'paths-'));
  await symlink(join(media, 'screen.png'), join(root, 'linked.png'));
  await assert.rejects(evidenceBytes(root, 'linked.png'));
  await link(join(media, 'screen.png'), join(root, 'hard.png'));
  await assert.rejects(evidenceBytes(root, 'hard.png'));
  await rm(join(root, 'hard.png'));
  await symlink(media, join(root, 'scores'));
  await assert.rejects(evidenceBytes(root, 'scores/screen.png'));
  await copyFile(join(media, 'screen.png'), join(root, 'normal.png'));
  await assert.rejects(evidenceBytes(root, 'normal.png', ref('normal.png', 'wrong')));
  await assert.rejects(evidenceBytes(root, 'normal.png', undefined, 10));
  execFileSync('mkfifo', [join(root, 'pipe.png')]);
  await assert.rejects(evidenceBytes(root, 'pipe.png'));
  await utimes(join(root, 'normal.png'), new Date(0), new Date(0));
  await assert.rejects(admitFile({ directory: root, name: 'normal.png', kind: 'png', startedAt: Date.now() }));
  assert.deepEqual(await evidenceBytes(root, 'normal.png', ref('normal.png', png)), png, 'Publication rereads admitted bytes, without bypassing live capture freshness.');
});

test('staging preserves original bytes, all playback frames, separate check captions and excludes neighbors', { timeout: 30_000 }, async () => {
  const { directory, result } = await fixture();
  await writeFile(join(directory, 'private-log.json'), 'not public');
  const staged = join(directory, 'staged');
  const mixed = resultSchema.parse({ ...result, state: 'FAIL', verdict: { state: 'FAIL', checks: result.verdict.checks.map((check) => ({ ...check, state: check.id === 'current-player' ? 'FAIL' : 'PASS' })) } });
  const manifest = await stageEvidence({ observed: finalizedEvidence(mixed), root: directory, directory: staged, env: { PATH: process.env.PATH } });
  assert.equal(manifest.slots.find((slot) => slot.id === 'device-scores')?.caption, 'device scores. PASS');
  assert.equal(manifest.slots.find((slot) => slot.id === 'device-current-player')?.caption, 'device current-player. FAIL');
  assert.equal(manifest.slots.length, 7);
  assert.equal(manifest.slots.filter((slot) => slot.role === 'screenshot').length, 5);
  assert.deepEqual(await readFile(join(staged, 'device-original.mp4')), mp4);
  const playback = manifest.slots.find((slot) => slot.role === 'playback')!;
  assert.equal(playback.transform?.sourceSha256, digest(mp4));
  assert.equal(playback.transform?.frames, 18);
  assert.equal((await probeMedia(join(staged, playback.path), staged, { PATH: process.env.PATH })).frames, 18);
  assert.ok(!(await readdir(staged)).includes('private-log.json'));
  const body = renderEvidence(manifest, '<!-- test -->', manifest.slots, new Map(), 'pending');
  assert.ok(body.includes('timing normalized')); assert.ok(body.includes('search-back')); assert.ok(body.includes('current-player'));
  assert.ok(!body.includes('private-log'));
  await writeFile(join(directory, 'scores.png'), 'changed');
  await assert.rejects(stageEvidence({ observed: finalizedEvidence(result), root: directory, directory: join(directory, 'restaged'), env: { PATH: process.env.PATH } }));
});

test('details cannot activate mentions, images, HTML, markers, or signed query URLs', () => {
  const text = plain('@all <!-- fake --> ![x](https://bad/) <video> ``` |\nhttps://host/path?secret=token');
  assert.ok(!/[<>@`\n]/.test(text)); assert.ok(!text.includes('?secret=')); assert.ok(!text.includes('![x]('));
  const links = plain('https://example.com/path www.example.com someone@example.com');
  assert.ok(!links.includes('https://')); assert.ok(!links.includes('www.')); assert.ok(!links.includes('@')); 
  for (const url of ['https://github.com/user-attachments/assets/x?q=1', 'https://evil.com/user-attachments/assets/' + randomUUID(), 'http://github.com/user-attachments/assets/' + randomUUID(), 'https://x@github.com/user-attachments/assets/' + randomUUID()]) assert.throws(() => assetUrl(url));
});

test('result and publication gates preserve observed FAIL/PASS and keep manual runs artifact-only', async () => {
  const result = deviceResult();
  const immutable = finalizedEvidence(result);
  assert.ok(Object.isFrozen(immutable.result));
  if (!('kind' in immutable.result) && immutable.result.state !== 'INCONCLUSIVE') assert.ok(Object.isFrozen(immutable.result.verdict.checks));
  const receipt = deliverySchema.parse({ version: 1, state: 'partial' as const, observedState: 'PASS', manifestSha256: null, commentId: null, url: null, bodySha256: null, authorId: null, rendered: false, assets: [], missing: ['video'], reason: 'missing' });
  assert.equal(publicationStatus(result, receipt).state, 'INCONCLUSIVE'); assert.equal(publicationStatus(result, receipt).observed_state, 'PASS');
  const manual = resultSchema.parse({ ...result, target: { ...target, pullRequest: null } });
  assert.equal(destination(manual), null);
  const response = await publishEvidenceComment({ observed: finalizedEvidence(manual), root: media, cwd: media, env: {}, writer: null });
  assert.equal(response.state, 'artifact-only'); assert.equal(publicationStatus(manual, response).state, 'PASS');
  if (result.state === 'INCONCLUSIVE') throw new Error('Definitive fixture.');
  assert.throws(() => resultSchema.parse({ ...result, evidence: { ...result.evidence, screenshots: result.evidence.screenshots.slice(1) } }));
  assert.throws(() => resultSchema.parse({ ...result, cleanup: { state: 'unconfirmed', sessionId: result.session.id, expiresAt: result.session.expiresAt } }));
});

function qaFixture() {
  const device = deviceResult();
  if (device.state === 'INCONCLUSIVE') throw new Error('Fixture is definitive.');
  const ids = ['scores', 'current-player', 'search-back'] as const;
  return { version: 1, kind: 'qa', attemptId: randomUUID(), state: 'PASS', startedAt: 10, finishedAt: 100, runId, runUrl, target,
    model: { model: 'gpt-6.1-sol', effort: 'xhigh', serviceTier: 'priority' }, tools: device.tools, preparation: null, preparationDiagnostics: null,
    auth: 'persisted', server: { processId: 20, stop: { state: 'stopped', healthy: true, forced: false, exit: { code: 0, signal: null } } }, concurrent: true, reason: null,
    lanes: ids.map((id) => { const sessionId = randomUUID(), attemptId = randomUUID(), threadId = randomUUID(); return { id, state: 'PASS', attemptId,
      session: { ...device.session, id: sessionId, attemptId }, threadId, turn: { threadId, turnId: randomUUID(), requestedAt: 20, startedAt: 21, completedAt: 70, status: 'completed' },
      verdict: { id, state: 'PASS', detail: 'Observed.', screenshot: `${id}.png` }, identity: device.evidence.identity,
      screenshots: ['controller-start', id, 'controller-end'].map((name) => ref(`${name}.png`, png)), recording: device.evidence.recording,
      recordingSessionId: sessionId, cleanup: { state: 'stopped', sessionId }, deviceFailure: null, reason: null }; }) };
}
test('strict QA aggregate rejects duplicate lanes/sessions, unforced shutdown gaps, wrong screenshots, and fake concurrency', () => {
  const valid = qaFixture(); assert.equal(qaResultSchema.parse(valid).state, 'PASS');
  for (const mutate of [
    (x: typeof valid) => { x.lanes[1]!.id = x.lanes[0]!.id; },
    (x: typeof valid) => { x.lanes[1]!.session.id = x.lanes[0]!.session.id; },
    (x: typeof valid) => { x.server.stop.forced = true; },
    (x: typeof valid) => { x.lanes[0]!.screenshots.pop(); },
    (x: typeof valid) => { x.lanes[0]!.turn.startedAt = 80; x.lanes[0]!.turn.completedAt = 90; },
    (x: typeof valid) => { x.auth = 'write-back-failed'; },
  ]) { const changed = structuredClone(valid); mutate(changed); assert.throws(() => qaResultSchema.parse(changed)); }
});

async function readBody(request: IncomingMessage) { const parts: Buffer[] = []; for await (const part of request) parts.push(part); return JSON.parse(Buffer.concat(parts).toString()); }
async function apiFixture(mode: 'normal' | 'partial' | 'lost' | 'absent' | 'bad-hash' | 'hold' = 'normal', onCreate?: () => void) {
  const root = await mkdtemp(join(media, 'api-'));
  const comments: { id: number; body: string; html_url: string; user: { id: number }; body_html: string }[] = [];
  const originalAcceptance = acceptanceMarker(acceptanceSchema.parse({ version: 1, repository, target: { ref: 'main', sha: 'b'.repeat(40) }, issue: { number: 3, id: 7, nodeId: 'node', sha256: '1'.repeat(64) }, criteriaSha256: '2'.repeat(64) }));
  const pr = { number: 4, body: originalAcceptance + '\nOriginal criteria stay frozen.', head: { sha: sourceSha, ref: target.source.ref, repo: { full_name: repository } }, base: { repo: { full_name: repository } } };
  const assets = new Map<string, Buffer>(); const writes: string[] = []; let creates = 0; let uploads = 0;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json'); const path = new URL(req.url!, 'http://localhost').pathname;
    if (path === '/user') return res.end(JSON.stringify({ id: 17 }));
    if (path === '/repos/owner/repo') return res.end(JSON.stringify({ full_name: repository, private: false, permissions: { push: true } }));
    if (path === '/repos/owner/repo/pulls/4' && req.method === 'GET') return res.end(JSON.stringify(pr));
    if (path === '/repos/owner/repo/issues/4/comments' && req.method === 'GET') return res.end(JSON.stringify(comments));
    if (path === '/mock/attach') {
      const input = await readBody(req); creates++; const mappings: Record<string, string> = {};
      for (const [index, file] of input.files.entries()) {
        if (mode === 'absent' || mode === 'partial' && creates === 1 && index > 0 || mode === 'bad-hash') continue;
        const id = randomUUID(); assets.set(id, Buffer.from(file.bytes, 'base64')); mappings[file.path] = `https://github.com/user-attachments/assets/${id}`; uploads++;
      }
      let body: string = input.body;
      for (const [file, url] of Object.entries(mappings)) { body = body.replace(`![](${file})`, url).replaceAll(`](${file})`, `](${url})`); }
      if (mode !== 'absent') comments.push({ id: 100 + creates, body, html_url: `https://github.com/owner/repo/pull/4#issuecomment-${100 + creates}`, user: { id: 17 }, body_html: Object.values(mappings).map((url) => `<img src="${url}"><video src="${url}"></video>`).join('') });
      writes.push('native-create'); onCreate?.(); if (mode === 'hold') return; return res.end(JSON.stringify({ code: mode === 'normal' ? 0 : 1 }));
    }
    if (path.startsWith('/repos/owner/repo/issues/comments/')) {
      const found = comments.find((item) => item.id === Number(path.split('/').at(-1)));
      if (!found) { res.statusCode = 404; return res.end('{}'); }
      if (req.method === 'PATCH') { const data = await readBody(req); found.body = data.body; found.body_html = [...data.body.matchAll(/https:\/\/github.com\/user-attachments\/assets\/[a-f0-9-]+/g)].map((x: RegExpMatchArray) => `<img src="${x[0]}"><video src="${x[0]}"></video>`).join(''); writes.push('PATCH:' + found.id);
        if (mode === 'lost') { req.socket.destroy(); return; } }
      return res.end(JSON.stringify(found));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done)); const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No mock API.'); const apiBase = `http://127.0.0.1:${address.port}`;
  const native = join(root, 'native.mjs');
  await writeFile(native, `import fs from 'node:fs';
const args=process.argv.slice(2); const at=args.indexOf('--body-file'); const files=[];
for(let i=0;i<args.length;i++) if(args[i]==='--attach') {const path=args[++i]; files.push({path,bytes:fs.readFileSync(path).toString('base64')});}
const response=await fetch(process.env.MOCK_API+'/mock/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:fs.readFileSync(args[at+1],'utf8'),files})});
const receipt=await response.json(); process.exitCode=receipt.code;`);
  const launcher = join(root, 'gh'); await writeFile(launcher, '#!/bin/sh\nexec "$MOCK_NODE" "$MOCK_SCRIPT" "$@"\n', { mode: 0o700 });
  const env = { AGENT_GITHUB_WRITE_TOKEN: 'synthetic-controller-only', AGENT_TRUSTED_REPOSITORY: repository, AGENT_TRUSTED_AUTOMATION: 'enabled' };
  const writer: EvidenceWriter = { github: new GitHub({ repository, env, apiBase }), actor: 17, binarySha256: digest(await readFile(launcher)), gh: { file: launcher, args: [] }, directory: root,
    env: { MOCK_API: apiBase, MOCK_NODE: execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim(), MOCK_SCRIPT: native } };
  const slots: Slot[] = [
    { ...ref('scores.png', png), id: 'scores', role: 'screenshot', lane: 'device', caption: 'Scores PASS.', transform: null },
    { ...ref('playback.mp4', mp4), id: 'playback', role: 'playback', lane: 'device', caption: 'Edited playback, timing normalized.', transform: null },
    { ...ref('original.mp4', mp4), id: 'original', role: 'original', lane: 'device', caption: 'Unchanged original.', transform: null },
  ];
  for (const slot of slots) await writeFile(join(root, slot.path), slot.role === 'screenshot' ? png : mp4);
  const manifest: Manifest = { version: 1, origin: 'live', note: '', provenance: null, workflow: 'ci', runId, runUrl, attemptId: randomUUID(), state: 'PASS', target,
    destination: { kind: 'pr', repository, number: 4 }, summary: ['Agent observation. PASS.'], slots };
  const remote = { download: async (url: string) => { const value = assets.get(url.split('/').at(-1)!); if (!value) throw new Error('No anonymous asset.'); return value; } };
  const deliver = () => deliverManifest({ manifest, root, directory: root, writer, remote });
  return { root, manifest, comments, assets, writes, writer, pr, remote, deliver, stats: () => ({ creates, uploads }), close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) };
}

for (const mode of ['normal', 'partial', 'lost'] as const) test(`real native shell ${mode} writes reconcile and rerun reuses exact verified assets`, { timeout: 20_000 }, async () => {
  const api = await apiFixture(mode);
  try {
    const receipt = await api.deliver(); assert.equal(receipt.state, 'complete'); assert.equal(receipt.missing.length, 0);
    const stats = api.stats(); assert.equal(stats.creates, mode === 'partial' ? 2 : 1); assert.equal(stats.uploads, 3);
    assert.ok(api.comments[0]!.body.includes('Publication complete')); assert.ok(!api.comments[0]!.body.includes('](scores.png)'));
    assert.ok(api.comments[0]!.body.includes('\nhttps://github.com/user-attachments/assets/'));
    const second = await api.deliver(); assert.equal(second.commentId, receipt.commentId); assert.deepEqual(api.stats(), stats);
    assert.equal(second.state, 'complete');
  } finally { await api.close(); }
});

for (const moving of [false, true]) test(`TesterArmy manifest retains native acceptance destination protection, moving head ${moving}`, { timeout: 20_000 }, async () => {
  const api = await apiFixture();
  try {
    api.manifest.workflow = 'testerarmy';
    api.manifest.target = targetSchema.parse({ ...target, kind: 'acceptance',
      issue: { number: 3, id: 7, nodeId: 'node', sha256: '1'.repeat(64) },
      criteria: { path: 'demo/issues/player-label.md', sha256: '2'.repeat(64) } });
    const original = api.pr.body;
    if (moving) api.pr.head.sha = 'b'.repeat(40);
    const receipt = await api.deliver();
    assert.equal(receipt.state, moving ? 'unavailable' : 'complete');
    assert.equal(api.stats().creates, moving ? 0 : 1);
    assert.equal(api.pr.body, original);
    if (!moving) {
      assert.ok(api.comments[0]!.body.includes('TesterArmy e2e iOS: PASS'));
      assert.ok(api.comments[0]!.body.includes(':testerarmy:'));
      const writes = api.writes.length;
      const repeated = await api.deliver();
      assert.equal(repeated.state, 'complete');
      assert.equal(api.writes.length, writes);
    }
  } finally { await api.close(); }
});

test('an absent create response is retained as ambiguous and is never blindly retried', { timeout: 15_000 }, async () => {
  const api = await apiFixture('absent'); try {
    assert.equal((await api.deliver()).state, 'unavailable'); assert.equal((await api.deliver()).state, 'unavailable'); assert.equal(api.stats().creates, 1);
  } finally { await api.close(); }
});
test('bounded recovery removes local placeholders and preserves the observed verdict', { timeout: 15_000 }, async () => {
  const api = await apiFixture('bad-hash'); try {
    const delivery = await api.deliver(); assert.equal(delivery.state, 'partial'); assert.equal(delivery.observedState, 'PASS'); assert.equal(api.stats().creates, 3);
    assert.ok(!api.comments[0]!.body.includes('](scores.png)')); assert.ok(api.comments[0]!.body.includes('Missing media scores.'));
    await api.deliver(); assert.equal(api.stats().creates, 3);
  } finally { await api.close(); }
});
for (const conflict of ['foreign', 'duplicate', 'edited', 'manifest'] as const) test(`evidence ${conflict} conflict performs no additional write`, async () => {
  const api = await apiFixture(); try {
    await api.deliver(); const before = api.writes.length;
    if (conflict === 'foreign') api.comments[0]!.user.id = 999;
    if (conflict === 'duplicate') api.comments.push(structuredClone(api.comments[0]!));
    if (conflict === 'edited') api.comments[0]!.body += '\nHuman changed this.';
    if (conflict === 'manifest') api.manifest.summary.push('Changed immutable manifest.');
    await assert.rejects(api.deliver(), PublicationConflict); assert.equal(api.writes.length, before);
  } finally { await api.close(); }
});

test('same exact PR body and original acceptance marker survive the complete controller publisher', { timeout: 30_000 }, async () => {
  const api = await apiFixture();
  const { directory, result } = await fixture();
  try {
    const source = join(directory, 'source');
    await mkdir(join(source, '.eas/agents'), { recursive: true }); await mkdir(join(source, 'demo/fixtures'), { recursive: true });
    const criteria = 'Pinned generic CI criteria. The original issue acceptance remains in the PR body.';
    const fixtureText = 'Synthetic fixture bytes.';
    await writeFile(join(source, '.eas/agents/check-ios.md'), criteria); await writeFile(join(source, 'demo/fixtures/prizepicks-v1.json'), fixtureText);
    const live = resultSchema.parse({ ...result, target: { ...target, criteria: { ...target.criteria, sha256: digest(criteria) }, fixture: { ...target.fixture, sha256: digest(fixtureText) } } });
    const before = api.pr.body;
    const mismatch = resultSchema.parse({ ...live, target: { ...live.target, source: { ref: 'other', sha: sourceSha } } });
    const rejected = await publishEvidenceComment({ observed: finalizedEvidence(mismatch), root: directory, cwd: source, env: { PATH: process.env.PATH }, writer: api.writer, remote: api.remote });
    assert.equal(rejected.state, 'unavailable'); assert.equal(api.stats().creates, 0); assert.equal(api.pr.body, before);
    const observation = finalizedEvidence(live);
    const raw = JSON.stringify(live); await writeFile(join(directory, 'result.json'), raw);
    const published = await publishEvidenceComment({ observed: observation, root: directory, cwd: source, env: { PATH: process.env.PATH }, writer: api.writer, remote: api.remote });
    assert.equal(published.state, 'complete'); assert.equal(api.pr.body, before);
    assert.equal(await readFile(join(directory, 'result.json'), 'utf8'), raw);
    assert.ok(api.writes.every((write) => write === 'native-create' || /^PATCH:\d+$/.test(write)));
    assert.equal(observation.result.state, 'PASS');
  } finally { await api.close(); }
});

test('historical archive admission exercises synthetic archive attacks without importing any audited set', () => {
  execFileSync('python3', ['.eas/agents/evidence-archive.test.py'], { cwd: resolve('.'), env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 10_000, stdio: 'pipe' });
});
test('historical CLI refuses an arbitrary result directory and unknown audit set', async () => {
  const output = join(media, 'untrusted-import');
  assert.throws(() => execFileSync(process.execPath, ['.eas/agents/evidence-history.ts', 'import', 'arbitrary-set', media, output],
    { env: { PATH: process.env.PATH }, timeout: 10_000, stdio: 'pipe' }));
  await assert.rejects(readdir(output));
});

test('writer and exact official checksum readiness fail before any upload or model work', async () => {
  const api = await apiFixture();
  try {
    const env = { AGENT_GITHUB_WRITE_TOKEN: 'synthetic-controller-only', AGENT_TRUSTED_REPOSITORY: repository, AGENT_TRUSTED_AUTOMATION: 'enabled' };
    const address = api.writer.env.MOCK_API!;
    let downloads = 0;
    await assert.rejects(prepareEvidenceWriter({ repository, env: { ...env, AGENT_GITHUB_WRITE_TOKEN: '' }, directory: join(api.root, 'no-writer'), apiBase: address,
      download: async () => { downloads++; return Buffer.from('wrong'); } }));
    assert.equal(downloads, 0);
    await assert.rejects(prepareEvidenceWriter({ repository, env, directory: join(api.root, 'wrong-checksum'), apiBase: address,
      download: async () => { downloads++; return Buffer.from('wrong'); } }), /checksum pin/);
    assert.equal(downloads, 1); assert.equal(api.stats().creates, 0);
    assert.equal(ghPin.linux.archive, '57500f347b5e84efb6578c9b644eeb3b4e54046762635a939dd0ee2cca1c1add');
  } finally { await api.close(); }
});

test('a staged file changed before native upload is refused without a CLI write', async () => {
  const api = await apiFixture(); try {
    await writeFile(join(api.root, 'scores.png'), 'replaced after admission');
    const receipt = await api.deliver(); assert.equal(receipt.state, 'unavailable'); assert.equal(api.stats().creates, 0);
  } finally { await api.close(); }
});
test('a URL and native exit zero cannot substitute for anonymous byte hash verification', async () => {
  const api = await apiFixture(); try {
    api.remote.download = async () => Buffer.from('corrupt anonymous bytes');
    const receipt = await api.deliver(); assert.equal(receipt.state, 'partial'); assert.equal(receipt.missing.length, 3); assert.equal(api.stats().creates, 3);
    assert.ok(api.comments[0]!.body.includes('Missing media scores.'));
    assert.ok(!api.comments[0]!.body.includes('user-attachments/assets/'));
  } finally { await api.close(); }
});

test('an exact-ID patch refuses a same-author edit observed after reconciliation', async () => {
  const api = await apiFixture(); try {
    const receipt = await api.deliver(); const body = api.comments[0]!.body; const writes = api.writes.length;
    api.comments[0]!.body += '\nAn operator changed this comment.';
    await assert.rejects(api.writer.github.patchComment(receipt.commentId!, body + '\nPublisher patch.', 17, body), PublicationConflict);
    assert.equal(api.writes.length, writes);
  } finally { await api.close(); }
});


test('playback readiness encodes and fully validates a frame-preserving canary before work', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(media, 'canary-'));
  await verifyPlaybackReadiness(directory, { PATH: process.env.PATH });
  assert.deepEqual(await readdir(directory), []);
});

for (const [file, operation] of [['run.ts', 'triage'], ['qa-swarm.ts', 'run']]) test(`${file} requires the writer before loading subscription files or creating device output`, async () => {
  const directory = await mkdtemp(join(media, 'early-readiness-'));
  assert.throws(() => execFileSync(process.execPath, [resolve('.eas/agents', file!), operation!], { cwd: directory, timeout: 10_000, stdio: 'pipe',
    env: { PATH: process.env.PATH, AGENT_PR_NUMBER: '4', AGENT_TASK: 'triage', AGENT_REPOSITORY: repository, AGENT_TRUSTED_REPOSITORY: repository,
      AGENT_TRUSTED_AUTOMATION: 'enabled', CODEX_AUTH_JSON: join(directory, 'must-not-be-read.json') } }));
  await assert.rejects(readdir(join(directory, 'agent-output')));
});

async function liveFixture() {
  const data = await fixture();
  const source = join(data.directory, 'source');
  await mkdir(join(source, '.eas/agents'), { recursive: true });
  await mkdir(join(source, 'demo/fixtures'), { recursive: true });
  const criteria = 'Local regression criteria', fixtureText = 'Local regression fixture';
  await writeFile(join(source, '.eas/agents/check-ios.md'), criteria);
  await writeFile(join(source, 'demo/fixtures/prizepicks-v1.json'), fixtureText);
  const result = resultSchema.parse({ ...data.result, target: { ...target, criteria: { ...target.criteria, sha256: digest(criteria) }, fixture: { ...target.fixture, sha256: digest(fixtureText) } } });
  return { ...data, source, result };
}

test('moving live head after staging prevents the first native create and preserves the PR body', { timeout: 30_000 }, async () => {
  const api = await apiFixture(), data = await liveFixture();
  try {
    const comments = api.writer.github.comments.bind(api.writer.github);
    api.writer.github.comments = async (n, signal) => { api.pr.head.sha = 'b'.repeat(40); return comments(n, signal); };
    const before = api.pr.body;
    const receipt = await publishEvidenceComment({ observed: finalizedEvidence(data.result), root: data.directory, cwd: data.source,
      env: { PATH: process.env.PATH }, writer: api.writer, remote: api.remote });
    assert.equal(receipt.state, 'unavailable'); assert.equal(api.stats().creates, 0); assert.equal(api.pr.body, before);
    assert.ok((await readdir(data.directory)).some(name => name.startsWith('publication-receipt-')));
  } finally { await api.close(); }
});

test('absent rendered media keeps the public canonical comment partial', async () => {
  const api = await apiFixture();
  try {
    const exact = api.writer.github.exactComment.bind(api.writer.github);
    api.writer.github.exactComment = async (n, signal) => ({ ...await exact(n, signal), body_html: '' });
    const receipt = await api.deliver();
    assert.equal(receipt.state, 'partial'); assert.equal(receipt.rendered, false);
    assert.ok(api.comments[0]!.body.includes('Publication partial. Observed device verdict PASS.'));
    assert.ok(!api.comments[0]!.body.includes('Publication complete'));
  } finally { await api.close(); }
});

test('controller SIGTERM after staging stops new native writes and retains a receipt', { timeout: 30_000 }, async () => {
  const api = await apiFixture(), data = await liveFixture();
  const cancellation = new AbortController(), cancel = () => cancellation.abort();
  process.once('SIGTERM', cancel);
  try {
    const comments = api.writer.github.comments.bind(api.writer.github);
    api.writer.github.comments = async (n, signal) => {
      process.kill(process.pid, 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(cancellation.signal.aborted);
      return comments(n, signal);
    };
    const receipt = await publishEvidenceComment({ observed: finalizedEvidence(data.result), root: data.directory, cwd: data.source,
      env: { PATH: process.env.PATH }, writer: api.writer, remote: api.remote, phase: evidencePhase(cancellation.signal) });
    assert.ok(cancellation.signal.aborted); assert.equal(receipt.state, 'unavailable'); assert.deepEqual(api.writes, []);
    assert.ok((await readdir(data.directory)).some(name => name.startsWith('publication-receipt-')));
    assert.ok(!(await readdir(api.root)).some(name => name.startsWith('publication-intent-')));
  } finally { process.removeListener('SIGTERM', cancel); await api.close(); }
});

for (const when of ['native-create', 'recovery', 'final-patch', 'after-complete'] as const) test(`head change at ${when} leaves exact owned evidence stale and never current-complete`, async () => {
  const api = await apiFixture(when === 'recovery' ? 'partial' : 'normal');
  try {
    const before = api.pr.body;
    if (when === 'native-create') {
      const comments = api.writer.github.comments.bind(api.writer.github);
      api.writer.github.comments = async (n, signal) => { if (api.stats().creates) api.pr.head.sha = 'b'.repeat(40); return comments(n, signal); };
    } else if (when === 'recovery') {
      const download = api.remote.download;
      api.remote.download = async url => { const bytes = await download(url); api.pr.head.sha = 'b'.repeat(40); return bytes; };
    } else {
      const patch = api.writer.github.patchComment.bind(api.writer.github);
      api.writer.github.patchComment = async (...args) => {
        if (when === 'final-patch') api.pr.head.sha = 'b'.repeat(40);
        const value = await patch(...args);
        if (when === 'after-complete' && value.body.includes('Publication complete')) api.pr.head.sha = 'b'.repeat(40);
        return value;
      };
    }
    const receipt = await api.deliver();
    assert.equal(receipt.state, 'partial'); assert.equal(receipt.commentId, 101); assert.equal(api.stats().creates, 1);
    assert.ok(api.comments[0]!.body.includes('Publication stale.'));
    assert.ok(api.comments[0]!.body.includes('No current-head verdict is asserted.'));
    assert.ok(!api.comments[0]!.body.includes('Publication complete')); assert.equal(api.pr.body, before);
  } finally { await api.close(); }
});

test('historical backfill retains old-source semantics when the live head differs', async () => {
  const api = await apiFixture();
  try {
    api.manifest.origin = 'historical'; api.manifest.note = 'Old source observation.'; api.pr.head.sha = 'b'.repeat(40);
    const receipt = await api.deliver(); assert.equal(receipt.state, 'complete');
    assert.ok(api.comments[0]!.body.includes('Historical backfill')); assert.ok(api.comments[0]!.body.includes('No current-head verdict is asserted.'));
  } finally { await api.close(); }
});

test('a failed final readback reconciles the exact complete patch to partial', async () => {
  const api = await apiFixture();
  try {
    const exact = api.writer.github.exactComment.bind(api.writer.github); let failed = false;
    api.writer.github.exactComment = async (n, signal) => {
      const value = await exact(n, signal);
      if (!failed && value.body.includes('Publication complete')) { failed = true; throw new Error('Transient readback loss.'); }
      return value;
    };
    const receipt = await api.deliver(); assert.ok(failed); assert.equal(receipt.state, 'partial'); assert.equal(receipt.commentId, 101);
    assert.ok(api.comments[0]!.body.includes('Publication partial.')); assert.ok(!api.comments[0]!.body.includes('Publication complete'));
  } finally { await api.close(); }
});

for (const kind of ['cancel', 'deadline'] as const) test(`${kind} of an already-issued native create uses bounded reconciliation without recovery uploads`, { timeout: 15_000 }, async () => {
  const cancellation = new AbortController();
  const api = await apiFixture('hold', () => { if (kind === 'cancel') cancellation.abort(); });
  try {
    const start = Date.now();
    const receipt = await deliverManifest({ manifest: api.manifest, root: api.root, directory: api.root, writer: api.writer, remote: api.remote,
      phase: evidencePhase(cancellation.signal, kind === 'deadline' ? 500 : 10_000) });
    assert.equal(receipt.state, 'partial'); assert.equal(receipt.commentId, 101); assert.equal(api.stats().creates, 1);
    assert.ok(Date.now() - start < 12_000); assert.ok(!api.comments[0]!.body.includes('Publication complete'));
    assert.ok((await readdir(api.root)).some(name => name.startsWith('publication-intent-')));
    assert.ok((await readdir(api.root)).some(name => name.startsWith('publication-invocation-')));
    assert.ok((await readdir(api.root)).some(name => name.startsWith('publication-receipt-')));
    assert.ok(!(await readdir(api.root)).some(name => name.startsWith('body-')));
    const resumed = await api.deliver();
    assert.equal(resumed.state, 'complete'); assert.equal(resumed.commentId, 101); assert.equal(api.stats().creates, 1);
  } finally { await api.close(); }
});

test('anonymous production download carries cancellation without credentials and retains redirect/byte limits', async () => {
  const actual = globalThis.fetch, calls: { url: string; headers: HeadersInit | undefined }[] = [];
  const url = 'https://github.com/user-attachments/assets/' + randomUUID();
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers });
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private?token=synthetic' } });
    };
    await assert.rejects(publicBytes(url, 10), /Unsafe public download redirect/);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0]!.headers, { Accept: 'application/octet-stream' });
    globalThis.fetch = async () => new Response('oversized public bytes');
    await assert.rejects(publicBytes(url, 10), /exceeded limit/);
    let hops = 0;
    globalThis.fetch = async () => { hops++; return new Response(null, { status: 302, headers: { location: url } }); };
    await assert.rejects(publicBytes(url, 10), /redirect limit/); assert.equal(hops, 5);
    const cancellation = new AbortController();
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Cancelled download.')), { once: true });
      cancellation.abort();
    });
    await assert.rejects(publicBytes(url, 10, false, cancellation.signal), /Cancelled download/);
  } finally { globalThis.fetch = actual; }
});

test('live issue edits during reconciliation prevent creation using the original criteria', async () => {
  const api = await apiFixture();
  try {
    const criteria = 'Original issue criteria.';
    await mkdir(join(api.root, 'demo/issues'), { recursive: true });
    await writeFile(join(api.root, 'demo/issues/player-label.md'), criteria);
    const issue = { number: 3, id: 7, node_id: 'node', title: 'Synthetic label issue', state: 'open', body: demoIssueMarker,
      updated_at: '2026-10-29T00:00:00Z', html_url: 'https://github.com/owner/repo/issues/3', author_association: 'OWNER' } satisfies Parameters<typeof issueDigest>[0];
    api.manifest.target = targetSchema.parse({ ...target, kind: 'triage', issue: { number: 3, id: 7, nodeId: 'node', sha256: issueDigest(issue) },
      criteria: { path: 'demo/issues/player-label.md', sha256: digest(criteria) } });
    api.manifest.destination = { kind: 'issue', repository, number: 3 }; api.manifest.workflow = 'triage';
    const get = api.writer.github.get.bind(api.writer.github);
    api.writer.github.get = async (path, signal) => path === '/issues/3' ? structuredClone(issue) : get(path, signal);
    api.writer.github.comments = async () => { issue.body += '\nChanged report.'; return []; };
    const receipt = await api.deliver(); assert.equal(receipt.state, 'unavailable'); assert.deepEqual(api.writes, []);
  } finally { await api.close(); }
});

test('the old-capability production path uses metadata-free decoded frames without inherited frame-rate metadata', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(media, 'legacy-media-')), bin = join(directory, 'bin');
  await mkdir(bin); await copyFile(join(media, 'session.mp4'), join(directory, 'original.mp4'));
  const ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
  await writeFile(join(bin, 'ffmpeg'), `#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
if args==['-hide_banner','-h','filter=setpts']: print('setpts expr string'); sys.exit(0)
if args==['-hide_banner','-h','full']: print('-fps_mode -vsync'); sys.exit(0)
os.execv(${JSON.stringify(ffmpeg)},[${JSON.stringify(ffmpeg)}]+args)
`, { mode: 0o700 });
  const derived = await derivePlayback({ directory, original: 'original.mp4', output: 'playback.mp4', env: { PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(derived.transform.frames, 18); assert.ok(derived.transform.decoderArgs);
  assert.equal(digest(await readFile(join(directory, 'original.mp4'))), digest(mp4));
  assert.ok(!(await readdir(directory)).includes('decoded-frames.yuv'));
});

test('cancellation bounds media readiness and staging, cleans temporary staging and preserves the original result', { timeout: 15_000 }, async () => {
  const api = await apiFixture(), data = await liveFixture();
  try {
    const bin = join(data.directory, 'bin'); await mkdir(bin);
    const receiptPath = join(data.directory, 'command-cwd.json');
    await writeFile(join(bin, 'ffmpeg'), `#!/bin/sh\npwd > '${receiptPath}'\nexec sleep 30\n`, { mode: 0o700 });
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const raw = JSON.stringify(data.result); await writeFile(join(data.directory, 'result.json'), raw);
    const start = Date.now();
    const receipt = await publishEvidenceComment({ observed: finalizedEvidence(data.result), root: data.directory, cwd: data.source, env,
      writer: api.writer, remote: api.remote, phase: evidencePhase(undefined, 500) });
    assert.equal(receipt.state, 'unavailable'); assert.deepEqual(api.writes, []); assert.ok(Date.now() - start < 12_000);
    assert.equal(await readFile(join(data.directory, 'result.json'), 'utf8'), raw);
    const staged = (await readFile(receiptPath, 'utf8')).trim(); await assert.rejects(readdir(staged));
    const ready = join(data.directory, 'readiness'); await mkdir(ready);
    await assert.rejects(verifyPlaybackReadiness(ready, env, evidencePhase(undefined, 500)));
    assert.deepEqual(await readdir(ready), []);
  } finally { await api.close(); }
});

test('cancelling FIFO creation cleans readiness and allows retry', { timeout: 30000 }, async () => {
const root=await mkdtemp(join(tmpdir(),'lob-fifo-create-review-')),bin=join(root,'bin'),directory=join(root,'tools');
await mkdir(bin);await mkdir(directory);
const native=execFileSync('which',['ffmpeg'],{encoding:'utf8'}).trim();
await writeFile(join(bin,'ffmpeg'),`#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
if args==['-hide_banner','-h','filter=setpts']: print('setpts expr string'); sys.exit(0)
os.execv(${JSON.stringify(native)},[${JSON.stringify(native)}]+args)
`,{mode:0o700});
const env={PATH:`${bin}:${process.env.PATH}`};
const cancellation=new AbortController();
const watcher=watch(directory,(_event,name)=>{if(name==='decoded-frames.yuv') cancellation.abort();});
try {
 let first:unknown;try{await verifyPlaybackReadiness(directory,env,evidencePhase(cancellation.signal,10000));}catch(error){first=error;}
 watcher.close();
 const afterCancellation=await readdir(directory);
 let retry:unknown;try{await verifyPlaybackReadiness(directory,env,evidencePhase(undefined,10000));}catch(error){retry=error;}
 const receipt={cancelled:cancellation.signal.aborted,firstError:first instanceof Error?first.message:null,afterCancellation,retryError:retry instanceof Error?retry.message:null,afterRetry:await readdir(directory)};


 assert.equal(cancellation.signal.aborted,true);
 assert.deepEqual(afterCancellation, []);
 assert.deepEqual(receipt.afterRetry, []);
 assert.equal(receipt.retryError, null);
}finally{watcher.close();await rm(root,{recursive:true,force:true});}

});
