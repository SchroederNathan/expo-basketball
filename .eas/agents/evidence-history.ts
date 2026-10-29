import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import registry from './evidence-history.json';
import { destination, finalizedEvidence, type ObservedEvidence } from './evidence';
import { publishEvidenceComment } from './evidence-publisher';
import { evidencePhase } from './evidence-phase';
import { prepareEvidenceWriter } from './evidence-tools';
import { qaResultSchema } from './qa-result';
import { command, safeEnvironment, succeeded } from './process';
import { digest, resultSchema } from './result';

const historyIdSchema = z.enum(['ci-pr4', 'qa-pr4', 'triage-original', 'triage-repaired']);
export async function importHistorical({ id, archive, directory, cwd }: { id: z.infer<typeof historyIdSchema>; archive: string; directory: string; cwd: string }): Promise<ObservedEvidence> {
  const pin = registry[id];
  const result = await command({ executable: { file: 'python3', args: [] }, args: [join(cwd, '.eas/agents/evidence-archive.py'), id, resolve(archive), directory],
    cwd, env: safeEnvironment(process.env), timeoutMs: 60_000 });
  if (!succeeded(result)) throw new Error('Pinned historical archive admission failed.');
  const raw = await readFile(join(directory, 'result.json'));
  if (digest(raw) !== pin.resultSha256) throw new Error('Historical result pin mismatch.');
  const parsed: unknown = JSON.parse(raw.toString());
  // The old QA controller omitted runUrl. Its exact pinned archive is the only migration allowed here.
  const legacy = pin.kind === 'qa' ? z.object({ runId: z.literal(pin.runId) }).passthrough().parse(parsed) : null;
  const observation = legacy ? qaResultSchema.parse({ ...legacy, runUrl: `https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/${pin.runId}` }) : resultSchema.parse(parsed);
  const target = observation.target;
  if (!target || target.repository !== 'SchroederNathan/expo-basketball' || target.source.sha !== pin.sourceSha ||
    destination(observation)?.number !== (pin.kind === 'triage' ? 3 : 4)) throw new Error('Historical destination/source pin mismatch.');
  const sourceReceipts = [];
  for (const path of ['.eas/agents/result.ts', ...(pin.kind === 'qa' ? ['.eas/agents/qa-swarm.ts'] : []), target.criteria.path, 'demo/fixtures/prizepicks-v1.json']) {
    const file = await command({ executable: { file: 'git', args: [] }, args: ['show', `${pin.sourceSha}:${path}`], cwd,
      env: safeEnvironment(process.env), timeoutMs: 10_000 });
    if (!succeeded(file)) throw new Error('Pinned historical source is unavailable locally.');
    const hash = digest(file.stdout);
    if (path === target.criteria.path && hash !== target.criteria.sha256 || path === 'demo/fixtures/prizepicks-v1.json' && hash !== target.fixture.sha256) throw new Error('Historical source/criteria/fixture mismatch.');
    sourceReceipts.push({ path, sha256: hash });
  }
  await writeFile(join(directory, 'historical-import.json'), JSON.stringify({ ...pin, sourceReceipts, origin: 'historical', archiveVerified: true, allReferencesVerified: true }, null, 2), { flag: 'wx', mode: 0o600 });
  return Object.freeze({ ...finalizedEvidence(observation), origin: 'historical', note: pin.note, provenance: { archiveSha256: pin.archiveSha256, resultSha256: pin.resultSha256, acceptanceMarkerSha256: pin.acceptanceMarkerSha256 } });
}

async function main() {
  const cancellation = new AbortController();
  process.once('SIGINT', () => cancellation.abort());
  process.once('SIGTERM', () => cancellation.abort());
  const [operation, rawId, archive, rawOutput] = process.argv.slice(2);
  if (!['import', 'publish'].includes(operation ?? '') || !archive || !rawOutput) throw new Error('Usage: evidence-history.ts <import|publish> <audited-set> <archive> <output-directory>');
  const id = historyIdSchema.parse(rawId);
  const output = resolve(rawOutput);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(tmpdir(), 'lob-history-'));
  try {
    const imported = join(temporary, 'admitted');
    const observed = await importHistorical({ id, archive, directory: imported, cwd: process.cwd() });
    if (operation === 'import') {
      await writeFile(join(output, `${id}-import.json`), await readFile(join(imported, 'historical-import.json')), { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Historical ${id} archive, source, and evidence hashes verified. No publication attempted.\n`);
      return;
    }
    const writer = await prepareEvidenceWriter({ repository: 'SchroederNathan/expo-basketball', env: process.env, directory: join(output, '.tools'), phase: evidencePhase(cancellation.signal, 120_000) });
    await writeFile(join(output, `historical-import-${crypto.randomUUID()}.json`), await readFile(join(imported, 'historical-import.json')), { flag: 'wx', mode: 0o600 });
    const receipt = await publishEvidenceComment({ observed, root: imported, receiptRoot: output, writer, cwd: process.cwd(), env: process.env, phase: evidencePhase(cancellation.signal) });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    process.exitCode = receipt.state === 'complete' ? 0 : 2;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  process.stderr.write('Historical evidence command failed. No new device verdict is asserted.\n'); process.exitCode = 2;
});
