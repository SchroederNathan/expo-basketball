import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { Report } from 'e2e';
import { z } from 'zod';
import { digest, publishFile, sanitize, type Target } from '../result';
import { identityLabel } from '../simulator';
import { probeMedia } from '../evidence-media';
import { evidencePhase, type EvidencePhase } from '../evidence-phase';
import { checkIds, checkSchema, frameworkSchema, originalCriteriaSha256, originalFixtureSha256 } from './result';
import { type Ledger } from './provider';

const require = createRequire(import.meta.url);
const ajv = new Ajv({ strict: true, strictRequired: false, strictTypes: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Report>(JSON.parse(await readFile(join(dirname(require.resolve('e2e')), '../schema/report-v1.schema.json'), 'utf8')));
export function parseReport(input: unknown): Report {
  if (!validate(input)) throw new Error('Unsupported or malformed e2e report-1.');
  return input;
}
export function verifyReplay(input: unknown) {
  const report = parseReport(input);
  const acts = report.run.results.flatMap((result) => result.attempts.flatMap((attempt) => attempt.steps.filter((step) => step.api === 'agent.act')));
  if (report.run.status !== 'passed' || acts.length !== 4 || acts.some((step) => step.status !== 'passed' ||
    step.cache?.mode !== 'self-finalized' || step.cache.replayedActions < 1 || step.metrics?.modelCalls !== 0)) {
    throw new Error('Replay proof requires four self-finalized navigation acts with replayed actions and zero model calls.');
  }
  return acts.map((step) => ({ id: step.id, cache: step.cache, modelCalls: step.metrics?.modelCalls }));
}
type Attempt = Report['run']['results'][number]['attempts'][number];
type Step = Attempt['steps'][number];
type Artifact = Attempt['artifacts'][number];

export function admitReport(input: unknown, ledger: Ledger, target: Target, actualExit: number) {
  const report = parseReport(input);
  const run = report.run;
  const result = run.results[0];
  const attempt = result?.attempts[0];
  if (ledger.state !== 'ready' || run.id !== ledger.runId || run.runner.name !== 'e2e' || run.runner.version !== '0.22.0' ||
    run.project.id !== 'lob-testerarmy' || run.targets.length !== 1 || run.targets[0]?.id !== 'ios' || run.targets[0]?.platform !== 'ios' ||
    run.targets[0]?.engine.name !== 'mobile' || run.targets[0]?.engine.version !== '0.12.5' || run.results.length !== 1 ||
    !result || result.kind !== 'test' || !result.selected || result.repeat !== 0 || result.agent !== 'default' ||
    result.targetId !== 'ios' || result.platform !== 'ios' || result.file !== 'tests/jordan.e2e.ts' ||
    result.titlePath.join('/') !== 'Jordan original acceptance' || result.attempts.length !== 1 ||
    result.skip || !attempt || attempt.skip || attempt.index !== 0 || attempt.cleanup !== 'complete' || attempt.secondaryErrors.length ||
    run.errors.length || run.carried || run.filters?.length || run.changes || run.explore || run.serialGroups.length ||
    run.summary.selected !== 1 || run.summary.executed !== 1 || run.summary.skipped || run.summary.flaky || run.summary.interrupted ||
    !['passed', 'failed'].includes(run.status) || !['passed', 'failed'].includes(result.status) || attempt.status !== result.status ||
    Date.parse(run.startedAt) < Date.parse(ledger.readyAt) || Date.parse(run.finishedAt) < Date.parse(run.startedAt) ||
    run.environment.runtime !== 'node v22.23.1') throw new Error('e2e report selection, runtime, lifecycle, or identity is not admitted.');
  const failed = attempt.steps.filter((step) => step.status !== 'passed');
  if (failed.some((step) => step.status !== 'failed' || step.kind !== 'assertion' || step.error?.category !== 'test' || step.error.code !== 'ASSERTION_FAILED') ||
    attempt.error && (attempt.error.category !== 'test' || attempt.error.code !== 'ASSERTION_FAILED')) throw new Error('A non-assertion failure cannot be a product verdict.');
  const screenshot = (label: string) => {
    const steps = attempt.steps.filter((step) => step.api === 'app.screenshot' && step.label === label);
    if (steps.length !== 1 || steps[0]?.status !== 'passed' || steps[0].artifacts.length !== 1) throw new Error('Named screenshot step is missing or duplicated.');
    const step = steps[0];
    const artifacts = attempt.artifacts.filter((artifact) => artifact.id === step.artifacts[0]);
    const artifact = artifacts[0];
    if (artifacts.length !== 1 || !artifact || artifact.kind !== 'screenshot' || artifact.mediaType !== 'image/png' ||
      artifact.producer.kind !== 'step' || artifact.producer.stepId !== step.id || artifact.redaction !== 'complete') throw new Error('Screenshot ownership mismatch.');
    return { step, artifact };
  };
  const start = screenshot('controller-start');
  const end = screenshot('controller-end');
  const identity = identityLabel(target);
  const identities = attempt.steps.filter((step) => step.kind === 'assertion' && step.label.includes(identity) && step.status === 'passed');
  if (identities.length !== 2 || !identities.some((step) => step.index < start.step.index) ||
    !identities.some((step) => step.index > screenshot('current-player').step.index && step.index < end.step.index)) throw new Error('Exact embedded identity is required before and after navigation.');
  const checks = checkIds.map((id) => {
    const { step } = screenshot(id);
    const previous = attempt.steps.filter((candidate) => candidate.api === 'app.screenshot' && candidate.index < step.index).at(-1);
    const assertions = attempt.steps.filter((candidate) => candidate.kind === 'assertion' && candidate.index > (previous?.index ?? -1) && candidate.index < step.index);
    if (!assertions.length) throw new Error('Named check has no deterministic assertions.');
    return checkSchema.parse({ id, state: assertions.some((assertion) => assertion.status !== 'passed') ? 'FAIL' : 'PASS',
      detail: assertions.some((assertion) => assertion.status !== 'passed') ? 'Deterministic assertion failed on the scoped player or search screen.' : 'All scoped deterministic assertions passed.',
      screenshot: `${id}.png`, assertionIds: assertions.map((assertion) => assertion.id) });
  });
  const assertionIds = new Set(checks.flatMap((check) => check.assertionIds));
  if (failed.some((step) => !assertionIds.has(step.id))) throw new Error('Failure lies outside the four admitted product checks.');
  const state = checks.some((check) => check.state === 'FAIL') ? 'FAIL' : 'PASS';
  const exit = state === 'FAIL' ? 1 : 0;
  if (actualExit !== exit || run.exitCode !== exit || run.status !== (exit ? 'failed' : 'passed') || result.status !== run.status ||
    (state === 'FAIL' && (!failed.length || !attempt.error))) throw new Error('Observed checks do not agree with the genuine runner status and exit.');
  const videos = attempt.artifacts.filter((artifact) => artifact.kind === 'video');
  const recording = videos[0];
  if (videos.length !== 1 || !recording || recording.mediaType !== 'video/mp4' || recording.producer.kind !== 'attempt' ||
    recording.redaction !== 'incomplete' || !recording.startedAt || Date.parse(recording.startedAt) < Date.parse(run.startedAt) ||
    Date.parse(recording.startedAt) > Date.parse(start.step.startedAt)) throw new Error('One attempt-owned original recording is required.');
  return { report, state, checks, framework: frameworkSchema.parse({ runId: run.id, testId: result.testId,
    attemptId: attempt.id, resultId: result.id, status: run.status, exitCode: exit }),
    screenshots: ['controller-start', ...checkIds, 'controller-end'].map((id) => ({ id, ...screenshot(id) })), recording };
}

export async function artifactBytes(root: string, artifact: Artifact, startedMs: number) {
  if (!artifact.path || artifact.url || !artifact.sha256 || !artifact.size || artifact.size > 9_500_000 ||
    artifact.path.split('/').some((part) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part) || part === '..')) throw new Error('Unsafe or nonlocal framework artifact.');
  const base = await realpath(root);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Unsafe framework artifact root.');
  let path = base;
  for (const part of artifact.path.split('/')) { path = join(path, part); if ((await lstat(path)).isSymbolicLink()) throw new Error('Artifact symlinks are forbidden.'); }
  if (!path.startsWith(base + sep)) throw new Error('Artifact traversal.');
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size !== artifact.size || before.mtimeMs < startedMs) throw new Error('Artifact is stale, linked, or changed.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile()) throw new Error('Artifact changed before admission.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.nlink !== 1 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      (await lstat(path)).ino !== before.ino || bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) throw new Error('Artifact bytes or hash changed.');
    return bytes;
  } finally { await handle.close(); }
}

