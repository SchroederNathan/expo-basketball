import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { DeviceProvider } from '@e2e-dev/mobile';
import { z } from 'zod';
import { command, succeeded, type Command } from '../process';

export const projectId = '44a06072-fb9b-4334-ba72-29e7c2d61bc6';
const intentFields = {
  version: z.literal(1), attemptId: z.uuid(), tag: z.string(), runId: z.string().min(1),
  targetName: z.literal('ios'), slot: z.literal(0), requestedAt: z.iso.datetime(), maxDurationMinutes: z.literal(30),
};
export const ledgerSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...intentFields, state: z.literal('intent') }),
  z.strictObject({ ...intentFields, state: z.literal('ready'), sessionId: z.uuid(), readyAt: z.iso.datetime() }),
]).refine((value) => value.tag === `lob-testerarmy-${value.attemptId}`, 'Attempt tag mismatch.');
export type Ledger = z.infer<typeof ledgerSchema>;
export const cleanupSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not-needed') }),
  z.strictObject({ state: z.literal('stopped'), sessionId: z.uuid(), observedAt: z.iso.datetime() }),
  z.strictObject({ state: z.literal('unconfirmed'), sessionId: z.uuid().nullable() }),
]);
export type Cleanup = z.infer<typeof cleanupSchema>;
export type SessionControl = {
  list: (tag: string, signal: AbortSignal) => Promise<{ id: string; name: string; tags: string[] }[]>;
  stop: (id: string, signal: AbortSignal) => Promise<void>;
  get: (id: string, signal: AbortSignal) => Promise<{ id: string; status: string }>;
};

export function sessionControl({ eas, cwd, env }: { eas: Command; cwd: string; env: NodeJS.ProcessEnv }): SessionControl {
  const invoke = async (args: string[], signal: AbortSignal): Promise<unknown> => {
    const result = await command({ executable: eas, args, cwd, env, timeoutMs: 60_000, signal });
    if (!succeeded(result)) throw new Error('Scoped EAS lifecycle operation failed.');
    return JSON.parse(result.stdout);
  };
  return {
    list: async (tag, signal) => z.object({ sessions: z.array(z.object({ id: z.uuid(), name: z.string(), tags: z.array(z.string()) })).max(99) })
      .parse(await invoke(['simulator:list', '--tag', tag, '--limit', '100', '--json', '--non-interactive'], signal)).sessions,
    stop: async (id, signal) => {
      const receipt = z.object({ id: z.uuid(), status: z.literal('STOPPED') }).parse(await invoke(['simulator:stop', '--id', id, '--json', '--non-interactive'], signal));
      if (receipt.id !== id) throw new Error('Stop returned another session.');
    },
    get: async (id, signal) => z.object({ id: z.uuid(), status: z.string() }).parse(await invoke(['simulator:get', '--id', id, '--json', '--non-interactive'], signal)),
  };
}

export async function readLedger(file: string): Promise<Ledger | null> {
  let intent: Ledger;
  try { intent = ledgerSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  try {
    const ready = ledgerSchema.parse(JSON.parse(await readFile(file + '.ready', 'utf8')));
    if (ready.state !== 'ready' || ready.attemptId !== intent.attemptId || ready.runId !== intent.runId || ready.requestedAt !== intent.requestedAt) throw new Error('Lease binding differs from its intent.');
    return ready;
  } catch { return intent; }
}

export async function reconcileOwned(ledger: Ledger | null, control: SessionControl, timeoutMs = 120_000): Promise<Cleanup> {
  if (!ledger) return { state: 'not-needed' };
  let id: string | null = ledger.state === 'ready' ? ledger.sessionId : null;
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let bound = false;
  let stopRequested = false;
  try {
    while (!signal.aborted) {
      if (!bound) {
        let sessions: Awaited<ReturnType<SessionControl['list']>> | null = null;
        try { sessions = await control.list(ledger.tag, signal); } catch {}
        if (sessions?.length) {
          const owned = sessions[0];
          if (sessions.length !== 1 || !owned || !z.uuid().safeParse(owned.id).success ||
            !owned.tags.includes(ledger.tag) || !owned.tags.includes(`e2e-run:${ledger.runId}`) ||
            !owned.tags.includes(`e2e-target:${ledger.targetName}`) || owned.name !== `e2e ${ledger.targetName} ${ledger.slot + 1} of 1` ||
            id && owned.id !== id) return { state: 'unconfirmed', sessionId: id };
          id = owned.id;
          bound = true;
        }
      }
      if (bound && id) {
        if (!stopRequested) {
          try { await control.stop(id, signal); stopRequested = true; } catch {}
        }
        if (stopRequested) {
          let observed: Awaited<ReturnType<SessionControl['get']>> | null = null;
          try { observed = await control.get(id, signal); } catch {}
          if (observed && observed.id !== id) return { state: 'unconfirmed', sessionId: id };
          if (observed?.status === 'STOPPED' && !signal.aborted) return { state: 'stopped', sessionId: id, observedAt: new Date().toISOString() };
        }
      }
      await delay(Math.max(1, Math.min(250, deadline - Date.now())), undefined, { signal });
    }
  } catch {}
  return { state: 'unconfirmed', sessionId: id };
}

export function ownedProvider(provider: DeviceProvider, options: {
  attemptId: string; ledgerFile: string; preparationMs?: number;
}): DeviceProvider {
  let acquired = false;
  return {
    name: provider.name,
    async acquire(request) {
      if (acquired || request.platform !== 'ios' || request.targetName !== 'ios' || request.slot !== 0 || request.slots !== 1 || request.agentDeviceVersion !== '0.21.35') {
        throw new Error('Only one pinned iOS worker and one lease are admitted.');
      }
      request.signal.throwIfAborted();
      acquired = true;
      const intent = ledgerSchema.parse({ version: 1, state: 'intent', attemptId: options.attemptId,
        tag: `lob-testerarmy-${options.attemptId}`, runId: request.runId, targetName: 'ios', slot: 0,
        requestedAt: new Date().toISOString(), maxDurationMinutes: 30 });
      await writeFile(options.ledgerFile, JSON.stringify(intent), { flag: 'wx', mode: 0o600, flush: true });
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(options.preparationMs ?? 240_000)]);
      const lease = await provider.acquire({ ...request, signal });
      const id = z.uuid().parse(lease.id);
      await writeFile(options.ledgerFile + '.ready', JSON.stringify(ledgerSchema.parse({ ...intent, state: 'ready', sessionId: id, readyAt: new Date().toISOString() })), { flag: 'wx', mode: 0o600, flush: true });
      signal.throwIfAborted();
      return lease;
    },
    async release(lease, context) { await provider.release(lease, context); },
  };
}
