import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { codexCommand, threadParameters, turnParameters } from './codex-server';
import { command, succeeded } from './process';

test('pinned binary schemas support every client request and consumed event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lob-protocol-test-'));
  const env = { PATH: process.env.PATH, HOME: root, CODEX_HOME: join(root, 'codex') };
  try {
    await mkdir(env.CODEX_HOME);
    const version = await command({ executable: codexCommand, args: ['--version'], cwd: root, env, timeoutMs: 30_000 });
    assert.equal(version.stdout.trim(), 'codex-cli 0.165.0');
    const generated = await command({ executable: codexCommand, args: ['app-server', 'generate-json-schema', '--out', join(root, 'schema')],
      cwd: root, env, timeoutMs: 30_000 });
    assert.ok(succeeded(generated));
    const schema = async (name: string) => JSON.parse(await readFile(join(root, 'schema', name), 'utf8'));
    const thread = await schema('v2/ThreadStartParams.json');
    for (const key of Object.keys(threadParameters(root, { QA_LANE_MARKER: 'synthetic' }))) assert.ok(Object.hasOwn(thread.properties, key), key);
    assert.equal(thread.properties.config.additionalProperties, true);
    assert.ok(thread.definitions.SandboxMode.enum.includes('danger-full-access'));
    assert.ok(thread.definitions.AskForApproval.oneOf.some((entry: { enum?: string[] }) => entry.enum?.includes('never')));
    const turn = await schema('v2/TurnStartParams.json');
    for (const key of Object.keys(turnParameters('thread-1', 'Check the device.', { type: 'object' }))) assert.ok(Object.hasOwn(turn.properties, key), key);
    assert.deepEqual(turn.required, ['input', 'threadId']);
    assert.equal(turn.definitions.ReasoningEffort.type, 'string');
    assert.equal(turn.definitions.ReasoningEffort.minLength, 1);
    const complete = await schema('v2/TurnCompletedNotification.json');
    assert.deepEqual(complete.required, ['threadId', 'turn']);
    assert.deepEqual(complete.definitions.TurnStatus.enum, ['completed', 'interrupted', 'failed', 'inProgress']);
    const item = await schema('v2/ItemCompletedNotification.json');
    assert.ok(item.required.includes('threadId') && item.required.includes('turnId'));
    const message = item.definitions.ThreadItem.oneOf.find((entry: { title: string }) => entry.title === 'AgentMessageThreadItem');
    assert.deepEqual(message.required, ['id', 'text', 'type']);
    const interrupt = await schema('v2/TurnInterruptParams.json');
    assert.deepEqual(interrupt.required, ['threadId', 'turnId']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the pinned app-server loads per-thread shell policy overrides before any model turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lob-config-proof-'));
  await mkdir(join(root, 'codex'));
  const child = spawn(codexCommand.file, [...codexCommand.args, 'app-server', '--listen', 'stdio://',
    '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: join(root, 'codex') },
    stdio: ['pipe', 'pipe', 'pipe'], detached: true,
  });
  const exited = new Promise<void>((done) => child.once('close', () => done()));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const deadline = setTimeout(() => { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }, 20_000);
  try {
    const proof = await new Promise<boolean>((done, reject) => {
      child.once('error', () => reject(new Error('Pinned binary unavailable.')));
      child.once('close', () => done(false));
      lines.on('line', (line) => {
        const message = JSON.parse(line);
        if (message.id === 1 && message.result) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'thread/start', params: { ...threadParameters(root, {}),
            config: { shell_environment_policy: { inherit: 'intentionally-invalid-inherit' } } } });
        } else if (message.id === 2) {
          done(typeof message.error?.message === 'string' && /intentionally-invalid-inherit/.test(message.error.message));
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'lob_config_proof', version: '1' } } });
    });
    assert.equal(proof, true, 'The actual thread config loader must reject the supplied shell policy value.');
  } finally {
    child.stdin.end();
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    await exited;
    clearTimeout(deadline);
    lines.close();
    await rm(root, { recursive: true, force: true });
  }
});
