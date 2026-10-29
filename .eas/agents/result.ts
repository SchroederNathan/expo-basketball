import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/).brand('Sha');
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/).brand('Digest');
export const buildIdSchema = z.uuid().brand('BuildId');
export const sourceSchema = z.strictObject({ ref: z.string().min(1).max(200), sha: shaSchema });
export type Source = z.infer<typeof sourceSchema>;
export const issueRefSchema = z.strictObject({ number: z.number().int().positive(), id: z.number().int().positive(), nodeId: z.string().min(1), sha256: digestSchema });
export const fixtureSchema = z.strictObject({
  id: z.literal('prizepicks-v1'), sha256: digestSchema,
  date: z.literal('20261026'), zone: z.literal('America/Toronto'),
});
const targetFields = {
  controller: sourceSchema,
  source: sourceSchema,
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  pullRequest: z.number().int().positive().nullable(),
  platform: z.literal('ios'),
  appId: z.literal('dev.expo.basketball'),
  profile: z.literal('agent-preview'),
  environment: z.literal('preview'),
  fingerprint: z.string().regex(/^[a-f0-9]{40,64}$/),
  runtime: z.literal('1.0.0'),
  fixture: fixtureSchema,
  native: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('built'), installed: buildIdSchema, sourceSha: shaSchema }),
    z.strictObject({ kind: z.literal('repacked'), source: buildIdSchema, sourceSha: shaSchema, installed: buildIdSchema }),
  ]),
  bundle: z.strictObject({ kind: z.literal('embedded'), candidate: shaSchema }),
};
export const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...targetFields, kind: z.literal('check'), issue: z.null(),
    criteria: z.strictObject({ path: z.literal('.eas/agents/check-ios.md'), sha256: digestSchema }) }),
  z.strictObject({ ...targetFields, kind: z.enum(['triage', 'acceptance']), issue: issueRefSchema,
    criteria: z.strictObject({ path: z.literal('demo/issues/player-label.md'), sha256: digestSchema }) }),
]).superRefine((target, ctx) => {
  if (target.controller.sha !== target.source.sha || target.bundle.candidate !== target.source.sha) {
    ctx.addIssue({ code: 'custom', message: 'Controller, checkout, and candidate SHA must agree.' });
  }
  if (target.native.kind === 'repacked' && target.native.source === target.native.installed) {
    ctx.addIssue({ code: 'custom', message: 'A repack must identify its new installed build separately.' });
  }
  if (target.native.kind === 'built' && target.native.sourceSha !== target.source.sha) {
    ctx.addIssue({ code: 'custom', message: 'A cold build must come from the candidate SHA.' });
  }
});
export type Target = z.infer<typeof targetSchema>;