export async function admitEvidence({ admission, root, directory, target, ledger, cwd, env, secrets = [], phase = evidencePhase() }: {
  admission: ReturnType<typeof admitReport>; root: string; directory: string; target: Target; ledger: Ledger; cwd: string;
  env: NodeJS.ProcessEnv; secrets?: readonly string[]; phase?: EvidencePhase;
}) {
  if (digest(await readFile(join(cwd, target.criteria.path))) !== target.criteria.sha256 ||
    digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'))) !== target.fixture.sha256 ||
    target.criteria.sha256 !== originalCriteriaSha256 || target.fixture.sha256 !== originalFixtureSha256) throw new Error('Original criteria or fixture bytes changed.');
  const staging = await mkdtemp(join(tmpdir(), 'lob-testerarmy-admission-'));
  let promoting = false;
  try {
    const copy = async (artifact: Artifact, name: string) => {
      const bytes = await artifactBytes(root, artifact, Date.parse(ledger.requestedAt));
      const reference = await publishFile({ directory: staging, name, bytes });
      const media = await probeMedia(resolve(staging, name), staging, env, phase);
      if (name.endsWith('.png') && (media.codec_name !== 'png' || media.frames !== 1)) throw new Error('Screenshot must decode as a single PNG.');
      return reference;
    };
    const screenshots = [];
    for (const { id, artifact } of admission.screenshots) screenshots.push(await copy(artifact, `${id}.png`));
    const recording = await copy(admission.recording, 'session.mp4');
    const report = await publishFile({ directory: staging, name: 'framework-report.json', bytes: sanitize(JSON.stringify(admission.report, null, 2), secrets) });
    const identity = await publishFile({ directory: staging, name: 'identity.json', bytes: JSON.stringify({ observedBefore: identityLabel(target), observedAfter: identityLabel(target),
      installedBuild: target.native.installed, ledger, framework: admission.framework, reportSha256: report.sha256 }, null, 2) });
    if ((await readdir(directory)).length) throw new Error('Evidence destination must be an empty owned attempt directory.');
    promoting = true;
    for (const reference of [identity, report, ...screenshots, recording]) {
      await copyFile(join(staging, reference.path), join(directory, reference.path), constants.COPYFILE_EXCL);
    }
    return { identity, report, screenshots, recording };
  } catch (error) {
    if (promoting) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
