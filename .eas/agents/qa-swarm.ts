import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { persistSubscription, seedSubscription, subscriptionConfig, validateSubscription } from './auth';
import { CodexServer, codexCommand, codexModel, concurrentReceipts, type TurnReceipt } from './codex-server';
import { preflight } from './preflight';
import { command, safeEnvironment, succeeded, type Command } from './process';
import { laneIds, lanePrompt, laneVerdictSchema, type LaneId, type LaneVerdict } from './qa-lanes';
import { admitFile, buildIdSchema, digest, publishFile, sanitize, shaSchema, targetSchema,
  type Cleanup, type FileRef, type Session, type Target, type Termination } from './result';
import { identityLabel, Simulator, verifyBuild, writeSimulatorProject } from './simulator';

const tools: Record<'eas' | 'codex' | 'device' | 'ffprobe' | 'ffmpeg', Command> = {
  eas: { file: 'bunx', args: ['eas-cli@25.3.0'] }, codex: codexCommand,
  device: { file: 'bunx', args: ['agent-device@0.21.33'] }, ffprobe: { file: 'ffprobe', args: [] },
  ffmpeg: { file: 'ffmpeg', args: [] } };
const deadlines = { startupMs: 240_000, agentMs: 900_000, cleanupMs: 120_000,
  deviceMs: 120_000, authMs: 60_000, requestMs: 60_000, stopMs: 10_000 };
export type SwarmOptions = { cwd: string; outputRoot: string; env: NodeJS.ProcessEnv; signal: AbortSignal;
  executables?: typeof tools; limits?: typeof deadlines & { mediaMs?: number }; githubApiBase?: string };
type DeviceFailure = { operation: string; termination: Termination; error: { code: string; message: string } | null };
type Lane = { id: LaneId; attemptId: string; directory: string; evidenceDirectory: string; publicDirectory: string;
  simulator: Simulator; env: NodeJS.ProcessEnv | null; session: Session | null; threadId: string | null;
  turn: TurnReceipt | null; verdict: LaneVerdict | null; identity: FileRef | null; recording: FileRef | null;
  screenshots: FileRef[]; recordingAttempted: boolean; cleanup: Cleanup; problem: string | null;
  deviceFailure: DeviceFailure | null };
const deviceErrorSchema = z.object({ error: z.object({ code: z.string().max(100), message: z.string().max(2000) }) });

export async function qaPreflight(options: Pick<SwarmOptions, 'env' | 'cwd' | 'githubApiBase'>) {
  const prepared = await preflight({ env: options.env, cwd: options.cwd, apiBase: options.githubApiBase });
  for (const args of [
    ['diff', '--exit-code', prepared.request.baseline, 'HEAD', '--', '.eas/workflows/qa-swarm.yml'],
    ['diff', '--exit-code', 'HEAD', '--', '.eas/workflows/qa-swarm.yml'],
  ]) {
    const checked = await command({ executable: { file: 'git', args: [] }, args, cwd: options.cwd, env: options.env, timeoutMs: 10_000 });
    if (!succeeded(checked)) throw new Error('QA workflow differs from the audited baseline.');
  }
  subscriptionConfig(options.env);
  return prepared;
}

async function decodeMedia(file: string, kind: 'png' | 'mp4', options: SwarmOptions, cwd: string) {
  const executables = options.executables ?? tools;
  const env = safeEnvironment(options.env);
  const deadline = Date.now() + (options.limits?.mediaMs ?? 30_000);
  const probe = await command({ executable: executables.ffprobe, cwd, env, timeoutMs: Math.max(1, deadline - Date.now()),
    args: ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file] });
  if (!succeeded(probe)) throw new Error('Evidence media probe failed.');
  const media = z.object({ streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional() })),
    format: z.object({ duration: z.string().optional() }) }).parse(JSON.parse(probe.stdout));
  if (!media.streams.some((s) => s.codec_type === 'video' && (s.width ?? 0) >= 100 && (s.height ?? 0) >= 100) ||
    (kind === 'mp4' && !(Number(media.format.duration) >= 1))) throw new Error('Evidence has no usable frames.');
  if (Date.now() >= deadline) throw new Error('Evidence validation timed out.');
  const decoded = await command({ executable: executables.ffmpeg, cwd, env, timeoutMs: deadline - Date.now(),
    args: ['-v', 'error', '-xerror', '-i', file, ...(kind === 'png' ? ['-frames:v', '1'] : []), '-f', 'null', '-'] });
  if (!succeeded(decoded)) throw new Error('Evidence cannot be decoded.');
}

