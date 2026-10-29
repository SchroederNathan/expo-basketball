import { z } from 'zod';
import { concurrentReceipts } from './codex-server';
import { laneIds, laneVerdictSchema } from './qa-lanes';
import { cleanupSchema, fileSchema, sessionSchema, targetSchema, terminationSchema } from './result';

const identifier = z.string().regex(/^[\w-]{1,200}$/);
const turnSchema = z.strictObject({ threadId: identifier, turnId: identifier.nullable(), requestedAt: z.number().finite(),
  startedAt: z.number().finite().nullable(), completedAt: z.number().finite().nullable(),
  status: z.enum(['pending', 'completed', 'failed', 'interrupted', 'timeout', 'cancelled', 'server-error']) });
const stopSchema = z.strictObject({ state: z.enum(['stopped', 'unconfirmed']), forced: z.boolean(), healthy: z.boolean(),
  exit: z.union([z.strictObject({ code: z.number().int(), signal: z.null() }),
    z.strictObject({ code: z.null(), signal: z.string() })]).nullable() });
const diagnosticSchema = z.strictObject({ nodeVersion: z.string().nullable(), packageChecks: z.enum(['validated', 'injected', 'unverified']),
  storageCleanup: z.enum(['removed', 'failed', 'not-owned']), command: z.strictObject({
    stage: z.string(), tool: z.string(), termination: z.enum(['exited', 'timeout', 'signal', 'not-started']), versionOutputMatches: z.boolean().nullable(),
    stdoutPresent: z.boolean(), trigger: z.string(), exitCode: z.number().nullable(), signal: z.string().nullable(), spawnError: z.string().nullable(), elapsedMs: z.number(),
    cleanup: z.strictObject({ confirmed: z.boolean(), forced: z.boolean(), issue: z.string().nullable(), rootExited: z.boolean(), streamsClosed: z.boolean(), liveProcesses: z.number() }),
    stderr: z.strictObject({ present: z.boolean(), truncated: z.boolean(), code: z.string().nullable(), type: z.string().nullable(), dependency: z.string().nullable(),
      target: z.string().nullable(), cause: z.string(), origin: z.string() }),
  }).nullable(),
});
const laneSchema = z.strictObject({ id: z.enum(laneIds), state: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  attemptId: z.uuid().nullable(), session: sessionSchema.nullable(), threadId: identifier.nullable(), turn: turnSchema.nullable(),
  verdict: laneVerdictSchema.nullable(), identity: fileSchema.nullable(), screenshots: z.array(fileSchema).max(3),
  recording: fileSchema.nullable(), recordingSessionId: z.uuid().nullable(), cleanup: cleanupSchema,
  deviceFailure: z.strictObject({ operation: z.string(), termination: terminationSchema,
    error: z.strictObject({ code: z.string(), message: z.string() }).nullable(), stdout: z.string(), stderr: z.string() }).nullable(),
  reason: z.string().nullable(),
}).superRefine((lane, ctx) => {
  if (lane.state === 'INCONCLUSIVE') return;
  const names = lane.screenshots.map((file) => file.path).sort().join(',');
  if (!lane.session || lane.session.attemptId !== lane.attemptId || !lane.threadId || !lane.turn ||
    lane.turn.threadId !== lane.threadId || !lane.turn.turnId || lane.turn.status !== 'completed' ||
    !lane.verdict || lane.verdict.id !== lane.id || lane.verdict.state !== lane.state || !lane.identity || !lane.recording ||
    lane.recordingSessionId !== lane.session.id || lane.cleanup.state !== 'stopped' || lane.cleanup.sessionId !== lane.session.id ||
    names !== ['controller-start.png', 'controller-end.png', `${lane.id}.png`].sort().join(',') || lane.reason || lane.deviceFailure) {
    ctx.addIssue({ code: 'custom', message: 'Definitive QA lane requires its exact verdict, evidence, turn, session, and cleanup.' });
  }
});
export const qaResultSchema = z.strictObject({ version: z.literal(1), kind: z.literal('qa'), attemptId: z.uuid(),
  state: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), startedAt: z.number().finite(), finishedAt: z.number().finite(),
  runId: z.string().min(1), runUrl: z.url().regex(/^https:\/\/expo\.dev\/[^?#]+$/).nullable(), target: targetSchema.nullable(),
  model: z.strictObject({ model: z.literal('gpt-6.1-sol'), effort: z.literal('xhigh'), serviceTier: z.literal('priority') }),
  tools: z.strictObject({ bun: z.literal('1.2.22'), eas: z.literal('25.3.0'), codex: z.literal('0.165.0'), agentDevice: z.literal('0.21.33') }),
  preparation: z.strictObject({ stage: z.string(), tool: z.string(), reason: z.string() }).nullable(),
  preparationDiagnostics: diagnosticSchema.nullable(), auth: z.enum(['not-loaded', 'persisted', 'write-back-failed']),
  server: z.strictObject({ processId: z.number().int().positive().nullable(), stop: stopSchema.nullable() }),
  concurrent: z.boolean(), lanes: z.array(laneSchema).length(3), reason: z.string().nullable(),
}).superRefine((result, ctx) => {
  if (new Set(result.lanes.map((lane) => lane.id)).size !== 3 || result.finishedAt < result.startedAt) {
    ctx.addIssue({ code: 'custom', message: 'QA requires each lane exactly once and a valid observation window.' });
  }
  if (result.state === 'INCONCLUSIVE') return;
  const stop = result.server.stop;
  const expected = result.lanes.some((lane) => lane.state === 'FAIL') ? 'FAIL' : 'PASS';
  if (!result.target || result.target.kind !== 'check' || result.auth !== 'persisted' || result.reason || result.preparation ||
    !stop || stop.state !== 'stopped' || !stop.healthy || stop.forced || stop.exit?.code !== 0 || stop.exit.signal !== null ||
    !result.server.processId || !result.concurrent || !concurrentReceipts(result.lanes.flatMap((lane) => lane.turn ? [lane.turn] : [])) ||
    result.lanes.some((lane) => lane.state === 'INCONCLUSIVE' || !lane.turn || lane.turn.startedAt === null || lane.turn.completedAt === null ||
      lane.turn.requestedAt < result.startedAt || lane.turn.requestedAt > lane.turn.startedAt || lane.turn.startedAt > lane.turn.completedAt || lane.turn.completedAt > result.finishedAt) || result.state !== expected ||
    ['attemptId', 'threadId'].some((key) => new Set(result.lanes.map((lane) => key === 'attemptId' ? lane.attemptId : lane.threadId)).size !== 3) ||
    new Set(result.lanes.map((lane) => lane.session?.id)).size !== 3 || new Set(result.lanes.map((lane) => lane.turn?.turnId)).size !== 3) {
    ctx.addIssue({ code: 'custom', message: 'QA aggregate requires complete distinct concurrent lanes, healthy shutdown, and persisted auth.' });
  }
});
export type QaResult = z.infer<typeof qaResultSchema>;
