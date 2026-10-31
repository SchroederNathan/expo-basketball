import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { preflight } from '../preflight';
import { command, safeEnvironment, succeeded, type Command } from '../process';
import { buildIdSchema, publishFile, sanitize, shaSchema, targetSchema, type Target } from '../result';
import { readAppRuntime, verifyBuild, writeSimulatorProject } from '../simulator';
import { evidencePhase } from '../evidence-phase';
import { prepareEvidenceWriter, type EvidenceWriter } from '../evidence-tools';
import { finalizeSubscription, oauthSchema, persistSubscription, runnerEnvironment, seedSubscription, subscriptionConfig } from './auth';
import { contextSchema } from './context';
import { publishTesterArmyEvidence } from './evidence';
import { projectId, readLedger, reconcileOwned, sessionControl, type Cleanup, type Ledger } from './provider';
import { admitEvidence, admitReport, verifyReplay } from './report';
import { publicationStatus, testerArmyResultSchema, toolVersions, type TesterArmyResultV1 } from './result';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const eas: Command = { file: 'bunx', args: ['eas-cli@25.3.0'] };
const node: Command = { file: 'node', args: [] };
type Options = { cwd: string; outputRoot: string; env: NodeJS.ProcessEnv; signal: AbortSignal;
  cache?: z.infer<typeof contextSchema>['cache']; refreshedFile?: string };

export async function verifyRuntimePins() {
  for (const [name, version] of Object.entries({ e2e: toolVersions.e2e, '@e2e-dev/mobile': toolVersions.mobile,
    '@e2e-dev/eas': toolVersions.easProvider, ai: toolVersions.ai, '@ai-sdk/openai': toolVersions.openai,
    'agent-device': toolVersions.agentDevice })) {
    const metadata = z.object({ version: z.literal(version) }).safeParse(JSON.parse(await readFile(join(packageDirectory, 'node_modules', name, 'package.json'), 'utf8')));
    if (!metadata.success) throw new Error('Installed e2e tool differs from the frozen pins.');
  }
}

export async function runWorker({ cwd, env, abortFile, signal, gracefulMs = 1_140_000, hardMs = 1_290_000,
  executable = node, worker = join(packageDirectory, 'worker.mjs') }: {
  cwd: string; env: NodeJS.ProcessEnv; abortFile: string; signal: AbortSignal; gracefulMs?: number; hardMs?: number; executable?: Command; worker?: string;
}) {
  const hard = new AbortController();
  let abortRequested = false;
  let forcedTimer: ReturnType<typeof setTimeout> | undefined;
  const requestAbort = () => {
    abortRequested = true;
    void writeFile(abortFile, 'abort', { mode: 0o600 }).catch(() => hard.abort());
    forcedTimer ??= setTimeout(() => hard.abort(), 120_000);
  };
  const graceful = setTimeout(requestAbort, gracefulMs);
  signal.addEventListener('abort', requestAbort, { once: true });
  if (signal.aborted) requestAbort();
  try {
    const result = await command({ executable, args: [worker], cwd, env, timeoutMs: hardMs, signal: hard.signal });
    return { ...result, abortRequested };
  } finally { clearTimeout(graceful); clearTimeout(forcedTimer); signal.removeEventListener('abort', requestAbort); }
}

export function admitWorkerReport(run: Awaited<ReturnType<typeof runWorker>>, report: unknown, ledger: Ledger | null, target: Target) {
  const { cleanup } = run.observation;
  if (!ledger || run.abortRequested || run.termination.kind !== 'exited' || run.observation.signal !== null ||
    cleanup.forced || !cleanup.confirmed || !cleanup.rootExited || !cleanup.streamsClosed || cleanup.liveProcesses !== 0) {
    throw new Error('Runner completion, shutdown, or lease identity is unconfirmed.');
  }
  return admitReport(report, ledger, target, run.observation.exitCode ?? -1);
}

