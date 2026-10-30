import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { evidenceBytes, attachmentLimit } from './evidence-files';
import { evidencePhase, phaseBudget, type EvidencePhase } from './evidence-phase';
import { derivePlayback, probeMedia } from './evidence-media';
import { qaResultSchema, type QaResult } from './qa-result';
import { fileSchema, resultSchema, sanitize, type FileRef, type Result, type Target } from './result';

export type ObservedEvidence = Readonly<{ result: Result | QaResult; origin: 'live' | 'historical'; note: string; provenance: null | { archiveSha256: string; resultSha256: string; acceptanceMarkerSha256: string | null } }>;
function freezeObservation(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeObservation(child);
    Object.freeze(value);
  }
}
export function finalizedEvidence(result: Result | QaResult): ObservedEvidence {
  const snapshot = 'kind' in result ? qaResultSchema.parse(result) : resultSchema.parse(result);
  freezeObservation(snapshot);
  return Object.freeze({ result: snapshot, origin: 'live', note: '', provenance: null });
}
export const deliverySchema = z.strictObject({ version: z.literal(1), state: z.enum(['complete', 'partial', 'unavailable', 'artifact-only']),
  observedState: z.enum(['PASS', 'FAIL', 'REPLICATED', 'NOT_REPLICATED', 'INCONCLUSIVE']), manifestSha256: z.string().nullable(), commentId: z.number().int().positive().nullable(),
  url: z.string().nullable(), bodySha256: z.string().nullable(), authorId: z.number().int().positive().nullable(), rendered: z.boolean(),
  assets: z.array(z.strictObject({ id: z.string(), url: z.string(), sha256: z.string(), bytes: z.number().int().positive() })), missing: z.array(z.string()), reason: z.string().nullable() }).superRefine((receipt, ctx) => {
  if (receipt.state === 'complete' && (!receipt.manifestSha256 || !receipt.commentId || !receipt.url || !receipt.bodySha256 || !receipt.authorId ||
    !receipt.rendered || receipt.missing.length || !receipt.assets.length || new Set(receipt.assets.map((asset) => asset.id)).size !== receipt.assets.length)) {
    ctx.addIssue({ code: 'custom', message: 'Complete delivery requires exact comment, author, rendered media, and verified assets.' });
  }
});
export type Delivery = z.infer<typeof deliverySchema>;
export type Destination = { kind: 'pr' | 'issue'; repository: string; number: number };
export function destination(result: Result | QaResult): Destination | null {
  const target = result.target;
  if (!target) return null;
  if (target.kind === 'triage') return { kind: 'issue', repository: target.repository, number: target.issue.number };
  return target.pullRequest ? { kind: 'pr', repository: target.repository, number: target.pullRequest } : null;
}
export type Slot = FileRef & { id: string; role: 'screenshot' | 'original' | 'playback'; lane: string; caption: string;
  transform: Awaited<ReturnType<typeof derivePlayback>>['transform'] | null };
export type Manifest = { version: 1; origin: 'live' | 'historical'; note: string; provenance: ObservedEvidence['provenance']; workflow: 'qa' | 'ci' | 'triage' | 'testerarmy';
  runId: string; runUrl: string; attemptId: string; state: Result['state']; target: Target; destination: Destination; summary: string[]; slots: Slot[] };

