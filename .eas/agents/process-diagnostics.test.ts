import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { command, succeeded, type Command } from './process';

const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const invoke = (script: string, processObserver?: Command) => command({ executable: { file: node, args: ['-e', script] },
  args: [], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, timeoutMs: 5000, processObserver });

for (const [observer, issue] of [
  [{ file: '/nonexistent/synthetic-secret', args: [] }, 'observer-unavailable'],
  [{ file: '/bin/sh', args: ['-c', 'exit 7'] }, 'observer-failed'],
  [{ file: '/bin/sh', args: ['-c', 'printf synthetic-secret'] }, 'observer-invalid-output'],
  [{ file: '/bin/sh', args: ['-c', 'exec /bin/sleep 5'] }, 'observer-timeout'],
] as const) {
  test(`an exact version and exit zero stay unsuccessful with ${issue}`, async () => {
    const result = await invoke("process.stdout.write('exact-version\\n')", { file: observer.file, args: [...observer.args] });
    assert.equal(succeeded(result), false);
    assert.equal(result.termination.kind, 'signal');
    assert.equal(result.stdout, 'exact-version\n');
    assert.equal(result.observation.trigger, 'exit');
    assert.equal(result.observation.exitCode, 0);
    assert.equal(result.observation.signal, null);
    assert.deepEqual(result.observation.cleanup, { confirmed: false, forced: false, issue,
      rootExited: true, streamsClosed: true, liveProcesses: 0 });
    assert.ok(result.observation.elapsedMs < 3500);
    assert.ok(!JSON.stringify(result.observation).includes('synthetic-secret'));
  });
}

test('a failed child exit remains visible when cleanup is also unconfirmed', async () => {
  const result = await invoke('process.exit(9)', { file: '/bin/sh', args: ['-c', 'exit 7'] });
  assert.equal(succeeded(result), false);
  assert.equal(result.termination.kind, 'signal');
  assert.equal(result.observation.exitCode, 9);
  assert.equal(result.observation.cleanup.confirmed, false);
});

test('spawn errors have an allowlisted errno with no command or error text', async () => {
  const result = await command({ executable: { file: '/nonexistent/synthetic-secret', args: [] }, args: [],
    cwd: tmpdir(), env: {}, timeoutMs: 2000 });
  assert.equal(result.observation.trigger, 'spawn-error');
  assert.equal(result.observation.spawnError, 'ENOENT');
  assert.equal(result.observation.exitCode, null);
  assert.equal(result.observation.cleanup.confirmed, true);
  assert.ok(!JSON.stringify(result.observation).includes('synthetic-secret'));
});

for (const cancelled of [false, true]) {
  test(`diagnostics distinguish ${cancelled ? 'cancellation' : 'deadline'} from the cleanup kill signal`, async () => {
    const cancellation = new AbortController();
    const timer = cancelled ? setTimeout(() => cancellation.abort(), 200) : undefined;
    try {
      const result = await command({ executable: { file: node, args: ['-e', 'setInterval(() => {}, 1000)'] }, args: [],
        cwd: tmpdir(), env: {}, timeoutMs: cancelled ? 5000 : 200, signal: cancellation.signal });
      assert.equal(result.observation.trigger, cancelled ? 'cancelled' : 'timeout');
      assert.equal(result.observation.exitCode, null);
      assert.equal(result.observation.signal, 'SIGKILL');
      assert.equal(result.observation.cleanup.confirmed, true);
      assert.equal(result.observation.cleanup.forced, true);
      assert.equal(succeeded(result), false);
    } finally { clearTimeout(timer); }
  });
}

test('output overflow has a distinct trigger and cannot pass', async () => {
  const result = await invoke("process.stdout.write('x'.repeat(8_100_000)); setInterval(() => {}, 1000)");
  assert.equal(result.observation.trigger, 'output-limit');
  assert.equal(result.observation.cleanup.confirmed, true);
  assert.equal(succeeded(result), false);
  assert.ok(result.stdout.length <= 8_000_000);
});
