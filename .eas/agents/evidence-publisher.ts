import { mkdtemp, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { assetUrl, attachmentLimit, evidenceBytes, publicBytes } from './evidence-files';
import { deliverySchema, destination, markerIdentity, renderEvidence, stageEvidence, type Delivery, type Manifest, type ObservedEvidence, type Slot } from './evidence';
import { evidencePhase, phaseBudget, type EvidencePhase } from './evidence-phase';
import { type EvidenceWriter } from './evidence-tools';
import { commentSchema, PublicationConflict } from './github';
import { freezeIssue, readAcceptance } from './issue';
import { command } from './process';
import { digest, shaSchema } from './result';

type Comment = z.infer<typeof commentSchema>;
type Network = { download: (url: string, limit: number, signal?: AbortSignal) => Promise<Uint8Array> };
const network: Network = { download: (url, limit, signal) => publicBytes(url, limit, false, signal) };
class DestinationChanged extends Error {}
class DeliveryConflict extends PublicationConflict {
  constructor(readonly delivery: Delivery) { super('Evidence ownership or content conflict.'); }
}

function owned(comments: Comment[], identity: string, marker: string, writer: EvidenceWriter, manifest: Manifest) {
  const matches = comments.filter((comment) => comment.body.includes(identity) && (identity.includes(':recovery:') || !comment.body.split('\n')[0]!.includes(':recovery:')));
  if (matches.length > 1) throw new PublicationConflict('Duplicate evidence markers.');
  const found = matches[0];
  if (found && (found.user.id !== writer.actor || !found.body.startsWith(marker + '\n') || found.body.split(marker).length !== 2 ||
    found.html_url !== `https://github.com/${manifest.destination.repository}/${manifest.destination.kind === 'pr' ? 'pull' : 'issues'}/${manifest.destination.number}#issuecomment-${found.id}`)) {
    throw new PublicationConflict('Evidence marker, manifest, URL, or author conflict.');
  }
  return found;
}

function commentUrls(comment: Comment, manifest: Manifest, marker: string, slots: Slot[]) {
  const urls = new Map<string, string>();
  for (const slot of slots) {
    const tag = `<!-- lob-agent:slot:${slot.id}:${slot.sha256} -->`;
    const segment = comment.body.split(tag);
    if (segment.length !== 2) throw new PublicationConflict('Evidence slot marker conflict.');
    const text = segment[1]!.split('<!-- lob-agent:slot:')[0]!;
    const matched = /(?:\]\(|^)(https:\/\/[^\s)]+)(?:\)|$)/m.exec(text)?.[1];
    if (matched) urls.set(slot.id, assetUrl(matched));
  }
  const valid = ['pending', 'partial', 'complete', 'stale'].some((state) => comment.body === renderEvidence(manifest, marker, slots, urls, z.enum(['pending', 'partial', 'complete', 'stale']).parse(state)));
  if (!valid) throw new PublicationConflict('Controller-owned evidence comment content was altered.');
  return urls;
}

async function verifiedUrls(comment: Comment, manifest: Manifest, marker: string, slots: Slot[], remote: Network, phase: EvidencePhase) {
  const urls = commentUrls(comment, manifest, marker, slots);
  const verified = new Map<string, string>();
  for (const slot of slots) {
    const url = urls.get(slot.id);
    if (!url) continue;
    try {
      const bytes = await remote.download(url, attachmentLimit, phaseBudget(phase, 60_000).signal);
      if (bytes.length === slot.bytes && digest(bytes) === slot.sha256) verified.set(slot.id, url);
    } catch { phaseBudget(phase, 1); }
  }
  return verified;
}