export async function executeSwarm(options: SwarmOptions) {
  options = { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(20 * 60_000)]) };
  const startedAt = Date.now();
  const attemptId = randomUUID();
  const publicDirectory = join(options.outputRoot, 'public', attemptId);
  await mkdir(publicDirectory, { recursive: true, mode: 0o700 });
  const privateDirectory = await mkdtemp(join(tmpdir(), 'lob-qa-'));
  const executables = options.executables ?? tools;
  const limits = options.limits ?? deadlines;
  const controllerEnv = { ...safeEnvironment(options.env), EXPO_TOKEN: options.env.EXPO_TOKEN, CI: '1', EAS_NO_VCS: '1' };
  const secrets = Object.entries(options.env).filter(([key]) => /TOKEN|SECRET|KEY|AUTH/.test(key)).map(([, value]) => value ?? '');
  secrets.push(privateDirectory);
  let target: Target | null = null;
  let authFile: string | null = null;
  let auth: 'not-loaded' | 'persisted' | 'write-back-failed' = 'not-loaded';
  let server: CodexServer | null = null;
  let serverStop: Awaited<ReturnType<CodexServer['close']>> | null = null;
  let problem: string | null = null;
  const lanes: Lane[] = [];
  const device = async (lane: Lane, args: string[], cleanup = false) => {
    if (!lane.env) throw new Error('Lane device is unavailable.');
    const result = await command({ executable: executables.device, cwd: lane.directory, env: lane.env,
      timeoutMs: limits.deviceMs, signal: cleanup ? undefined : options.signal,
      args: [...args, '--platform', 'ios', '--session', lane.attemptId, '--json'] });
    if (!succeeded(result)) {
      const operation = args[0] === 'record' ? `record ${args[1]}` : args[0]!;
      let error: DeviceFailure['error'] = null;
      try {
        const parsed = deviceErrorSchema.safeParse(JSON.parse(result.stdout));
        if (parsed.success) error = { code: sanitize(parsed.data.error.code, secrets), message: sanitize(parsed.data.error.message, secrets) };
      } catch {}
      lane.deviceFailure ??= { operation, termination: result.termination, error };
      lane.problem ??= `Device ${operation} did not complete.`;
      throw new Error('Lane device command did not complete.');
    }
    return result.stdout;
  };
  const media = async (lane: Lane, name: string, kind: 'png' | 'mp4') => {
    const bytes = await admitFile({ directory: lane.evidenceDirectory, name, kind, startedAt });
    await decodeMedia(join(lane.evidenceDirectory, name), kind, options, privateDirectory);
    return publishFile({ directory: lane.publicDirectory, name, bytes });
  };
  try {
    const prepared = await qaPreflight(options);
    options.signal.throwIfAborted();
    if (!options.env.EXPO_TOKEN) throw new Error('The built-in Developer EXPO_TOKEN is required.');
    const installed = buildIdSchema.parse(options.env.AGENT_BUILD_ID);
    target = targetSchema.parse({ kind: 'check', issue: null, controller: prepared.request.source, source: prepared.request.source,
      repository: prepared.request.repository, pullRequest: prepared.request.pullRequest, platform: 'ios',
      appId: 'dev.expo.basketball', profile: 'agent-preview', environment: 'preview', fingerprint: options.env.AGENT_FINGERPRINT,
      runtime: '1.0.0', fixture: prepared.demoFixture,
      criteria: { path: '.eas/agents/check-ios.md', sha256: digest(await readFile(join(options.cwd, '.eas/agents/check-ios.md'))) },
      native: options.env.AGENT_NATIVE_SOURCE_BUILD_ID
        ? { kind: 'repacked', source: buildIdSchema.parse(options.env.AGENT_NATIVE_SOURCE_BUILD_ID),
          sourceSha: shaSchema.parse(options.env.AGENT_NATIVE_SOURCE_SHA), installed }
        : { kind: 'built', installed, sourceSha: prepared.request.source.sha },
      bundle: { kind: 'embedded', candidate: prepared.request.source.sha } });
    await verifyBuild({ target, eas: executables.eas, cwd: options.cwd, env: controllerEnv });
    await publishFile({ directory: publicDirectory, name: 'target.json', bytes: JSON.stringify(target, null, 2) });
    const seeded = await seedSubscription({ seedFile: subscriptionConfig(options.env).file, directory: join(privateDirectory, 'codex') });
    authFile = seeded.file;
    secrets.push(...seeded.secrets);
    auth = 'write-back-failed';
    await persistSubscription({ file: authFile, eas: executables.eas, cwd: options.cwd, env: options.env, timeoutMs: limits.authMs });
    auth = 'persisted';
    options.signal.throwIfAborted();
    await mkdir(join(privateDirectory, 'home'));
    server = new CodexServer({ executable: executables.codex, cwd: privateDirectory,
      env: { ...safeEnvironment(options.env), HOME: join(privateDirectory, 'home'), CODEX_HOME: join(privateDirectory, 'codex'), CI: '1' },
      requestMs: limits.requestMs, stopMs: limits.stopMs });
    await server.initialize();
    const client = server;
    const candidate = target;
    for (const id of laneIds) {
      const laneAttempt = randomUUID();
      const directory = join(privateDirectory, id);
      const evidenceDirectory = join(directory, 'evidence');
      const lanePublic = join(publicDirectory, id);
      await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
      await mkdir(lanePublic, { mode: 0o700 });
      await mkdir(join(directory, 'home'), { mode: 0o700 });
      await writeSimulatorProject(options.cwd, directory);
      lanes.push({ id, attemptId: laneAttempt, directory, evidenceDirectory, publicDirectory: lanePublic,
        simulator: new Simulator({ attemptId: laneAttempt, cwd: directory, env: controllerEnv, eas: executables.eas,
          startupMs: limits.startupMs, cleanupMs: limits.cleanupMs }),
        env: null, session: null, threadId: null, turn: null, verdict: null, identity: null,
        recording: null, screenshots: [], recordingAttempted: false, cleanup: { state: 'not-needed' }, problem: null, deviceFailure: null });
    }
    await Promise.allSettled(lanes.map(async (lane) => {
      try {
        const connected = await lane.simulator.start({ buildId: candidate.native.installed, signal: options.signal });
        lane.session = connected.session;
        secrets.push(connected.secret);
        lane.env = { ...connected.env, HOME: join(lane.directory, 'home'),
          AGENT_DEVICE_STATE_DIR: join(lane.directory, 'device-state'), AGENT_EVIDENCE_DIR: lane.evidenceDirectory };
      } catch { lane.problem = 'Lane simulator startup failed.'; }
    }));
    const sessions = lanes.flatMap((lane) => lane.session ? [lane.session.id] : []);
    if (new Set(sessions).size !== sessions.length) throw new Error('Remote session identities are not distinct.');
    await Promise.allSettled(lanes.map(async (lane) => {
      if (lane.problem || !lane.env) return;
      try {
        await device(lane, ['open', candidate.appId, '--foreground']);
        lane.recordingAttempted = true;
        await device(lane, ['record', 'start', join(lane.evidenceDirectory, 'session.mp4'), '--hide-touches']);
        await device(lane, ['wait', `label=${JSON.stringify(identityLabel(candidate))}`, '60000']);
        const snapshot = await device(lane, ['snapshot']);
        if (!snapshot.includes(identityLabel(candidate))) throw new Error('Installed embedded identity was not observed.');
        await device(lane, ['screenshot', join(lane.evidenceDirectory, 'controller-start.png')]);
        lane.screenshots.push(await media(lane, 'controller-start.png', 'png'));
      } catch { lane.problem ??= 'Installed embedded identity verification or lane recording startup failed.'; }
    }));
    await Promise.allSettled(lanes.map(async (lane) => {
      if (lane.problem || !lane.env) return;
      try {
        lane.threadId = await client.startThread(lane.directory,
          Object.fromEntries(Object.entries(lane.env).filter((entry): entry is [string, string] => entry[1] !== undefined)));
      } catch { lane.problem = 'Lane thread initialization failed.'; }
    }));
    await Promise.allSettled(lanes.map(async (lane) => {
      if (lane.problem || !lane.threadId) return;
      try {
        const prompt = lanePrompt(lane.id, lane.attemptId, identityLabel(candidate));
        const turn = await client.runTurn({ threadId: lane.threadId, prompt,
          outputSchema: z.toJSONSchema(laneVerdictSchema.safeExtend({ id: z.literal(lane.id),
            screenshot: z.literal(`${lane.id}.png`) }), { io: 'input' }), timeoutMs: limits.agentMs, signal: options.signal });
        lane.turn = turn.receipt;
        lane.verdict = laneVerdictSchema.parse(JSON.parse(turn.text));
        if (lane.verdict.id !== lane.id) throw new Error('Verdict belongs to a different lane.');
        lane.screenshots.push(await media(lane, lane.verdict.screenshot, 'png'));
        const final = await device(lane, ['snapshot']);
        if (!final.includes(identityLabel(candidate)) || (lane.verdict.state === 'PASS' &&
          !['Orbits', 'Comets', '100', '108'].every((value) => final.includes(value)))) throw new Error('Final device identity or scores are missing.');
        await device(lane, ['screenshot', join(lane.evidenceDirectory, 'controller-end.png')]);
        lane.screenshots.push(await media(lane, 'controller-end.png', 'png'));
        lane.identity = await publishFile({ directory: lane.publicDirectory, name: 'identity.json', bytes: JSON.stringify({
          source: candidate.source, installedBuild: candidate.native.installed, fixture: candidate.fixture,
          observed: identityLabel(candidate), sessionId: lane.session!.id, attemptId: lane.attemptId,
          threadId: lane.threadId, turn: lane.turn, promptSha256: digest(prompt), observedAt: Date.now(),
        }, null, 2) });
      } catch { lane.problem ??= 'Lane turn, strict verdict, device identity, or evidence validation failed.'; }
    }));
  } catch { problem = 'QA setup or identity verification did not complete.'; }
  finally {
    if (server) serverStop = await server.close();
    await Promise.allSettled(lanes.map(async (lane) => {
      try {
        if (lane.recordingAttempted) {
          try { await device(lane, ['record', 'stop'], true); lane.recording = await media(lane, 'session.mp4', 'mp4'); }
          catch { lane.problem ??= 'A usable lane recording is missing.'; }
        }
        if (lane.env) {
          try { await device(lane, ['close'], true); }
          catch { lane.problem ??= 'Lane device close failed.'; }
        }
      } finally { lane.cleanup = await lane.simulator.cleanup(); }
    }));
    if (authFile) {
      try {
        const refreshed = validateSubscription(JSON.parse(await readFile(authFile, 'utf8')));
        secrets.push(...Object.values(refreshed.tokens));
        await persistSubscription({ file: authFile, eas: executables.eas, cwd: options.cwd, env: options.env, timeoutMs: limits.authMs });
        auth = 'persisted';
      } catch { auth = 'write-back-failed'; }
    }
    try { await rm(privateDirectory, { recursive: true, force: true }); }
    catch { problem ??= 'Private QA directory cleanup failed.'; }
  }
  const turns = server?.receipts() ?? [];
  const concurrent = concurrentReceipts(turns);
  const records = laneIds.map((id) => {
    const lane = lanes.find((value) => value.id === id);
    const complete = lane && !lane.problem && lane.session && lane.threadId && lane.turn && lane.verdict && lane.identity &&
      lane.recording && lane.screenshots.length === 3 && lane.cleanup.state === 'stopped' &&
      lane.cleanup.sessionId === lane.session.id && lane.turn.threadId === lane.threadId;
    return { id, state: complete && lane.verdict!.state !== 'BLOCKED' ? lane.verdict!.state : 'INCONCLUSIVE',
      attemptId: lane?.attemptId ?? null, session: lane?.session ?? null, threadId: lane?.threadId ?? null,
      turn: turns.find((turn) => turn.threadId === lane?.threadId) ?? null,
      verdict: lane?.verdict ? { ...lane.verdict, detail: sanitize(lane.verdict.detail, secrets) } : null,
      identity: lane?.identity ?? null, screenshots: lane?.screenshots ?? [], recording: lane?.recording ?? null,
      recordingSessionId: lane?.recording ? lane.session?.id ?? null : null,
      cleanup: lane?.cleanup ?? { state: 'not-needed' }, deviceFailure: lane?.deviceFailure ?? null,
      reason: lane?.problem ?? (complete ? null : 'Lane evidence is incomplete.') };
  });
  const definitive = !problem && target && auth === 'persisted' && serverStop?.state === 'stopped' && serverStop.healthy && !serverStop.forced && concurrent &&
    records.every((lane) => lane.state !== 'INCONCLUSIVE') && new Set(records.map((lane) => lane.session?.id)).size === 3;
  const state = definitive ? records.some((lane) => lane.state === 'FAIL') ? 'FAIL' : 'PASS' : 'INCONCLUSIVE';
  const result = { version: 1, kind: 'qa', attemptId, state, startedAt, finishedAt: Date.now(),
    runId: options.env.AGENT_RUN_ID ?? 'local', target, model: codexModel,
    tools: { bun: '1.2.22', eas: '25.3.0', codex: '0.165.0', agentDevice: '0.21.33' },
    auth, server: { processId: server?.pid ?? null, stop: serverStop }, concurrent, lanes: records,
    reason: problem ?? (definitive ? null : 'All lanes, concurrent turns, cleanup, and auth persistence must be verified.') };
  await publishFile({ directory: publicDirectory, name: 'result.json', bytes: sanitize(JSON.stringify(result, null, 2), secrets) });
  await publishFile({ directory: publicDirectory, name: 'report.md', bytes: `# QA Swarm\n\n${state}\n\n${records.map((lane) => `- ${lane.id}. ${lane.state}. Cleanup ${lane.cleanup.state}.`).join('\n')}\n\nSource ${target?.source.sha ?? 'unverified'}.\nBuild ${target?.native.installed ?? 'unverified'}.\nConcurrent turns ${concurrent}.\nSubscription ${auth}.\n` });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  process.once('SIGTERM', () => cancellation.abort());
  const main = async () => {
    if (process.argv[2] === 'preflight') { await qaPreflight({ cwd: process.cwd(), env: process.env }); return; }
    if (process.argv[2] !== 'run') throw new Error('Invalid QA command.');
    const result = await executeSwarm({ cwd: process.cwd(), env: process.env,
      outputRoot: resolve('agent-output/qa'), signal: cancellation.signal });
    const status = { state: result.state, attemptId: result.attemptId };
    await writeFile('agent-output/qa/status.json', JSON.stringify(status));
    process.stdout.write(`${JSON.stringify(status)}\n`);
    process.exitCode = result.state === 'PASS' ? 0 : result.state === 'FAIL' ? 1 : 2;
  };
  main().catch(() => { process.stderr.write('QA did not produce a verified result.\n'); process.exitCode = 2; });
}