async function runtime(directory: string, context: z.infer<typeof contextSchema>) {
  await mkdir(join(directory, 'tests'), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'package.json'), '{"name":"lob-testerarmy-attempt","private":true,"type":"module"}', { mode: 0o600 });
  await symlink(join(packageDirectory, 'node_modules'), join(directory, 'node_modules'), 'dir');
  for (const name of ['context', 'e2e.config']) {
    await writeFile(join(directory, `${name}.ts`), `export ${name === 'context' ? '*' : '{ default }'} from ${JSON.stringify(join(packageDirectory, `${name}.ts`))};\n`, { mode: 0o600 });
  }
  await copyFile(join(packageDirectory, 'tests/jordan.e2e.ts'), join(directory, 'tests/jordan.e2e.ts'));
  const file = join(directory, 'context.json');
  await writeFile(file, JSON.stringify(contextSchema.parse(context)), { flag: 'wx', mode: 0o600 });
  return file;
}

export async function executeTesterArmy(options: Options) {
  const startedAt = new Date().toISOString();
  const attemptId = randomUUID();
  const root = join(options.outputRoot, 'public', attemptId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const privateDirectory = await mkdtemp(join(tmpdir(), 'lob-testerarmy-'));
  const ledgerFile = join(privateDirectory, 'lease.json');
  const xdg = join(privateDirectory, 'xdg');
  const task = join(privateDirectory, 'task');
  const device = join(privateDirectory, 'device');
  await mkdir(device, { mode: 0o700 });
  let target: Target | null = null;
  let ledger: Ledger | null = null;
  let cleanup: Cleanup = { state: 'not-needed' };
  let auth: TesterArmyResultV1['auth'] = 'not-loaded';
  let authFile: string | null = null;
  let execution: Parameters<typeof finalizeSubscription>[0]['execution'] = 'not-started';
  let termination: TesterArmyResultV1['termination'] = { kind: 'not-started' };
  let admission: ReturnType<typeof admitReport> | null = null;
  let evidence: TesterArmyResultV1['evidence'] = null;
  let writer: EvidenceWriter | null = null;
  let problem = '';
  const secrets = Object.entries(options.env).filter(([key]) => /TOKEN|SECRET|KEY|AUTH/.test(key)).flatMap(([, value]) => value ? [value] : []);
  const controllerEnv = { ...safeEnvironment(options.env), EXPO_TOKEN: options.env.EXPO_TOKEN, CI: '1', EAS_NO_VCS: '1' };
  try {
    const prepared = await preflight({ cwd: options.cwd, env: options.env });
    if (prepared.task !== 'acceptance' || !prepared.issue) throw new Error('TesterArmy requires the frozen original acceptance issue.');
    const subscription = subscriptionConfig(options.env);
    oauthSchema.parse(JSON.parse(await readFile(subscription.file, 'utf8')));
    if (!options.env.EXPO_TOKEN) throw new Error('The built-in Developer EXPO_TOKEN is required.');
    await verifyRuntimePins();
    options.signal.throwIfAborted();
    const installed = buildIdSchema.parse(options.env.AGENT_BUILD_ID);
    target = targetSchema.parse({ kind: 'acceptance', issue: prepared.issue.identity,
      controller: prepared.request.source, source: prepared.request.source, repository: prepared.request.repository, pullRequest: prepared.request.pullRequest,
      platform: 'ios', appId: 'dev.expo.basketball', profile: 'agent-preview', environment: 'preview', fingerprint: options.env.AGENT_FINGERPRINT,
      runtime: await readAppRuntime(options.cwd), fixture: prepared.demoFixture, criteria: prepared.criteria, bundle: { kind: 'embedded', candidate: prepared.request.source.sha },
      native: options.env.AGENT_NATIVE_SOURCE_BUILD_ID ? { kind: 'repacked', installed, source: buildIdSchema.parse(options.env.AGENT_NATIVE_SOURCE_BUILD_ID),
        sourceSha: shaSchema.parse(options.env.AGENT_NATIVE_SOURCE_SHA) } : { kind: 'built', installed, sourceSha: prepared.request.source.sha },
    });
    await verifyBuild({ target, eas, cwd: options.cwd, env: controllerEnv, projectId });
    const version = await command({ executable: node, args: ['--version'], cwd: options.cwd, env: safeEnvironment(options.env), timeoutMs: 10_000 });
    if (!succeeded(version) || version.stdout.trim() !== 'v22.23.1') throw new Error('Node 22.23.1 is required before starting e2e.');
    await writeSimulatorProject(options.cwd, device);
    if (target.pullRequest) writer = await prepareEvidenceWriter({ repository: target.repository, env: options.env,
      directory: join(options.outputRoot, '.testerarmy-tools'), phase: evidencePhase(options.signal, 120_000) });
    authFile = await seedSubscription(subscription.file, xdg);
    const tokens = z.object({ openai: z.object({ access: z.string(), refresh: z.string() }) }).parse(JSON.parse(await readFile(authFile, 'utf8')));
    secrets.push(tokens.openai.access, tokens.openai.refresh);
    auth = 'write-back-failed';
    await persistSubscription({ file: authFile, eas, cwd: options.cwd, env: options.env });
    auth = 'persisted';
    const abortFile = join(privateDirectory, 'abort');
    const contextFile = await runtime(task, { attemptId, target, ledgerFile, abortFile, cache: options.cache ?? 'off' });
    execution = 'unfinished';
    const run = await runWorker({ cwd: task, env: { ...runnerEnvironment(options.env, privateDirectory, xdg), TESTERARMY_CONTEXT: contextFile },
      abortFile, signal: options.signal });
    termination = { kind: 'observed', exitCode: run.observation.exitCode, signal: run.observation.signal,
      forced: run.observation.cleanup.forced || run.termination.kind !== 'exited',
      shutdownConfirmed: run.observation.cleanup.confirmed && run.observation.cleanup.rootExited && run.observation.cleanup.streamsClosed && run.observation.cleanup.liveProcesses === 0 };
    ledger = await readLedger(ledgerFile);
    admission = admitWorkerReport(run, JSON.parse(await readFile(join(task, 'output/report.json'), 'utf8')), ledger, target);
    execution = 'completed';
  } catch (error) {
    problem = error instanceof z.ZodError ? 'Strict controller input or lifecycle validation failed.' : sanitize(error instanceof Error ? error.message : 'e2e execution failed.', secrets);
  } finally {
    try { ledger = await readLedger(ledgerFile); cleanup = await reconcileOwned(ledger, sessionControl({ eas, cwd: device, env: controllerEnv })); }
    catch { cleanup = { state: 'unconfirmed', sessionId: null }; }
    if (authFile) {
      try {
        const refreshed = oauthSchema.parse(JSON.parse(await readFile(authFile, 'utf8')));
        secrets.push(refreshed.openai.access, refreshed.openai.refresh);
      } catch {}
      auth = await finalizeSubscription({ file: authFile, eas, cwd: options.cwd, env: options.env, execution });
    }
  }
  if (cleanup.state !== 'stopped') problem ||= 'Independent owned-session STOPPED verification is unavailable.';
  if (auth !== 'persisted') problem ||= 'Dedicated subscription persistence is incomplete or uncertain.';
  if (!problem && authFile && options.refreshedFile) {
    try { await copyFile(authFile, options.refreshedFile); }
    catch { problem ||= 'The bounded replay unit could not retain its current private credential.'; }
  }
  if (admission && target && ledger) {
    try {
      evidence = await admitEvidence({ admission, root: join(task, 'output/results'), directory: root, target, ledger, cwd: options.cwd, env: safeEnvironment(options.env), secrets });
    } catch { problem ||= 'Framework media or source admission failed.'; }
  }
  try { await rm(privateDirectory, { recursive: true, force: true }); }
  catch { problem ||= 'Private credential and runner directory removal failed.'; }
  const base = { version: 1, engine: 'testerarmy-e2e', attemptId, runId: options.env.AGENT_RUN_ID,
    runUrl: options.env.AGENT_RUN_URL, startedAt, finishedAt: new Date().toISOString(), target, lease: ledger,
    framework: admission?.framework ?? null, checks: admission?.checks ?? [], evidence, cleanup, auth, termination, tools: toolVersions };
  const result = testerArmyResultSchema.parse({ ...base, state: !problem && admission && evidence ? admission.state : 'INCONCLUSIVE',
    ...(!problem && admission && evidence ? {} : { reason: problem || 'No admitted deterministic result.' }) });
  await mkdir(root, { recursive: true, mode: 0o700 });
  await publishFile({ directory: root, name: 'result.json', bytes: JSON.stringify(result, null, 2) });
  await publishFile({ directory: root, name: 'report.md', bytes: `# TesterArmy e2e iOS\n\n${result.state}\n\n${result.checks.map((check) => `- ${check.id}. ${check.state}. ${check.detail}`).join('\n')}\n\n${result.state === 'INCONCLUSIVE' ? result.reason : ''}\n\nCleanup ${cleanup.state}. Subscription ${auth}.\n` });
  const staged = await mkdtemp(join(tmpdir(), 'lob-testerarmy-publication-'));
  let delivery;
  try { delivery = await publishTesterArmyEvidence({ result, root, directory: join(staged, 'media'), cwd: options.cwd, env: options.env, writer, phase: evidencePhase() }); }
  finally { await rm(staged, { recursive: true, force: true }); }
  await publishFile({ directory: root, name: 'publication-receipt.json', bytes: JSON.stringify(delivery, null, 2) });
  return { result, status: publicationStatus(result, delivery), report: admission?.report ?? null };
}

export async function executeReplayProof(options: Options) {
  const directory = await mkdtemp(join(tmpdir(), 'lob-testerarmy-replay-'));
  const attempts: { attemptId: string; state: string; source: string | null; build: string | null }[] = [];
  let outcome: Awaited<ReturnType<typeof executeTesterArmy>> | undefined;
  try {
    let seed = subscriptionConfig(options.env).file;
    for (let index = 0; index < 3; index++) {
      const refreshedFile = join(directory, `oauth-${index}.json`);
      outcome = await executeTesterArmy({ ...options, env: { ...options.env, TESTERARMY_OAUTH_JSON: seed }, refreshedFile,
        cache: { mode: index === 2 ? 'read-only' : 'read-write', dir: join(directory, 'cache'), strict: index === 2 } });
      attempts.push({ attemptId: outcome.result.attemptId, state: outcome.status.state,
        source: outcome.result.target?.source.sha ?? null, build: outcome.result.target?.native.installed ?? null });
      if (outcome.status.state !== 'PASS') break;
      seed = refreshedFile;
    }
    if (!outcome) throw new Error('Replay proof did not execute.');
    let replay: ReturnType<typeof verifyReplay> | null = null;
    try {
      if (attempts.length !== 3 || attempts.some((attempt) => attempt.state !== 'PASS' || attempt.source !== attempts[0]?.source || attempt.build !== attempts[0]?.build)) throw new Error('Repeated repaired artifacts disagree.');
      replay = verifyReplay(outcome.report);
    } catch { outcome.status.state = 'INCONCLUSIVE'; }
    await writeFile(join(options.outputRoot, 'public', outcome.result.attemptId, 'cache-proof.json'), JSON.stringify({
      state: replay ? 'VERIFIED' : 'INCONCLUSIVE', attempts, replay,
      policy: 'Two unchanged repaired passes followed by four self-finalized acts, fresh assertions, identities, media, stopped leases, persisted subscription, and required publication.',
    }, null, 2), { flag: 'wx', mode: 0o600 });
    return outcome;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function main() {
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  process.once('SIGTERM', () => cancellation.abort());
  if (process.argv[2] === 'preflight') {
    const prepared = await preflight({ cwd: process.cwd(), env: process.env });
    if (prepared.task !== 'acceptance') throw new Error('Frozen acceptance issue is required.');
    const subscription = subscriptionConfig(process.env);
    oauthSchema.parse(JSON.parse(await readFile(subscription.file, 'utf8')));
    if (!process.env.EXPO_TOKEN) throw new Error('The built-in Developer EXPO_TOKEN is required.');
    await verifyRuntimePins();
    process.stdout.write('Trusted source and dedicated e2e subscription configuration admitted.\n');
    return;
  }
  if (process.argv[2] !== 'run') throw new Error('Usage: bun .eas/agents/testerarmy/controller.ts <preflight|run>');
  const options = { cwd: process.cwd(), outputRoot: resolve('agent-output/testerarmy'), env: process.env, signal: cancellation.signal };
  const outcome = process.env.TESTERARMY_VERIFY_REPLAY === 'true' ? await executeReplayProof(options) : await executeTesterArmy(options);
  await writeFile('agent-output/testerarmy/status.json', JSON.stringify(outcome.status));
  process.stdout.write(JSON.stringify(outcome.status) + '\n');
  process.exitCode = outcome.status.state === 'PASS' ? 0 : outcome.status.state === 'FAIL' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('TesterArmy has no verified result. Inspect the admitted inputs and controller artifacts.\n'); process.exitCode = 2; });
}
