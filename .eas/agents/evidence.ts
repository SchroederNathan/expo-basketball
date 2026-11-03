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
  url: z.string().nullable(), bodySha256: z.string().nullable(), authorId: z.number().int().positive().nullable(), rendered: z.boolean(), report: z.string().nullable().default(null),
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
export type ManifestCheck = { lane: string; id: string; state: 'PASS' | 'FAIL' | 'BLOCKED'; detail: string };
export type Manifest = { version: 1; origin: 'live' | 'historical'; note: string; provenance: ObservedEvidence['provenance']; workflow: 'qa' | 'ci' | 'triage' | 'testerarmy';
  runId: string; runUrl: string; attemptId: string; state: Result['state']; target: Target; destination: Destination; summary: string[];
  checks: ManifestCheck[]; reason: string | null; slots: Slot[];
  // Where media is uploaded when the Expo bot, not the token, posts the report.
  uploads?: Destination };

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
  const checks: ManifestCheck[] = [];
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
    for (const check of group.checks) checks.push({ lane: group.id, id: check.id, state: check.state, detail: check.detail });
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
  if (slots.length > 49 || slots.reduce((sum, slot) => sum + slot.bytes, 0) > 120_000_000) throw new Error('Publication attachment bounds exceeded.');
  return { version: 1, origin: observed.origin, note: observed.note, provenance: observed.provenance, workflow: 'kind' in result ? 'qa' : target.kind === 'triage' ? 'triage' : 'ci',
    runId: result.runId, runUrl: url, attemptId: result.attemptId, state: result.state, target, destination: to, summary,
    checks, reason: result.state === 'INCONCLUSIVE' ? result.reason : null, slots };
}

export function markerIdentity(manifest: Manifest) {
  return `lob-agent:evidence:v1:${manifest.destination.kind}:${manifest.destination.number}:${manifest.workflow}:${manifest.runId}:${manifest.attemptId}`;
}
const verdictMark: Record<Manifest['state'], string> = { PASS: '🟢', NOT_REPLICATED: '🟢', FAIL: '🔴', REPLICATED: '🔴', INCONCLUSIVE: '⚪' };
const checkMark: Record<ManifestCheck['state'], string> = { PASS: '🟢', FAIL: '🔴', BLOCKED: '⚪' };
const workflowTitle: Record<Manifest['workflow'], string> = { qa: 'QA Swarm iOS', triage: 'Bug triage iOS', testerarmy: 'E2E iOS', ci: 'Agentic CI iOS' };

function checkCounts(checks: readonly ManifestCheck[]) {
  if (!checks.length) return 'no check finished';
  const count = (state: ManifestCheck['state']) => checks.filter((check) => check.state === state).length;
  const parts = [[count('FAIL'), 'failed'], [count('BLOCKED'), 'blocked'], [count('PASS'), 'passed']] as const;
  return parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(', ');
}

function slotLabel(slot: Slot, checks: readonly ManifestCheck[]) {
  const name = slot.path.replace(/\.png$/, '').replace(new RegExp(`^(${slot.lane}|testerarmy)-`), '');
  const check = checks.find((candidate) => candidate.id === name && (candidate.lane === slot.lane || slot.lane === 'ios'));
  return `${check ? checkMark[check.state] + ' ' : ''}${plain(name)}`;
}

function slotMedia(slot: Slot, url: string | null, label: string) {
  if (!url) return `Missing media ${slot.id}.`;
  if (slot.role === 'original') return `[Download the original recording](${url})`;
  if (slot.role === 'playback') return url.startsWith('https://') ? url : `![](${url})`;
  return `![${label}](${url})`;
}

