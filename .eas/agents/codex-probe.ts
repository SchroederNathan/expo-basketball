import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { persistSubscription, seedSubscription, subscriptionConfig } from './auth';
import { CodexServer, codexCommand, codexModel, concurrentReceipts } from './codex-server';
import { safeEnvironment, type Command } from './process';

const proofSchema = z.strictObject({ marker: z.uuid(), threadId: z.string().min(1), cwd: z.string(),
  startedAt: z.number().int().positive(), completedAt: z.number().int().positive() });
const answerSchema = z.strictObject({ marker: z.uuid(), threadId: z.string().min(1) });
const easCommand: Command = { file: 'bunx', args: ['eas-cli@25.3.0'] };

export async function probe({ env, cwd, output, signal, codex = codexCommand, eas = easCommand, timeoutMs = 120_000 }: {
  env: NodeJS.ProcessEnv; cwd: string; output: string; signal: AbortSignal; codex?: Command; eas?: Command; timeoutMs?: number;
}) {
  const subscription = subscriptionConfig(env);
  if (!env.EXPO_TOKEN) throw new Error('EXPO_TOKEN is required for secure subscription writeback.');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'lob-codex-probe-')));
  const controllerEnv = { ...safeEnvironment(env), EXPO_TOKEN: env.EXPO_TOKEN, CI: '1', EAS_NO_VCS: '1' };
  let server: CodexServer | null = null;
  let authFile: string | null = null;
  let persisted = false;
  let stopped = false;
  let serverStop: Awaited<ReturnType<CodexServer['close']>> | null = null;
  let verified = false;
  let problem: string | null = null;
  const lanes: { lane: number; threadId: string; environmentVerified: boolean }[] = [];
  try {
    const auth = await seedSubscription({ seedFile: subscription.file, directory: join(directory, 'codex') });
    authFile = auth.file;
    await persistSubscription({ file: authFile, eas, cwd, env: controllerEnv, timeoutMs: 60_000 });
    signal.throwIfAborted();
    await mkdir(join(directory, 'home'));
    server = new CodexServer({ executable: codex, cwd: directory,
      env: { ...safeEnvironment(env), HOME: join(directory, 'home'), CODEX_HOME: join(directory, 'codex') } });
    await server.initialize();
    const client = server;
    const tasks = await Promise.allSettled([0, 1, 2].map(async (lane) => {
      const laneDirectory = join(directory, `lane-${lane}`);
      const marker = randomUUID();
      await mkdir(laneDirectory);
      await mkdir(join(laneDirectory, 'home'));
      await writeFile(join(laneDirectory, 'probe.mjs'), `import { writeFileSync } from 'node:fs';
const startedAt = Date.now();
await new Promise((done) => setTimeout(done, 1200));
const proof = { marker: process.env.QA_LANE_MARKER, threadId: process.env.CODEX_THREAD_ID,
  cwd: process.cwd(), startedAt, completedAt: Date.now() };
writeFileSync('environment.json', JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ marker: proof.marker, threadId: proof.threadId }));
`);
      const threadId = await client.startThread(laneDirectory, {
        PATH: env.PATH ?? '', HOME: join(laneDirectory, 'home'), QA_LANE_MARKER: marker,
      });
      const record = { lane, threadId, environmentVerified: false };
      lanes.push(record);
      return { laneDirectory, marker, record };
    }));
    if (tasks.some((task) => task.status === 'rejected')) throw new Error('Thread setup failed.');
    const turns = await Promise.allSettled(tasks.map(async (task) => {
      if (task.status !== 'fulfilled') throw new Error('Missing thread.');
      const { laneDirectory, marker, record } = task.value;
      const result = await client.runTurn({ threadId: record.threadId, signal, timeoutMs,
        prompt: 'Run node probe.mjs exactly once in your current working directory using the shell tool with login disabled. Do not edit the script, set or change environment variables, or read any other files. Return only its marker and threadId as the required JSON object.',
        outputSchema: z.toJSONSchema(answerSchema) });
      const answer = answerSchema.parse(JSON.parse(result.text));
      const file = join(laneDirectory, 'environment.json');
      const stat = await lstat(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || await realpath(file) !== file ||
        stat.mtimeMs < result.receipt.requestedAt - 1000) throw new Error('Unsafe environment proof.');
      const proof = proofSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (proof.marker !== marker || answer.marker !== marker || proof.threadId !== record.threadId ||
        answer.threadId !== record.threadId || proof.cwd !== laneDirectory ||
        proof.startedAt < result.receipt.requestedAt || proof.completedAt < proof.startedAt ||
        proof.completedAt > result.receipt.completedAt!) throw new Error('Environment proof disagrees with the controller.');
      record.environmentVerified = true;
    }));
    verified = turns.every((turn) => turn.status === 'fulfilled') && concurrentReceipts(client.receipts());
    if (!verified) problem = 'Three isolated shell environments and overlapping completed turns were not proved.';
  } catch { problem = 'The authenticated concurrency probe did not complete.'; }
  finally {
    if (server) {
      serverStop = await server.close();
      stopped = serverStop.state === 'stopped' && serverStop.healthy && !serverStop.forced;
    }
    if (authFile) {
      try { await persistSubscription({ file: authFile, eas, cwd, env: controllerEnv, timeoutMs: 60_000 }); persisted = true; }
      catch { problem = 'Subscription writeback failed. Reseed before another run.'; }
    }
    try { await rm(directory, { recursive: true, force: true }); }
    catch { problem = 'Private probe directory cleanup failed.'; }
  }
  if (!stopped) problem ??= 'Server shutdown was not verified as clean.';
  const receipt = { version: 1, state: verified && stopped && persisted && !problem ? 'PASS' : 'INCONCLUSIVE',
    scope: 'subscription app-server concurrency only; no remote device or app verified',
    codex: '0.165.0', ...codexModel, processId: server?.pid ?? null, serverStop, authPersisted: persisted,
    lanes: lanes.sort((a, b) => a.lane - b.lane), turns: server?.receipts() ?? [], reason: problem };
  await writeFile(output, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  process.once('SIGTERM', () => cancellation.abort());
  const output = resolve(process.argv[2] ?? 'qa-concurrency-receipt.json');
  probe({ env: process.env, cwd: process.cwd(), output, signal: cancellation.signal }).then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    process.exitCode = receipt.state === 'PASS' ? 0 : 2;
  }).catch(() => { process.stderr.write('Probe failed. No verified receipt is available.\n'); process.exitCode = 2; });
}
