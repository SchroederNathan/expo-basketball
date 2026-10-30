import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { evidenceBytes, attachmentLimit } from '../evidence-files';
import { runUrl, type Delivery, type Manifest, type Slot } from '../evidence';
import { deliverManifest } from '../evidence-publisher';
import { evidencePhase, type EvidencePhase } from '../evidence-phase';
import { derivePlayback, probeMedia } from '../evidence-media';
import type { EvidenceWriter } from '../evidence-tools';
import { digest } from '../result';
import { identityLabel } from '../simulator';
import { testerArmyResultSchema, originalCriteriaSha256, originalFixtureSha256, type TesterArmyResultV1 } from './result';
import { admitReport } from './report';

export async function stageTesterArmyEvidence({ result: input, root, directory, cwd, env, phase = evidencePhase() }: {
  result: TesterArmyResultV1; root: string; directory: string; cwd: string; env: NodeJS.ProcessEnv; phase?: EvidencePhase;
}): Promise<Manifest> {
  const result = testerArmyResultSchema.parse(input);
  const target = result.target;
  const evidence = result.evidence;
  if (!target || target.kind !== 'acceptance' || !target.pullRequest || !evidence || !result.framework || result.lease?.state !== 'ready') throw new Error('No admitted e2e PR evidence.');
  const url = runUrl(result.runId, result.runUrl);
  if (digest(await readFile(join(cwd, target.criteria.path))) !== target.criteria.sha256 ||
    digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'))) !== target.fixture.sha256 ||
    target.criteria.sha256 !== originalCriteriaSha256 || target.fixture.sha256 !== originalFixtureSha256) throw new Error('Source criteria or fixture changed before e2e publication.');
  const identity = z.object({ observedBefore: z.string(), observedAfter: z.string(), installedBuild: z.string(),
    framework: z.unknown(), ledger: z.unknown(), reportSha256: z.string() }).parse(JSON.parse(Buffer.from(await evidenceBytes(root, evidence.identity.path, evidence.identity)).toString()));
  if (identity.observedBefore !== identityLabel(target) || identity.observedAfter !== identityLabel(target) ||
    identity.installedBuild !== target.native.installed || JSON.stringify(identity.framework) !== JSON.stringify(result.framework) ||
    JSON.stringify(identity.ledger) !== JSON.stringify(result.lease) || identity.reportSha256 !== evidence.report.sha256) throw new Error('Finalized e2e identity does not bind this attempt.');
  if (result.termination.kind !== 'observed' || result.termination.exitCode === null) throw new Error('Actual runner exit is unavailable.');
  const report = admitReport(JSON.parse(Buffer.from(await evidenceBytes(root, evidence.report.path, evidence.report)).toString()), result.lease, target, result.termination.exitCode);
  if (JSON.stringify(report.framework) !== JSON.stringify(result.framework) || JSON.stringify(report.checks) !== JSON.stringify(result.checks) ||
    report.recording.sha256 !== evidence.recording.sha256 || report.screenshots.some(({ id, artifact }) =>
      !evidence.screenshots.some((ref) => ref.path === `${id}.png` && ref.sha256 === artifact.sha256 && ref.bytes === artifact.size))) throw new Error('Canonical media does not bind the admitted e2e report.');
  await mkdir(directory, { mode: 0o700 });
  const slots: Slot[] = [];
  for (const ref of evidence.screenshots) {
    const bytes = await evidenceBytes(root, ref.path, ref, attachmentLimit);
    await writeFile(join(directory, ref.path), bytes, { flag: 'wx', mode: 0o600 });
    const media = await probeMedia(join(directory, ref.path), directory, env, phase);
    if (media.codec_name !== 'png' || media.frames !== 1) throw new Error('Invalid e2e screenshot.');
    const check = result.checks.find((check) => check.screenshot === ref.path);
    slots.push({ ...ref, id: `testerarmy-${ref.path.replace('.png', '')}`, role: 'screenshot', lane: 'ios',
      caption: `e2e ${ref.path.replace('.png', '')}. ${check?.state ?? result.state}`, transform: null });
  }
  const original = 'testerarmy-original.mp4';
  await writeFile(join(directory, original), await evidenceBytes(root, evidence.recording.path, evidence.recording, attachmentLimit), { flag: 'wx', mode: 0o600 });
  await probeMedia(join(directory, original), directory, env, phase);
  slots.push({ ...evidence.recording, path: original, id: 'testerarmy-original', role: 'original', lane: 'ios', caption: 'e2e unchanged original recording', transform: null });
  const playback = await derivePlayback({ directory, original, output: 'testerarmy-playback.mp4', env, phase });
  slots.push({ ...playback, id: 'testerarmy-playback', role: 'playback', lane: 'ios',
    caption: `e2e edited playback, timing normalized. All ${playback.transform.frames} decoded frames preserved in order. H.264/yuv420p at 15 fps. Not timing or latency evidence.` });
  return { version: 1, origin: 'live', note: 'Open source e2e navigation with deterministic acceptance assertions.', provenance: null,
    workflow: 'testerarmy', runId: result.runId, runUrl: url, attemptId: result.attemptId, state: result.state, target,
    destination: { kind: 'pr', repository: target.repository, number: target.pullRequest }, slots,
    summary: [`Framework run ${result.framework.runId}. Test ${result.framework.testId}. Attempt ${result.framework.attemptId}. Actual exit ${result.termination.kind === 'observed' ? result.termination.exitCode : 'unavailable'}.`,
      `EAS session ${result.lease.sessionId}. Cleanup ${result.cleanup.state}. Subscription ${result.auth}.`,
      ...result.checks.map((check) => `Deterministic check ${check.id}. ${check.state}. ${check.detail}`),
      ...(result.state === 'INCONCLUSIVE' ? [`INCONCLUSIVE partial observation. ${result.reason}`] : [])] };
}

export async function publishTesterArmyEvidence({ result, root, directory, cwd, env, writer, phase = evidencePhase() }: {
  result: TesterArmyResultV1; root: string; directory: string; cwd: string; env: NodeJS.ProcessEnv; writer: EvidenceWriter | null; phase?: EvidencePhase;
}): Promise<Delivery> {
  const base: Delivery = { version: 1, state: 'unavailable', observedState: result.state, manifestSha256: null, commentId: null,
    url: null, bodySha256: null, authorId: null, rendered: false, assets: [], missing: [], reason: null };
  if (!result.target?.pullRequest) return { ...base, state: 'artifact-only' };
  try {
    if (!writer) throw new Error('Prepared native evidence writer unavailable.');
    const manifest = await stageTesterArmyEvidence({ result, root, directory, cwd, env, phase });
    await writeFile(join(root, `publication-manifest-${crypto.randomUUID()}.json`), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    return await deliverManifest({ manifest, directory, root, writer, phase });
  } catch { return { ...base, reason: 'e2e publication admission or native delivery failed.' }; }
}
