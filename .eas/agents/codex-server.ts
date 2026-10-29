import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Command } from './process';

export const codexCommand: Command = { file: 'bunx', args: ['@openai/codex@0.165.0'] };
export const codexModel = { model: 'gpt-6.1-sol', effort: 'xhigh', serviceTier: 'priority' } as const;
const id = z.string().min(1).max(200).regex(/^[\w-]+$/);
const turnSchema = z.object({ id, status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']) });
const messageSchema = z.object({ id, type: z.literal('agentMessage'), text: z.string().max(100_000),
  phase: z.enum(['commentary', 'partial_answer', 'final_answer']).nullish() });
const envelopeSchema = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(),
  params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional() });

export type TurnReceipt = {
  threadId: string; turnId: string | null; requestedAt: number; startedAt: number | null;
  completedAt: number | null; status: 'pending' | 'completed' | 'failed' | 'interrupted' | 'timeout' | 'cancelled' | 'server-error';
};
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type ActiveTurn = {
  receipt: TurnReceipt; acknowledged: boolean; terminal: boolean; messages: Map<string, z.infer<typeof messageSchema>>;
  resolve: (value: { text: string; receipt: TurnReceipt }) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>; detach: () => void;
};

export function threadParameters(cwd: string, environment: Record<string, string>) {
  return {
    cwd, ephemeral: true, model: codexModel.model, modelProvider: 'openai', serviceTier: codexModel.serviceTier,
    approvalPolicy: 'never', sandbox: 'danger-full-access',
    config: {
      shell_environment_policy: { inherit: 'none', set: environment },
      model_reasoning_effort: codexModel.effort, project_doc_max_bytes: 0,
      'features.multi_agent': false, 'features.shell_snapshot': false, web_search: 'disabled',
    },
    developerInstructions: 'Use only this task and its owned working directory and device. Do not spawn agents, inspect credentials, enumerate environment variables, read sibling directories, or control other sessions. Never print secrets.',
  };
}

export function turnParameters(threadId: string, prompt: string, outputSchema: unknown) {
  return { threadId, input: [{ type: 'text', text: prompt }], outputSchema, effort: codexModel.effort };
}