export function plain(text: string) {
  return sanitize(text, []).slice(0, 2200).replace(/[&<>"'`*_[\]()#!|@\\{}~:.\r\n]/g,
    (character) => `&#${character.charCodeAt(0)};`);
}
export function runUrl(runId: string, value: string | null) {
  if (!/^[a-f0-9-]{36}$/.test(runId) || value !== `https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/${runId}`) throw new Error('Workflow URL does not bind the exact run and project.');
  return value;
}

export async function stageEvidence({ observed, root, directory, env, phase = evidencePhase() }: { observed: ObservedEvidence; root: string; directory: string; env: NodeJS.ProcessEnv; phase?: EvidencePhase }): Promise<Manifest> {
  const result = observed.result;
  const target = result.target;
  const to = destination(result);
  if (!target || !to) throw new Error('No validated publication target.');
  const url = runUrl(result.runId, result.runUrl);
  await mkdir(directory, { mode: 0o700 });
  const slots: Slot[] = [];
  const summary: string[] = [];
  const groups = 'kind' in result ? result.lanes.map((lane) => ({ id: lane.id, state: lane.state, attemptId: lane.attemptId,
    session: lane.session?.id, identity: lane.identity, screenshots: lane.screenshots, recording: lane.recording,
    checks: lane.verdict ? [lane.verdict] : [], cleanup: lane.cleanup.state }))
    : [{ id: 'device', state: result.state, attemptId: result.attemptId, session: result.session?.id,
      identity: result.state === 'INCONCLUSIVE' ? null : result.evidence.identity,
      screenshots: result.state === 'INCONCLUSIVE' ? result.evidence.filter((ref) => ref.path.endsWith('.png')) : result.evidence.screenshots,
      recording: result.state === 'INCONCLUSIVE' ? result.evidence.find((ref) => ref.path.endsWith('.mp4')) ?? null : result.evidence.recording,
      checks: result.state === 'INCONCLUSIVE' ? result.agentObservation?.checks ?? [] : result.verdict.checks, cleanup: result.cleanup.state }];
  for (const group of groups) {
    phaseBudget(phase, 1);
    const prefix = group.id === 'device' ? '' : group.id + '/';
    if (group.identity) await evidenceBytes(root, prefix + fileSchema.parse(group.identity).path, group.identity);
    summary.push(`Lane ${group.id}. Observed ${group.state}. Attempt ${group.attemptId ?? 'unavailable'}. Session ${group.session ?? 'unavailable'}. Cleanup ${group.cleanup}.`);
    for (const check of group.checks) summary.push(`Agent observation ${group.id}/${check.id}. ${check.state}. ${check.detail}`);
    const names = new Set(group.screenshots.map((file) => file.path));
    if (names.size !== group.screenshots.length || group.checks.some((check) => !names.has(check.screenshot)) && group.state !== 'INCONCLUSIVE') throw new Error('Check screenshots are incomplete or duplicated.');
    for (const reference of group.screenshots) {
      const ref = fileSchema.parse(reference);
      if (!/^[a-z0-9-]+\.png$/.test(ref.path)) throw new Error('Unsafe screenshot reference.');
      const path = `${group.id}-${ref.path}`;
      const bytes = await evidenceBytes(root, prefix + ref.path, ref, attachmentLimit);
      await writeFile(join(directory, path), bytes, { flag: 'wx', mode: 0o600 });
      const media = await probeMedia(join(directory, path), directory, env, phase);
      if (media.codec_name !== 'png' || media.frames !== 1) throw new Error('Screenshot is not a single PNG frame.');
      const check = group.checks.find((check) => check.screenshot === ref.path);
      const state = group.state === 'INCONCLUSIVE' ? 'INCONCLUSIVE partial observation' : check?.state ?? group.state;
      slots.push({ ...ref, path, id: path.replace('.png', ''), role: 'screenshot', lane: group.id,
        caption: `${group.id} ${ref.path.replace('.png', '')}. ${state}`, transform: null });
    }
    if (group.recording) {
      const ref = fileSchema.parse(group.recording);
      if (ref.path !== 'session.mp4') throw new Error('Unexpected original recording reference.');
      const path = `${group.id}-original.mp4`;
      const bytes = await evidenceBytes(root, prefix + ref.path, ref, attachmentLimit);
      await writeFile(join(directory, path), bytes, { flag: 'wx', mode: 0o600 });
      await probeMedia(join(directory, path), directory, env, phase);
      slots.push({ ...ref, path, id: `${group.id}-original`, role: 'original', lane: group.id,
        caption: `${group.id} unchanged original recording`, transform: null });
      const playback = await derivePlayback({ directory, original: path, output: `${group.id}-playback.mp4`, env, phase });
      slots.push({ ...playback, id: `${group.id}-playback`, role: 'playback', lane: group.id,
        caption: `${group.id} edited playback, timing normalized. All ${playback.transform.frames} decoded frames preserved in order. H.264/yuv420p at 15 fps. Not timing or latency evidence.` });
    }
  }
  if ('kind' in result) summary.push(`Concurrent turns ${result.concurrent}. Server ${result.server.stop?.state ?? 'unavailable'}. Healthy ${result.server.stop?.healthy ?? false}. Forced ${result.server.stop?.forced ?? false}.`);
  summary.push(`Subscription ${result.auth}.`);
  if (result.state === 'INCONCLUSIVE') summary.push(`INCONCLUSIVE partial observation. ${result.reason}`);
  if (slots.length > 49 || slots.reduce((sum, slot) => sum + slot.bytes, 0) > 120_000_000) throw new Error('Publication attachment bounds exceeded.');
  return { version: 1, origin: observed.origin, note: observed.note, provenance: observed.provenance, workflow: 'kind' in result ? 'qa' : target.kind === 'triage' ? 'triage' : 'ci',
    runId: result.runId, runUrl: url, attemptId: result.attemptId, state: result.state, target, destination: to, summary, slots };
}

export function markerIdentity(manifest: Manifest) {
  return `lob-agent:evidence:v1:${manifest.destination.kind}:${manifest.destination.number}:${manifest.workflow}:${manifest.runId}:${manifest.attemptId}`;
}
export function renderEvidence(manifest: Manifest, marker: string, selected: readonly Slot[], urls: ReadonlyMap<string, string>, state: 'pending' | 'partial' | 'complete' | 'stale') {
  const target = manifest.target;
  const native = target.native.kind === 'repacked' ? `Installed repack ${target.native.installed}. Native source ${target.native.source} at ${target.native.sourceSha}.`
    : `Installed build ${target.native.installed} at ${target.native.sourceSha}.`;
  const lines = [marker, `## ${manifest.workflow === 'qa' ? 'QA Swarm iOS' : manifest.workflow === 'triage' ? 'Bug triage iOS' : manifest.workflow === 'testerarmy' ? 'TesterArmy e2e iOS' : 'Agentic CI iOS'}: ${manifest.state}`,
    '', `Publication ${state === 'pending' ? 'pending verification' : state}. Observed device verdict ${manifest.state}.`, '',
    state === 'stale' ? 'Stale or unverified destination. Archived observation only. No current-head verdict is asserted.' : manifest.origin === 'historical' ? 'Historical backfill of an archived observation. No current-head verdict is asserted.' : 'Live controller observation.',
    plain(manifest.note), ...(manifest.provenance ? [`Reviewed archive SHA-256 ${manifest.provenance.archiveSha256}. Original result SHA-256 ${manifest.provenance.resultSha256}.`] : []), '', `Source [${target.source.sha}](https://github.com/${target.repository}/commit/${target.source.sha}) on ${plain(target.source.ref)}.`,
    `[Workflow ${manifest.runId}](${manifest.runUrl}). Attempt ${manifest.attemptId}.`, plain(native),
    `Fixture SHA-256 ${target.fixture.sha256}. Original criteria SHA-256 ${target.criteria.sha256}.`,
    ...(target.issue ? [`Original issue ${target.issue.number}, input SHA-256 ${target.issue.sha256}.`] : []), '', ...manifest.summary.map(plain), ''];
  for (const slot of selected) {
    const url = urls.get(slot.id) ?? (state === 'pending' ? slot.path : null);
    lines.push(`<!-- lob-agent:slot:${slot.id}:${slot.sha256} -->`, plain(slot.caption),
      ...(slot.role !== 'screenshot' && manifest.note ? [plain(manifest.note)] : []), `SHA-256 ${slot.sha256}, ${slot.bytes} bytes.`, '');
    if (url) lines.push(slot.role === 'original' ? `[Download unchanged original recording](${url})`
      : slot.role === 'playback' && urls.has(slot.id) ? url : `![${slot.role === 'playback' ? '' : plain(slot.caption)}](${url})`);
    else lines.push(`Missing media ${slot.id}.`);
    lines.push('');
  }
  const body = lines.join('\n');
  if (body.length > 30_000) throw new Error('Evidence comment exceeds its bounded size.');
  return body;
}

export function publicationStatus(result: Result | QaResult, receipt: Delivery) {
  return { state: !['complete', 'artifact-only'].includes(receipt.state) ? 'INCONCLUSIVE' : result.state,
    observed_state: result.state, attemptId: result.attemptId, publication_state: receipt.state, publication_url: receipt.url ?? '' };
}
