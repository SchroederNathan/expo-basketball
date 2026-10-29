import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
      assert.deepEqual(await server.close(), { state: 'stopped', forced: false, healthy: true, exit: { code: 0, signal: null } });
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

for (const mode of ['shutdown-exit-7', 'shutdown-signal']) {
  test(`${mode} cannot certify a healthy server`, async () => {
    await scenario(mode, async (server, threads) => {
      await Promise.all(threads.map((threadId) => turn(server, threadId)));
      const stop = await server.close();
      assert.equal(stop.state, 'stopped');
      assert.equal(stop.healthy, false);
      assert.deepEqual(stop.exit, mode.endsWith('exit-7') ? { code: 7, signal: null } : { code: null, signal: 'SIGTERM' });
    });
  });
}

for (const mode of ['detached', 'detached-pipe', 'detached-fatal', 'detached-pipe-fatal', 'ignore-eof']) {
  test(`${mode} stops all owned groups within the shutdown bound`, async () => {
    await scenario(mode, async (server, threads, root) => {
      await Promise.allSettled(threads.map((threadId) => turn(server, threadId)));
      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stop = await Promise.race([
          server.close(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Shutdown exceeded its bound.')), 2000); }),
        ]);
        assert.equal(stop.state, 'stopped');
        assert.equal(stop.healthy, false);
        const events = (await readFile(join(root, 'log.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        for (const event of events.filter((event) => event.tool === 'descendant')) {
          assert.throws(() => process.kill(event.pid, 0), 'Detached descendant must be gone when close resolves.');
        }
        assert.ok(Date.now() - startedAt < 2000);
      } finally {
        clearTimeout(timer);
        const events = (await readFile(join(root, 'log.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        for (const event of events.filter((event) => event.tool === 'descendant')) {
          try { process.kill(event.pid, 'SIGKILL'); } catch {}
        }
      }
    });
  });
}

test('descendant cleanup leaves an unrelated process group running', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore', env: { PATH: process.env.PATH },
  });
  const exited = new Promise<void>((done) => unrelated.once('close', () => done()));
  try {
    await scenario('detached-fatal', async (server, threads) => {
      await Promise.allSettled(threads.map((threadId) => turn(server, threadId)));
      assert.equal((await server.close()).state, 'stopped');
      process.kill(unrelated.pid!, 0);
    });
  } finally {
    if (unrelated.pid) { try { process.kill(-unrelated.pid, 'SIGKILL'); } catch {} }
    await exited;
  }
});