// One short comment per run, laid out like the e2e GitHub reporter: verdict,
// reason, checks, then the screenshots and recording. Run details are folded
// at the end and hold no links, because each media slot's section, which runs
// to the next slot or the end, must hold only its own asset link.
export function renderEvidence(manifest: Manifest, marker: string, selected: readonly Slot[], urls: ReadonlyMap<string, string>, state: 'pending' | 'partial' | 'complete' | 'stale') {
  const target = manifest.target;
  const sha = target.source.sha;
  const lines = [marker, `### ${verdictMark[manifest.state]} ${workflowTitle[manifest.workflow]}: ${manifest.state} · ${checkCounts(manifest.checks)}`,
    `[\`${sha.slice(0, 7)}\`](https://github.com/${target.repository}/commit/${sha}) on ${plain(target.source.ref)} · [Workflow](${manifest.runUrl})`, ''];
  if (manifest.reason) lines.push(`**${plain(manifest.reason)}**`, '');
  if (state === 'stale') lines.push('> Publication stale. This destination changed or could not be checked again. No current-head verdict is asserted.', '');
  else if (manifest.origin === 'historical') lines.push('> Historical backfill of an archived observation. No current-head verdict is asserted.', '');
  else if (state === 'partial') lines.push('> Some media could not be verified, so it may be missing below.', '');
  if (manifest.checks.length) {
    const lanes = new Set(manifest.checks.map((check) => check.lane)).size > 1;
    lines.push('| | Check | Result |', '| --- | --- | --- |',
      ...manifest.checks.map((check) => `| ${checkMark[check.state]} | ${plain(lanes ? `${check.lane}/${check.id}` : check.id)} | ${plain(check.detail)} |`), '');
  }
  const media = (slot: Slot) => slotMedia(slot, urls.get(slot.id) ?? (state === 'pending' ? slot.path : null), plain(slot.caption));
  const tag = (slot: Slot) => `<!-- lob-agent:slot:${slot.id}:${slot.sha256} -->`;
  const shots = selected.filter((slot) => slot.role === 'screenshot');
  for (let row = 0; row < shots.length; row += 3) {
    const group = shots.slice(row, row + 3);
    lines.push(`| ${group.map((slot) => slotLabel(slot, manifest.checks)).join(' | ')} |`, `|${' --- |'.repeat(group.length)}`,
      `| ${group.map((slot) => `${tag(slot)} ${media(slot)}`).join(' | ')} |`, '');
  }
  const playback = selected.filter((slot) => slot.role === 'playback');
  const originals = selected.filter((slot) => slot.role === 'original');
  if (playback.length || originals.length) lines.push('**Recording** · playback re-timed to 15 fps, every frame kept', '');
  for (const slot of [...playback, ...originals]) lines.push(tag(slot), media(slot), '');
  lines.push('<details>', '<summary>Run details</summary>', '',
    `Publication ${state === 'pending' ? 'pending verification' : state}. Observed device verdict ${manifest.state}.`,
    manifest.origin === 'historical' ? 'Historical backfill.' : 'Live controller observation.', ...(manifest.note ? [plain(manifest.note)] : []),
    ...(manifest.provenance ? [`Reviewed archive SHA-256 ${manifest.provenance.archiveSha256}. Original result SHA-256 ${manifest.provenance.resultSha256}.`] : []),
    `Source ${sha} on ${plain(target.source.ref)}. Workflow ${manifest.runId}. Attempt ${manifest.attemptId}.`,
    target.native.kind === 'repacked' ? `Installed repack ${target.native.installed}. Native source ${target.native.source} at ${target.native.sourceSha}.`
      : `Installed build ${target.native.installed} at ${target.native.sourceSha}.`,
    `Fixture SHA-256 ${target.fixture.sha256}. Original criteria SHA-256 ${target.criteria.sha256}.`,
    ...(target.issue ? [`Original issue ${target.issue.number}, input SHA-256 ${target.issue.sha256}.`] : []), ...manifest.summary.map(plain),
    ...selected.map((slot) => `${plain(slot.id)}: SHA-256 ${slot.sha256}, ${slot.bytes} bytes. ${plain(slot.caption)}`), '', '</details>');
  const body = lines.join('\n');
  if (body.length > 30_000) throw new Error('Evidence comment exceeds its bounded size.');
  return body;
}

// The text the Expo bot posts: the same report without the hidden markers the
// token-owned upload comment needs for reconciliation.
export function renderReport(manifest: Manifest, urls: ReadonlyMap<string, string>, state: 'partial' | 'complete' | 'stale') {
  return renderEvidence(manifest, '', manifest.slots, urls, state).replace(/^\n/, '').replace(/<!-- lob-agent:slot:[^>]* --> ?/g, '');
}

function fallbackReport(result: Result | QaResult) {
  const reason = result.state === 'INCONCLUSIVE' ? `\n\n**${plain(result.reason ?? 'The run did not finish.')}**` : '';
  return `### ${verdictMark[result.state]} Agentic CI iOS: ${result.state}${reason}\n\nThe evidence could not be published.${result.runUrl ? ` [Workflow](${result.runUrl})` : ''}`;
}

export function publicationStatus(result: Result | QaResult, receipt: Delivery) {
  return { state: !['complete', 'artifact-only'].includes(receipt.state) ? 'INCONCLUSIVE' : result.state,
    observed_state: result.state, attemptId: result.attemptId, publication_state: receipt.state, publication_url: receipt.url ?? '',
    comment_body: receipt.report ?? fallbackReport(result) };
}
