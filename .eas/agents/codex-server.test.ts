import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexServer, concurrentReceipts } from './codex-server';

const directories: string[] = [];
after(async () => { await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))); });

async function scenario(mode: string, run: (server: CodexServer, threads: string[], root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lob-server-test-'));
  directories.push(root);
  const config = join(root, 'config.json');
  await writeFile(config, JSON.stringify({ mode, log: join(root, 'log.jsonl') }));
  const server = new CodexServer({ executable: { file: process.execPath, args: [resolve('.eas/agents/qa-test-fixture.mjs'), config, 'server'] },
    cwd: root, env: { PATH: process.env.PATH, HOME: root }, requestMs: 500, stopMs: 500 });
  try {
    await server.initialize();
    const threads = await Promise.all(['alpha', 'beta', 'gamma'].map(async (name) => {
      const cwd = join(root, name);
      await mkdir(cwd);
      return server.startThread(cwd, { PATH: process.env.PATH ?? '', QA_LANE_MARKER: name });
    }));
    await run(server, threads, root);
  } finally {
    await server.close();
    assert.throws(() => process.kill(server.pid!, 0));
    const log = (await readFile(join(root, 'log.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    for (const event of log.filter((event) => event.tool === 'descendant')) {
      assert.throws(() => process.kill(event.pid, 0), 'Owned descendant must stop with the server.');
    }
  }
}

function turn(server: CodexServer, threadId: string, signal = new AbortController().signal, timeoutMs = 1000) {
  return server.runTurn({ threadId, prompt: 'Read your marker.', outputSchema: { type: 'object' }, timeoutMs, signal });
}

for (const mode of ['normal', 'fragmented', 'early-notifications']) {
  test(`interleaved RPC responses and ${mode} notifications keep lanes separate`, async () => {
    await scenario(mode, async (server, threads, root) => {
      const results = await Promise.all(threads.map((threadId) => turn(server, threadId)));
      assert.deepEqual(results.map((result) => JSON.parse(result.text).marker), ['alpha', 'beta', 'gamma']);
      assert.equal(concurrentReceipts(server.receipts()), true);
      assert.equal(new Set(server.receipts().map((r) => r.turnId)).size, 3);
      const log = await readFile(join(root, 'log.jsonl'), 'utf8');
      assert.equal(log.split('\n').filter((line) => line.includes('"tool":"server"')).length, 1);
      await assert.rejects(turn(server, threads[0]!));
    });
  });
}

for (const mode of ['failed-turn', 'missing-start', 'timeout', 'missing-turn', 'mismatched-turn', 'exit-mid-turn', 'interactive']) {
  test(`${mode} cannot yield three completed turns`, async () => {
    await scenario(mode, async (server, threads) => {
      const results = await Promise.allSettled(threads.map((threadId) => turn(server, threadId, undefined, 250)));
      assert.ok(results.some((result) => result.status === 'rejected'));
      assert.equal(concurrentReceipts(server.receipts()), false);
      if (['failed-turn', 'timeout', 'missing-turn'].includes(mode)) assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    });
  });
}

test('cancellation interrupts one lane and collects the others', async () => {
  await scenario('cancel', async (server, threads, root) => {
    const cancellation = new AbortController();
    const results = threads.map((threadId, i) => turn(server, threadId, i === 0 ? cancellation.signal : undefined));
    setTimeout(() => cancellation.abort(), 60);
    const settled = await Promise.allSettled(results);
    assert.equal(settled[0]!.status, 'rejected');
    assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 2);
    assert.match(await readFile(join(root, 'log.jsonl'), 'utf8'), /turn\/interrupt/);
  });
});

test('missing initialize response times out and the owned process is reaped', async () => {
  await assert.rejects(scenario('request-timeout', async () => assert.fail('Should not start threads.')));
});

test('a process exit during initialization rejects pending requests', async () => {
  await assert.rejects(scenario('server-exit', async () => assert.fail('Should not start threads.')));
});

test('duplicate thread identities are rejected', async () => {
  await assert.rejects(scenario('duplicate-thread', async () => assert.fail('Should not start turns.')));
});
