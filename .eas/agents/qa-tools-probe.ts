import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preflight } from './preflight';
import { command, safeEnvironment, succeeded } from './process';
import { prepareQaTools, qaToolPins, QaToolPreparationError } from './qa-tools';

export async function probeQaTools(options: { cwd: string; env: NodeJS.ProcessEnv; output: string;
  signal: AbortSignal; githubApiBase?: string }) {
  const started = performance.now();
  const privateDirectory = await mkdtemp(join(tmpdir(), 'lob-qa-tools-probe-'));
  let source: Awaited<ReturnType<typeof preflight>>['request']['source'] | null = null;
  let status: 'PASS' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  let reason: string | null = null;
  let preparationMs: number | null = null;
  const outcomes: { probe: string; passed: boolean }[] = [];
  try {
    const trusted = await preflight({ cwd: options.cwd, env: options.env, apiBase: options.githubApiBase });
    source = trusted.request.source;
    const preparationStarted = performance.now();
    const prepared = await prepareQaTools({ sourceDirectory: options.cwd, directory: join(privateDirectory, 'tools'),
      env: safeEnvironment(options.env), signal: options.signal });
    preparationMs = Math.round(performance.now() - preparationStarted);
    outcomes.push({ probe: 'exact-tool-versions-and-native-codex', passed: true });
    const sentinels = join(privateDirectory, 'package-managers');
    const forbidden = join(privateDirectory, 'package-manager-used');
    await mkdir(sentinels, { mode: 0o700 });
    const quoted = `'${forbidden.replaceAll("'", "'\\''")}'`;
    for (const name of ['bun', 'bunx', 'npx', 'npm']) {
      await writeFile(join(sentinels, name), `#!/bin/sh\n: > ${quoted}\nexit 99\n`, { mode: 0o700 });
    }
    const deadline = performance.now() + 30_000;
    const results = await Promise.allSettled([0, 1, 2].map(async (lane) => {
      const directory = join(privateDirectory, `lane-${lane}`);
      for (const name of ['home', 'state', 'tmp']) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
      const env = { ...safeEnvironment(options.env), HOME: join(directory, 'home'), TMPDIR: join(directory, 'tmp'),
        TMP: join(directory, 'tmp'), TEMP: join(directory, 'tmp'),
        PATH: sentinels, AGENT_DEVICE_STATE_DIR: join(directory, 'state') };
      for (const args of [['--version'], ['help', 'workflow']]) {
        const result = await command({ executable: prepared.commands.device, args, cwd: directory, env,
          timeoutMs: deadline - performance.now(), signal: options.signal });
        const passed = succeeded(result) && (args[0] === '--version'
          ? result.stdout.trim() === qaToolPins.agentDevice : /workflow/i.test(result.stdout) && result.stdout.trim().length > 0);
        outcomes.push({ probe: `lane-${lane}-${args[0] === '--version' ? 'version' : 'workflow-help'}`, passed });
        if (!passed) throw new Error('Prepared device probe failed.');
      }
    }));
    const packageManagerUsed = await readFile(forbidden).then(() => true, (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
    outcomes.push({ probe: 'no-package-manager-after-readiness', passed: !packageManagerUsed });
    if (packageManagerUsed) throw new Error('Prepared command attempted package resolution.');
    if (results.some((result) => result.status === 'rejected')) throw new Error('Concurrent launch probe failed.');
    status = 'PASS';
  } catch (error) {
    reason = error instanceof QaToolPreparationError ? error.message : 'Trusted source or prepared command probe failed.';
  } finally {
    try { await rm(privateDirectory, { recursive: true, force: true }); }
    catch { status = 'INCONCLUSIVE'; reason = 'Private tool probe cleanup failed.'; }
  }
  const receipt = { status, source, pins: qaToolPins, platform: process.platform, arch: process.arch,
    preparationMs, elapsedMs: Math.round(performance.now() - started), outcomes, reason };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  process.once('SIGTERM', () => cancellation.abort());
  probeQaTools({ cwd: process.cwd(), env: process.env, output: resolve('agent-output/qa-tools/public/result.json'),
    signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(240_000)]) })
    .then((receipt) => { process.stdout.write(`${JSON.stringify({ status: receipt.status })}\n`); process.exitCode = receipt.status === 'PASS' ? 0 : 2; })
    .catch(() => { process.stderr.write('Tool preparation probe did not produce a verified PASS.\n'); process.exitCode = 2; });
}