async function persist(root: string, prefix: string, value: unknown) {
  const name = `${prefix}-${crypto.randomUUID()}.json`;
  await writeFile(join(root, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
}

export async function deliverManifest({ manifest, directory, root, writer, remote = network, phase = evidencePhase(), validateDestination }: {
  manifest: Manifest; directory: string; root: string; writer: EvidenceWriter; remote?: Network; phase?: EvidencePhase;
  validateDestination?: (phase: EvidencePhase) => Promise<void>;
}): Promise<Delivery> {
  const manifestSha256 = digest(JSON.stringify(manifest));
  const identity = markerIdentity(manifest);
  const marker = `<!-- ${identity}:${manifestSha256} -->`;
  const github = writer.github;
  let canonical: Comment | undefined;
  let rendered = false;
  const urls = new Map<string, string>();
  const issued: { key: string; tag: string; slots: Slot[] }[] = [];
  const receipt = (state: Delivery['state'], reason: string | null): Delivery => ({ version: 1, state, observedState: manifest.state,
    manifestSha256, commentId: canonical?.id ?? null, url: canonical?.html_url ?? null, bodySha256: canonical ? digest(canonical.body) : null, authorId: canonical ? writer.actor : null, rendered,
    assets: manifest.slots.flatMap((slot) => { const url = urls.get(slot.id); return url ? [{ id: slot.id, url, sha256: slot.sha256, bytes: slot.bytes }] : []; }),
    missing: manifest.slots.filter((slot) => !urls.has(slot.id)).map((slot) => slot.id), reason });
  let baseline: string | null | undefined;
  const checkDestination = async (budget: EvidencePhase) => {
    phaseBudget(budget, 1);
    try {
      if (validateDestination) await validateDestination(budget);
      else {
        const snapshot = await destinationSnapshot({ origin: manifest.origin, provenance: manifest.provenance, result: { target: manifest.target } }, manifest.destination, writer, directory, {}, budget);
        if (baseline !== undefined && baseline !== snapshot) throw new Error('Destination body changed.');
        baseline = snapshot;
      }
    } catch { throw new DestinationChanged('Destination no longer matches the observation.'); }
    phaseBudget(budget, 1);
  };
  const find = async (key: string, tag: string, budget: EvidencePhase) => owned(await github.comments(manifest.destination.number, phaseBudget(budget, 20_000).signal), key, tag, writer, manifest);
  const upload = async (key: string, tag: string, slots: Slot[]) => {
    phaseBudget(phase, 1);
    const intentPath = join(root, `publication-intent-${digest(key)}.json`);
    try {
      await writeFile(intentPath, JSON.stringify({ marker: tag, slots: slots.map((slot) => ({ id: slot.id, sha256: slot.sha256 })), manifestSha256 }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('Prior native create is ambiguous. Reconcile its marker before another upload.');
      throw error;
    }
    let invoked = false;
    const bodyFile = join(directory, `body-${digest(key)}.md`);
    try {
      for (const slot of slots) { phaseBudget(phase, 1); await evidenceBytes(directory, slot.path, slot, attachmentLimit); }
      await writeFile(bodyFile, renderEvidence(manifest, tag, slots, new Map(), 'pending'), { flag: 'wx', mode: 0o600 });
      const tool = await lstat(writer.gh.file);
      if (!tool.isFile() || tool.nlink !== 1 || digest(await readFile(writer.gh.file)) !== writer.binarySha256) throw new Error('Prepared gh binary changed.');
      await checkDestination(phase);
      const budget = phaseBudget(phase, 180_000);
      issued.push({ key, tag, slots }); invoked = true;
      const result = await command({ executable: writer.gh, cwd: directory, env: writer.env, ...budget,
        args: [manifest.destination.kind, 'comment', String(manifest.destination.number), '--repo', manifest.destination.repository,
          '--body-file', bodyFile, ...slots.flatMap((slot) => ['--attach', slot.path])] });
      await persist(root, 'publication-invocation', { marker: tag, termination: result.termination.kind,
        cli: 'gh@2.103.1', binarySha256: writer.binarySha256, exitCode: result.termination.kind === 'exited' ? result.termination.code : null });
      return await find(key, tag, phase);
    } finally {
      await rm(bodyFile, { force: true });
      if (!invoked) await rm(intentPath, { force: true });
    }
  };
  const patch = async (body: string, budget: EvidencePhase, check = true) => {
    if (!canonical) throw new Error('No canonical comment.');
    const exact = await github.exactComment(canonical.id, phaseBudget(budget, 20_000).signal);
    if (exact.body !== canonical.body || exact.user.id !== writer.actor) throw new PublicationConflict('Evidence comment changed during reconciliation.');
    if (exact.body === body) { canonical = exact; return; }
    try {
      canonical = await github.patchComment(exact.id, body, writer.actor, exact.body, phaseBudget(budget, 20_000).signal,
        async () => { if (check) await checkDestination(budget); phaseBudget(budget, 1); });
    } catch (error) {
      if (error instanceof DestinationChanged || error instanceof PublicationConflict) throw error;
      const after = await github.exactComment(exact.id, phaseBudget(budget, 20_000).signal);
      if (after.body !== body || after.user.id !== writer.actor) throw error;
      canonical = after;
    }
  };
  const isRendered = (comment: Comment) => manifest.slots.length > 0 && manifest.slots.every((slot) => {
    if (slot.role === 'original') return true;
    const id = urls.get(slot.id)?.split('/').at(-1);
    const tags = comment.body_html?.match(slot.role === 'playback' ? /<video\b[^>]*>/g : /<img\b[^>]*>/g) ?? [];
    return id !== undefined && tags.some((tag) => tag.includes(id));
  });
  let delivery: Delivery;
  try {
    renderEvidence(manifest, marker, manifest.slots, urls, 'pending');
    await checkDestination(phase);
    canonical = await find(identity + ':', marker, phase);
    if (!canonical) canonical = await upload(identity + ':', marker, manifest.slots);
    if (!canonical) throw new Error('Native create has no reconciled owned comment.');
    await checkDestination(phase);
    for (const [id, url] of await verifiedUrls(canonical, manifest, marker, manifest.slots, remote, phase)) urls.set(id, url);
    for (let batch = 0; urls.size < manifest.slots.length && batch < 2; batch++) {
      phaseBudget(phase, 1);
      const missing = manifest.slots.filter((slot) => !urls.has(slot.id));
      const key = `${identity}:recovery:${digest(missing.map((slot) => slot.id).join(','))}:${batch}`;
      const tag = `<!-- ${key}:${manifestSha256} -->`;
      const recovery = await find(key + ':', tag, phase) ?? await upload(key + ':', tag, missing);
      if (!recovery) break;
      await checkDestination(phase);
      for (const [id, url] of await verifiedUrls(recovery, manifest, tag, missing, remote, phase)) urls.set(id, url);
    }
    const complete = urls.size === manifest.slots.length && manifest.slots.length > 0;
    const partialBody = renderEvidence(manifest, marker, manifest.slots, urls, 'partial');
    if (!complete || canonical.body !== renderEvidence(manifest, marker, manifest.slots, urls, 'complete')) await patch(partialBody, phase);
    const verified = await github.exactComment(canonical.id, phaseBudget(phase, 20_000).signal);
    if (verified.body !== canonical.body || verified.user.id !== writer.actor) throw new PublicationConflict('Evidence readback mismatch.');
    rendered = isRendered(verified);
    if (complete && !rendered) throw new Error('Rendered evidence lacks expected media tags.');
    await checkDestination(phase);
    if (complete) {
      await patch(renderEvidence(manifest, marker, manifest.slots, urls, 'complete'), phase);
      await checkDestination(phase);
      const final = await github.exactComment(canonical.id, phaseBudget(phase, 20_000).signal);
      if (final.body !== canonical.body || final.user.id !== writer.actor) throw new PublicationConflict('Evidence final readback mismatch.');
      rendered = isRendered(final);
      if (!rendered) throw new Error('Final rendering verification failed.');
      await checkDestination(phase);
    }
    delivery = receipt(complete ? 'complete' : 'partial', complete ? null : 'Some media could not be anonymously hash-verified.');
  } catch (error) {
    const reconcile = evidencePhase(undefined, 10_000);
    let stale = error instanceof DestinationChanged;
    try {
      if (!canonical && issued.length) canonical = await find(identity + ':', marker, reconcile);
      if (canonical) {
        const exact = await github.exactComment(canonical.id, phaseBudget(reconcile, 20_000).signal);
        owned([exact], identity + ':', marker, writer, manifest);
        const retainedUrls = commentUrls(exact, manifest, marker, manifest.slots);
        for (const [id, url] of urls) retainedUrls.set(id, url);
        canonical = exact;
        try { await checkDestination(reconcile); } catch { stale = true; }
        await patch(renderEvidence(manifest, marker, manifest.slots, retainedUrls, stale ? 'stale' : 'partial'), reconcile, false);
      }
    } catch {}
    delivery = receipt(canonical ? 'partial' : 'unavailable', stale ? 'Destination changed or could not be revalidated. No current-result claim is verified.' : 'Publication is incomplete. Retained intents and exact markers must be reconciled.');
    await persist(root, 'publication-receipt', deliverySchema.parse(delivery));
    if (error instanceof PublicationConflict) throw new DeliveryConflict(delivery);
    return delivery;
  }
  await persist(root, 'publication-receipt', deliverySchema.parse(delivery));
  return delivery;
}

async function destinationSnapshot(observed: Pick<ObservedEvidence, 'origin' | 'provenance'> & { result: Pick<ObservedEvidence['result'], 'target'> }, to: Manifest['destination'], writer: EvidenceWriter, cwd: string, env: NodeJS.ProcessEnv, phase: EvidencePhase) {
  const target = observed.result.target!;
  if (to.kind === 'issue') {
    if (observed.origin === 'live' && target.issue) {
      const frozen = await freezeIssue({ env: { ...env, AGENT_REPOSITORY: to.repository,
        AGENT_ISSUE_NUMBER: String(target.issue.number), AGENT_ISSUE_DIGEST: target.issue.sha256, AGENT_CRITERIA_SHA256: target.criteria.sha256 }, cwd, get: (path) => writer.github.get(path, phaseBudget(phase, 20_000).signal) });
      if (frozen.identity.id !== target.issue.id || frozen.identity.nodeId !== target.issue.nodeId) throw new PublicationConflict('Issue destination identity mismatch.');
      return null;
    }
    const issue = z.object({ number: z.number(), id: z.number(), node_id: z.string(), pull_request: z.unknown().optional() }).parse(await writer.github.get(`/issues/${to.number}`, phaseBudget(phase, 20_000).signal));
    if (!target.issue || issue.number !== target.issue.number || issue.id !== target.issue.id || issue.node_id !== target.issue.nodeId || issue.pull_request) throw new PublicationConflict('Issue destination identity mismatch.');
    return null;
  }
  const pr = z.object({ number: z.number(), body: z.string().nullable(), head: z.object({ sha: shaSchema, ref: z.string(), repo: z.object({ full_name: z.string() }) }),
    base: z.object({ repo: z.object({ full_name: z.string() }) }) }).parse(await writer.github.get(`/pulls/${to.number}`, phaseBudget(phase, 20_000).signal));
  if (pr.number !== to.number || pr.head.repo.full_name !== to.repository || pr.base.repo.full_name !== to.repository ||
    observed.origin === 'live' && (pr.head.sha !== target.source.sha || pr.head.ref !== target.source.ref)) throw new PublicationConflict('PR publication destination mismatch.');
  const acceptance = readAcceptance(pr.body ?? '');
  if (target.kind === 'acceptance' && (!acceptance || acceptance.repository !== to.repository || JSON.stringify(acceptance.issue) !== JSON.stringify(target.issue) || acceptance.criteriaSha256 !== target.criteria.sha256)) throw new PublicationConflict('Original PR acceptance criteria mismatch.');
  const expectedMarker = observed.provenance?.acceptanceMarkerSha256;
  if (expectedMarker && digest((pr.body ?? '').match(/<!-- lob-agent-acceptance:v1 [A-Za-z0-9_-]+ -->/)?.[0] ?? '') !== expectedMarker) throw new PublicationConflict('Historical original acceptance marker changed.');
  return pr.body ?? '';
}

export async function publishEvidenceComment({ observed, root, writer, cwd, env, receiptRoot = root, remote, phase = evidencePhase() }: {
  observed: ObservedEvidence; root: string; writer: EvidenceWriter | null; cwd: string; env: NodeJS.ProcessEnv; receiptRoot?: string; remote?: Network; phase?: EvidencePhase;
}): Promise<Delivery> {
  if (!destination(observed.result)) return { version: 1, state: 'artifact-only', observedState: observed.result.state, manifestSha256: null, commentId: null, url: null, bodySha256: null, authorId: null, rendered: false, assets: [], missing: [], reason: null };
  const directory = await mkdtemp(join(tmpdir(), 'lob-evidence-'));
  const staged = join(directory, 'media');
  let delivery: Delivery = { version: 1, state: 'unavailable', observedState: observed.result.state, manifestSha256: null, commentId: null, url: null, bodySha256: null, authorId: null, rendered: false, assets: [], missing: [], reason: 'Publication readiness or admission failed.' };
  try {
    if (!writer) throw new Error('No prepared writer.');
    const before = await destinationSnapshot(observed, destination(observed.result)!, writer, cwd, env, phase);
    if (observed.origin === 'live') {
      const target = observed.result.target!;
      if (digest(await readFile(join(cwd, target.criteria.path))) !== target.criteria.sha256 ||
        digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'))) !== target.fixture.sha256) throw new Error('Source criteria or fixture changed.');
    }
    const manifest = await stageEvidence({ observed, root, directory: staged, env, phase });
    await persist(receiptRoot, 'publication-manifest', manifest);
    delivery = await deliverManifest({ manifest, directory: staged, root: receiptRoot, writer, remote, phase, validateDestination: async (budget) => {
      const after = await destinationSnapshot(observed, manifest.destination, writer, cwd, env, budget);
      if (before !== after) throw new PublicationConflict('PR body changed during evidence publication.');
    } });
  } catch (error) {
    if (error instanceof DeliveryConflict) delivery = error.delivery;
    delivery = { ...delivery, state: delivery.commentId ? 'partial' : 'unavailable', reason: 'Publication admission, destination, ownership, or delivery verification failed.' };
  } finally {
    try { await persist(receiptRoot, 'publication-receipt', deliverySchema.parse(delivery)); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  return delivery;
}