export class CodexServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly requests = new Map<number, PendingRequest>();
  private readonly threads = new Set<string>();
  private readonly active = new Map<string, ActiveTurn>();
  private readonly history: TurnReceipt[] = [];
  private sequence = 0;
  private failure: Error | null = null;
  private closing = false;
  private closed = false;
  private forced = false;
  private closePromise: Promise<{ state: 'stopped' | 'unconfirmed'; forced: boolean; healthy: boolean }> | null = null;
  private readonly exited: Promise<void>;

  constructor(private readonly options: { executable?: Command; cwd: string; env: NodeJS.ProcessEnv;
    requestMs?: number; stopMs?: number }) {
    const executable = options.executable ?? codexCommand;
    this.child = spawn(executable.file, [...executable.args, 'app-server', '--listen', 'stdio://',
      '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"',
      '-c', 'model_provider="openai"', '-c', 'features.multi_agent=false', '-c', 'features.shell_snapshot=false'], {
      cwd: options.cwd, env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    let lineBytes = 0;
    this.child.stdout.on('data', (chunk: string) => {
      for (const part of chunk.split(/(?<=\n)/)) {
        lineBytes += Buffer.byteLength(part);
        if (lineBytes > 4_000_000) this.fail(new Error('Codex protocol frame exceeded its limit.'));
        if (part.endsWith('\n')) lineBytes = 0;
      }
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try { this.receive(envelopeSchema.parse(JSON.parse(line))); }
      catch { this.fail(new Error('Invalid Codex protocol message.')); }
    });
    // Raw events, tool output, stderr, and RPC errors can contain credentials.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.fail(new Error('Codex input closed.')));
    this.child.on('error', () => this.fail(new Error('Codex server could not start.')));
    this.exited = new Promise((done) => this.child.once('close', () => {
      this.closed = true;
      if (!this.closing) this.fail(new Error('Codex server exited unexpectedly.'));
      this.rejectAll(new Error('Codex server stopped.'));
      lines.close();
      done();
    }));
  }

  get pid() { return this.child.pid ?? null; }
  receipts(): TurnReceipt[] { return this.history.map((receipt) => ({ ...receipt })); }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'lob_qa', version: '1.0.0' } });
    this.send({ method: 'initialized', params: {} });
  }

  async startThread(cwd: string, environment: Record<string, string>) {
    const result = z.object({ thread: z.object({ id }), cwd: z.string(), model: z.literal(codexModel.model),
      modelProvider: z.literal('openai'), serviceTier: z.literal(codexModel.serviceTier),
      approvalPolicy: z.literal('never'), sandbox: z.object({ type: z.literal('dangerFullAccess') })
    }).parse(await this.request('thread/start', threadParameters(cwd, environment)));
    if (result.cwd !== cwd || this.threads.has(result.thread.id)) throw new Error('Codex thread identity or working directory mismatch.');
    this.threads.add(result.thread.id);
    return result.thread.id;
  }

  runTurn({ threadId, prompt, outputSchema, timeoutMs, signal }: {
    threadId: string; prompt: string; outputSchema: unknown; timeoutMs: number; signal: AbortSignal;
  }): Promise<{ text: string; receipt: TurnReceipt }> {
    if (this.failure || this.closing) return Promise.reject(new Error('Codex server is unavailable.'));
    if (!this.threads.has(threadId) || this.history.some((r) => r.threadId === threadId)) {
      return Promise.reject(new Error('Each owned thread accepts exactly one turn.'));
    }
    if (signal.aborted) return Promise.reject(new Error('Codex turn cancelled before start.'));
    const receipt: TurnReceipt = { threadId, turnId: null, requestedAt: Date.now(), startedAt: null, completedAt: null, status: 'pending' };
    this.history.push(receipt);
    return new Promise((resolve, reject) => {
      const abort = () => { void this.cancel(threadId, 'cancelled'); };
      const turn: ActiveTurn = { receipt, acknowledged: false, terminal: false, messages: new Map(), resolve, reject,
        timer: setTimeout(() => { void this.cancel(threadId, 'timeout'); }, timeoutMs),
        detach: () => signal.removeEventListener('abort', abort) };
      this.active.set(threadId, turn);
      signal.addEventListener('abort', abort, { once: true });
      void this.request('turn/start', turnParameters(threadId, prompt, outputSchema)).then((value) => {
        if (!this.active.has(threadId)) return;
        const result = z.object({ turn: turnSchema }).parse(value);
        this.bindTurn(turn, result.turn.id);
        turn.acknowledged = true;
        if (result.turn.status !== 'inProgress' && result.turn.status !== 'completed') throw new Error('Codex refused the turn.');
        this.finish(turn);
      }).catch(() => this.rejectTurn(threadId, new Error('Codex turn start failed.')));
    });
  }

  private bindTurn(turn: ActiveTurn, turnId: string) {
    if (turn.receipt.turnId && turn.receipt.turnId !== turnId) throw new Error('Codex turn identity mismatch.');
    turn.receipt.turnId = turnId;
  }

  private receive(message: z.infer<typeof envelopeSchema>) {
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: 'Interactive requests are unsupported by this controller.' } });
      this.fail(new Error('Codex requested unsupported interactive input.'));
      return;
    }
    if (message.id !== undefined) {
      const request = typeof message.id === 'number' ? this.requests.get(message.id) : undefined;
      if (!request) return;
      this.requests.delete(Number(message.id));
      clearTimeout(request.timer);
      if (message.error !== undefined || !Object.hasOwn(message, 'result')) request.reject(new Error('Codex RPC failed.'));
      else request.resolve(message.result);
      return;
    }
    if (!['turn/started', 'turn/completed', 'item/completed'].includes(message.method ?? '')) return;
    const params = z.object({ threadId: id }).passthrough().parse(message.params);
    const active = this.active.get(params.threadId);
    if (!active) return;
    if (message.method === 'item/completed') {
      const event = z.object({ threadId: id, turnId: id, item: z.object({ type: z.string() }).passthrough() }).parse(params);
      this.bindTurn(active, event.turnId);
      if (event.item.type === 'agentMessage') {
        const item = messageSchema.parse(event.item);
        if (item.phase === 'final_answer' || item.phase == null) active.messages.set(item.id, item);
      }
    } else {
      const event = z.object({ threadId: id, turn: turnSchema }).parse(params);
      this.bindTurn(active, event.turn.id);
      if (message.method === 'turn/started') {
        if (active.receipt.startedAt !== null || event.turn.status !== 'inProgress') throw new Error('Invalid turn start.');
        active.receipt.startedAt = Date.now();
      } else {
        active.receipt.completedAt = Date.now();
        active.terminal = true;
        if (active.receipt.status === 'pending') {
          active.receipt.status = event.turn.status === 'inProgress' ? 'failed' : event.turn.status;
        }
        this.finish(active);
      }
    }
  }

  private finish(turn: ActiveTurn) {
    if (!turn.acknowledged || !turn.terminal) return;
    const messages = [...turn.messages.values()];
    const finals = messages.filter((message) => message.phase === 'final_answer');
    const answer = finals.length ? finals : messages;
    if (turn.receipt.status !== 'completed' || turn.receipt.startedAt === null || answer.length !== 1) {
      this.rejectTurn(turn.receipt.threadId, new Error('Codex turn did not complete with one final answer.'));
      return;
    }
    this.removeTurn(turn);
    turn.resolve({ text: answer[0]!.text, receipt: { ...turn.receipt } });
  }

  private removeTurn(turn: ActiveTurn) {
    clearTimeout(turn.timer);
    turn.detach();
    this.active.delete(turn.receipt.threadId);
  }

  private rejectTurn(threadId: string, error: Error) {
    const turn = this.active.get(threadId);
    if (!turn) return;
    if (turn.receipt.status === 'pending' || turn.receipt.status === 'completed') turn.receipt.status = 'failed';
    this.removeTurn(turn);
    turn.reject(error);
  }

  private async cancel(threadId: string, status: 'timeout' | 'cancelled') {
    const turn = this.active.get(threadId);
    if (!turn || turn.receipt.status === 'timeout' || turn.receipt.status === 'cancelled') return;
    turn.receipt.status = status;
    if (!turn.receipt.turnId) {
      this.fail(new Error('Codex turn could not be cancelled before its identity arrived.'));
      return;
    }
    try {
      await this.request('turn/interrupt', { threadId, turnId: turn.receipt.turnId }, this.options.stopMs ?? 5_000);
      this.rejectTurn(threadId, new Error(`Codex turn ${status}.`));
    } catch { this.fail(new Error('Codex turn cancellation was not acknowledged.')); }
  }

  private request(method: string, params: unknown, timeoutMs = this.options.requestMs ?? 60_000): Promise<unknown> {
    if (this.failure || this.closed) return Promise.reject(new Error('Codex server is unavailable.'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error('Codex request timed out.'));
      }, timeoutMs);
      this.requests.set(requestId, { resolve, reject, timer });
      this.send({ id: requestId, method, params });
    });
  }

  private send(message: unknown) {
    if (!this.closed && !this.failure) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAll(error: Error) {
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
    this.requests.clear();
    for (const turn of this.active.values()) {
      if (turn.receipt.status === 'pending') turn.receipt.status = 'server-error';
      this.removeTurn(turn);
      turn.reject(error);
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    this.rejectAll(error);
    this.kill('SIGKILL');
  }

  private kill(signal: NodeJS.Signals) {
    if (this.child.pid) { try { process.kill(-this.child.pid, signal); } catch {} }
  }

  close() {
    this.closePromise ??= this.stop();
    return this.closePromise;
  }

  private async stop(): Promise<{ state: 'stopped' | 'unconfirmed'; forced: boolean; healthy: boolean }> {
    this.closing = true;
    await Promise.allSettled([...this.active.keys()].map((thread) => this.cancel(thread, 'cancelled')));
    this.child.stdin.end();
    const timer = setTimeout(() => { this.forced = true; this.kill('SIGKILL'); }, this.options.stopMs ?? 5_000);
    await this.exited;
    clearTimeout(timer);
    this.kill('SIGKILL');
    const deadline = Date.now() + (this.options.stopMs ?? 5_000);
    while (this.child.pid) {
      try { process.kill(-this.child.pid, 0); }
      catch { return { state: 'stopped', forced: this.forced, healthy: this.failure === null }; }
      if (Date.now() >= deadline) return { state: 'unconfirmed', forced: this.forced, healthy: false };
      await new Promise((done) => setTimeout(done, 20));
    }
    return { state: 'stopped', forced: this.forced, healthy: this.failure === null };
  }
}

export function concurrentReceipts(receipts: readonly TurnReceipt[], count = 3) {
  if (receipts.length !== count || new Set(receipts.map((r) => r.threadId)).size !== count ||
    new Set(receipts.map((r) => r.turnId)).size !== count ||
    receipts.some((r) => r.status !== 'completed' || !r.turnId || r.startedAt === null || r.completedAt === null)) return false;
  return Math.max(...receipts.map((r) => r.startedAt!)) < Math.min(...receipts.map((r) => r.completedAt!));
}