export const sessionSchema = z.strictObject({
  id: z.uuid(), url: z.url().regex(/^https:\/\/expo\.dev\/[^?#]+$/),
  attemptId: z.uuid(), expiresAt: z.iso.datetime(),
});
export type Session = z.infer<typeof sessionSchema>;
function checksSchema<const Ids extends readonly [string, ...string[]]>(ids: Ids) {
  return z.strictObject({
    state: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    checks: z.array(z.strictObject({
      id: z.enum(ids), state: z.enum(['PASS', 'FAIL', 'BLOCKED']),
      detail: z.string().min(1).max(2000), screenshot: z.string().regex(/^[a-z0-9-]+\.png$/),
    })).length(ids.length),
  }).superRefine((verdict, ctx) => {
    if (new Set(verdict.checks.map((check) => check.id)).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Each acceptance check must appear exactly once.' });
    }
    const expected = verdict.checks.some((check) => check.state === 'BLOCKED') ? 'INCONCLUSIVE'
      : verdict.checks.some((check) => check.state === 'FAIL') ? 'FAIL' : 'PASS';
    if (verdict.state !== expected) ctx.addIssue({ code: 'custom', message: 'Verdict disagrees with checks.' });
  });
}
export const verdictSchema = checksSchema(['scores', 'current-player', 'search-back']);
export const issueVerdictSchema = checksSchema(['historical-points', 'unknown-stat', 'current-player', 'search-back']);
const deviceVerdictSchema = z.union([verdictSchema, issueVerdictSchema]);
export type Verdict = z.infer<typeof deviceVerdictSchema>;

export const terminationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exited'), code: z.number().int() }),
  z.strictObject({ kind: z.enum(['timeout', 'signal', 'not-started']), reason: z.string() }),
]);
export type Termination = z.infer<typeof terminationSchema>;
export const cleanupSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not-needed') }),
  z.strictObject({ state: z.literal('stopped'), sessionId: z.uuid() }),
  z.strictObject({ state: z.literal('unconfirmed'), sessionId: z.uuid().nullable(), expiresAt: z.iso.datetime() }),
]);
export type Cleanup = z.infer<typeof cleanupSchema>;
const fileSchema = z.strictObject({ path: z.string(), sha256: digestSchema, bytes: z.number().int().positive() });
export type FileRef = z.infer<typeof fileSchema>;
const evidenceSchema = z.strictObject({
  identity: fileSchema,
  screenshots: z.tuple([fileSchema]).rest(fileSchema),
  recording: fileSchema,
  recordingSessionId: z.uuid(),
});
const recordFields = {
  version: z.literal(1), runId: z.string().min(1), runUrl: z.url().regex(/^https:\/\/expo\.dev\/[^?#]+$/).nullable(),
  attemptId: z.uuid(), jobKey: z.enum(['check-ios', 'triage-ios', 'acceptance-ios']),
  target: targetSchema.nullable(), session: sessionSchema.nullable(),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  termination: terminationSchema, cleanup: cleanupSchema,
  auth: z.enum(['not-loaded', 'persisted', 'write-back-failed']),
  tools: z.strictObject({ bun: z.literal('1.2.22'), eas: z.literal('25.3.0'), codex: z.literal('0.165.0'), agentDevice: z.literal('0.21.33') }),
};
export const resultSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...recordFields, target: targetSchema, session: sessionSchema,
    termination: z.strictObject({ kind: z.literal('exited'), code: z.literal(0) }),
    cleanup: z.strictObject({ state: z.literal('stopped'), sessionId: z.uuid() }), auth: z.literal('persisted'),
    state: z.enum(['PASS', 'FAIL', 'REPLICATED', 'NOT_REPLICATED']), verdict: deviceVerdictSchema, evidence: evidenceSchema }),
  z.strictObject({ ...recordFields, state: z.literal('INCONCLUSIVE'), reason: z.string(),
    agentObservation: deviceVerdictSchema.nullable(), evidence: z.array(fileSchema) }),
]).superRefine((result, ctx) => {
  if (result.state !== 'INCONCLUSIVE') {
    const jobKey = result.target.kind === 'check' ? 'check-ios' : result.target.kind === 'triage' ? 'triage-ios' : 'acceptance-ios';
    if (result.jobKey !== jobKey) ctx.addIssue({ code: 'custom', message: 'Job and task disagree.' });
    const schema = result.target.kind === 'check' ? verdictSchema : issueVerdictSchema;
    if (!schema.safeParse(result.verdict).success) ctx.addIssue({ code: 'custom', message: 'Wrong task verdict.' });
    const state = result.target.kind === 'triage' ? result.verdict.state === 'FAIL' ? 'REPLICATED' : 'NOT_REPLICATED' : result.verdict.state;
    if (state !== result.state ||
      result.cleanup.sessionId !== result.session.id || result.evidence.recordingSessionId !== result.session.id ||
      result.session.attemptId !== result.attemptId || result.verdict.state === 'INCONCLUSIVE') {
      ctx.addIssue({ code: 'custom', message: 'Result, verdict, attempt, recording, and cleanup identities disagree.' });
    }
  }
});
export type Result = z.infer<typeof resultSchema>;

export function digest(bytes: string | Uint8Array) {
  return digestSchema.parse(createHash('sha256').update(bytes).digest('hex'));
}

export function sanitize(text: string, secrets: readonly string[]): string {
  let clean = text;
  for (const secret of secrets) if (secret.length >= 6) clean = clean.split(secret).join('[redacted]');
  return clean.replace(/https?:\/\/[^\s"<>]+[?][^\s"<>]*/g, '[redacted-url]')
    .replace(/\b(?:Bearer\s+\S+|(?:sk|ghp|gho)-[\w-]+|eyJ[\w.-]{20,})/g, '[redacted]');
}

export async function admitFile({ directory, name, kind, startedAt }: {
  directory: string; name: string; kind: 'png' | 'mp4'; startedAt: number;
}): Promise<Uint8Array> {
  if (!/^[a-z0-9-]+\.(png|mp4)$/.test(name)) throw new Error('Unsafe evidence filename.');
  if (!(await lstat(directory)).isDirectory()) throw new Error('Unsafe evidence directory.');
  const path = join(directory, name);
  const stat = await lstat(path);
  const real = await realpath(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.mtimeMs < startedAt - 1000 || stat.size > 150_000_000 ||
    !real.startsWith(`${await realpath(directory)}${sep}`)) throw new Error('Stale or unsafe evidence.');
  const bytes = await readFile(path);
  if (kind === 'png' && (bytes.length < 32 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(16) < 100 || bytes.readUInt32BE(20) < 100)) throw new Error('Missing real screenshot.');
  if (kind === 'mp4' && (bytes.length < 1000 || bytes.subarray(4, 8).toString() !== 'ftyp')) throw new Error('Missing MP4 recording.');
  return bytes;
}

export async function publishFile({ directory, name, bytes }: { directory: string; name: string; bytes: string | Uint8Array }): Promise<FileRef> {
  const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return { path: name, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) };
}
