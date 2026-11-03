import { z } from 'zod';
import { demoIssueByCriteria, demoIssueKeys, demoIssues } from '../demo-issues';
import { plain } from '../evidence';
import { fileSchema, targetSchema } from '../result';
import { cleanupSchema, ledgerSchema } from './provider';

// The e2e checks for one demo issue, in the order its test captures them.
export function e2eFor(criteria: { path: string }) { return demoIssueByCriteria(criteria.path).e2e; }
const allCheckIds = [...new Set(demoIssueKeys.flatMap((key) => demoIssues[key].e2e.checks))] as [string, ...string[]];
export const originalFixtureSha256 = '48f38c3caedfd62905a07161ec5e49df622357db6fcf3cd01555e3c8a05b75aa';
export const checkSchema = z.strictObject({ id: z.enum(allCheckIds), state: z.enum(['PASS', 'FAIL']),
  detail: z.string().min(1).max(2000), screenshot: z.string(), assertionIds: z.array(z.string().min(1)).min(1),
});
export const frameworkSchema = z.strictObject({ runId: z.string().min(1), testId: z.string().min(1),
  attemptId: z.string().min(1), resultId: z.string().min(1), status: z.enum(['passed', 'failed']), exitCode: z.union([z.literal(0), z.literal(1)]),
});
export const failureKinds = ['usage-limit', 'auth', 'rate-limit', 'overloaded', 'timeout', 'network', 'server', 'bad-request', 'other'] as const;
export const diagnosticSchema = z.strictObject({ runStatus: z.string().regex(/^[a-z-]{1,32}$/).nullable(), account: z.string().regex(/^[a-f0-9]{12}$/).nullable(),
  errors: z.array(z.strictObject({ source: z.enum(['run', 'attempt', 'secondary', 'step']), api: z.string().regex(/^[a-z][A-Za-z.]{0,63}$/).nullable(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), category: z.enum(['test', 'configuration', 'infrastructure', 'internal', 'interrupted']),
    retryable: z.boolean(), status: z.number().int().min(400).max(599).nullable(), kind: z.enum(failureKinds) })).max(8),
});
const evidenceSchema = z.strictObject({ identity: fileSchema, report: fileSchema, screenshots: z.array(fileSchema).min(3), recording: fileSchema });
const fields = {
  version: z.literal(1), engine: z.literal('testerarmy-e2e'), attemptId: z.uuid(), runId: z.uuid(), runUrl: z.string(),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  termination: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('not-started') }),
    z.strictObject({ kind: z.literal('observed'), exitCode: z.number().int().nullable(), signal: z.string().nullable(), forced: z.boolean(), shutdownConfirmed: z.boolean() }),
  ]),
  cleanup: cleanupSchema,
  auth: z.enum(['not-loaded', 'persisted', 'write-back-failed', 'uncertain']),
  tools: z.strictObject({ node: z.literal('22.23.1'), e2e: z.literal('0.22.0'), mobile: z.literal('0.12.5'),
    easProvider: z.literal('0.3.2'), agentDevice: z.literal('0.21.35'), ai: z.literal('7.0.158'), openai: z.literal('4.0.106'), eas: z.literal('25.3.0') }),
};
const definitive = { ...fields, target: targetSchema, framework: frameworkSchema, lease: ledgerSchema,
  checks: z.array(checkSchema).min(1), evidence: evidenceSchema };
export const testerArmyResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...definitive, state: z.literal('PASS') }),
  z.strictObject({ ...definitive, state: z.literal('FAIL') }),
  z.strictObject({ ...fields, state: z.literal('INCONCLUSIVE'), reason: z.string().min(1), target: targetSchema.nullable(),
    framework: frameworkSchema.nullable(), lease: ledgerSchema.nullable(), checks: z.array(checkSchema), evidence: evidenceSchema.nullable(), diagnostic: diagnosticSchema.nullable().optional() }),
]).superRefine((value, ctx) => {
  if (value.runUrl !== `https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/${value.runId}`) {
    ctx.addIssue({ code: 'custom', message: 'Workflow URL must bind the exact run and project.' });
  }
  if (value.state === 'INCONCLUSIVE') return;
  const expected = value.state === 'FAIL' ? 1 : 0;
  if (value.target.kind !== 'acceptance') {
    ctx.addIssue({ code: 'custom', message: 'Definitive e2e verdict requires frozen original issue acceptance.' });
    return;
  }
  const issue = demoIssueByCriteria(value.target.criteria.path);
  const checkIds: readonly string[] = issue.e2e.checks;
  if (value.target.criteria.sha256 !== issue.criteriaSha256 || value.target.fixture.sha256 !== originalFixtureSha256 ||
    value.lease.state !== 'ready' || value.cleanup.state !== 'stopped' ||
    value.cleanup.sessionId !== value.lease.sessionId || value.lease.attemptId !== value.attemptId || value.lease.runId !== value.framework.runId ||
    value.auth !== 'persisted' || value.termination.kind !== 'observed' || value.termination.exitCode !== expected ||
    value.termination.forced || value.termination.signal !== null || !value.termination.shutdownConfirmed || value.framework.exitCode !== expected ||
    value.framework.status !== (expected ? 'failed' : 'passed') ||
    value.checks.length !== checkIds.length || checkIds.some((id) => !value.checks.some((check) => check.id === id)) || value.checks.some((check) => check.screenshot !== `${check.id}.png`) ||
    (value.checks.some((check) => check.state === 'FAIL') ? 'FAIL' : 'PASS') !== value.state ||
    value.evidence.recording.path !== 'session.mp4' || value.evidence.identity.path !== 'identity.json' || value.evidence.report.path !== 'framework-report.json' ||
    value.evidence.screenshots.length !== checkIds.length + 2 || new Set(value.evidence.screenshots.map((file) => file.path)).size !== checkIds.length + 2 ||
    [...checkIds, 'controller-start', 'controller-end'].some((id) => !value.evidence.screenshots.some((ref) => ref.path === `${id}.png`))) {
    ctx.addIssue({ code: 'custom', message: 'Definitive e2e verdict requires exact checks, identities, actual exit, normal shutdown, stopped lease, persisted auth, and complete evidence.' });
  }
});
export type TesterArmyResultV1 = z.infer<typeof testerArmyResultSchema>;
export const toolVersions = { node: '22.23.1', e2e: '0.22.0', mobile: '0.12.5', easProvider: '0.3.2',
  agentDevice: '0.21.35', ai: '7.0.158', openai: '4.0.106', eas: '25.3.0' } as const;

const marks = { PASS: '🟢', FAIL: '🔴', INCONCLUSIVE: '⚪' } as const;
function fallbackReport(result: TesterArmyResultV1) {
  const reason = result.state === 'INCONCLUSIVE' ? `\n\n**${plain(result.reason)}**` : '';
  return `### ${marks[result.state]} E2E iOS: ${result.state}${reason}\n\nThe evidence could not be published. [Workflow](${result.runUrl})`;
}

export function publicationStatus(result: TesterArmyResultV1, delivery: { state: string; url: string | null; report?: string | null }) {
  return { state: ['complete', 'artifact-only'].includes(delivery.state) ? result.state : 'INCONCLUSIVE',
    observed_state: result.state, attemptId: result.attemptId, publication_state: delivery.state, publication_url: delivery.url ?? '',
    comment_body: delivery.report ?? fallbackReport(result) };
}
