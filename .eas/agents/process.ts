import { execFile, spawn } from 'node:child_process';
import type { Termination } from './result';

type ProcessIdentity = { pid: number; parent: number; group: number; state: string; started: string };

function processTable(observer: Command): Promise<ProcessIdentity[] | null> {
  return new Promise((done) => {
    let settled = false;
    const finish = (rows: ProcessIdentity[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(rows);
    };
    const query = execFile(observer.file, [...observer.args, '-axo', 'pid=,ppid=,pgid=,stat=,lstart='], {
      env: { LC_ALL: 'C' }, timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4_000_000,
    }, (error, stdout) => {
      if (error) { finish(null); return; }
      const rows: ProcessIdentity[] = [];
      for (const line of stdout.trim().split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
        if (!match) { finish(null); return; }
        rows.push({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), state: match[4]!, started: match[5]! });
      }
      finish(rows);
    });
    const timer = setTimeout(() => {
      query.kill('SIGKILL');
      query.stdin?.destroy(); query.stdout?.destroy(); query.stderr?.destroy();
      finish(null);
    }, 1000);
  });
}

class CommandProcesses {
  private owned = new Map<number, ProcessIdentity>();
  private groups = new Set<number>();
  private seeded = false;
  private current = false;
  confirmed = true;

  constructor(private root: number, private exited: () => boolean, private observer: Command) {}

  get live() { return [...this.owned.values()].filter((p) => !p.state.startsWith('Z')); }

  async inspect() {
    const rootRunning = !this.exited();
    const rows = await processTable(this.observer);
    this.current = rows !== null;
    if (!rows) { this.confirmed = false; return; }
    const previous = this.owned;
    this.owned = new Map(rows.filter((p) => previous.get(p.pid)?.started === p.started).map((p) => [p.pid, p]));
    this.groups = new Set([...this.groups].filter((group) => rows.some((p) =>
      p.group === group && previous.get(p.pid)?.group === group && this.owned.has(p.pid))));
    if (!this.seeded) {
      this.seeded = true;
      const root = rows.find((p) => p.pid === this.root);
      if (root && rootRunning) this.owned.set(root.pid, root);
      else if (!root || root.state.startsWith('Z')) {
        const members = rows.filter((p) => p.group === this.root);
        for (const member of members) this.owned.set(member.pid, member);
        if (members.length) this.groups.add(this.root);
      } else this.confirmed = false;
    }
    let added = true;
    while (added) {
      added = false;
      for (const p of rows) {
        if (!this.owned.has(p.pid) && (this.owned.has(p.parent) || this.groups.has(p.group))) {
          this.owned.set(p.pid, p);
          added = true;
        }
        if (this.owned.has(p.pid) && p.pid === p.group && !this.groups.has(p.group)) {
          this.groups.add(p.group);
          added = true;
        }
      }
    }
    const controller = rows.find((p) => p.pid === process.pid);
    if (controller && this.groups.delete(controller.group)) this.confirmed = false;
    if (this.owned.delete(process.pid)) this.confirmed = false;
  }

  signal(signal: 'SIGSTOP' | 'SIGKILL') {
    if (!this.current) return;
    const targets = new Set(this.live.map((p) => this.groups.has(p.group) ? -p.group : p.pid));
    for (const pid of targets) {
      try { process.kill(pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.confirmed = false; }
    }
  }
}

export type Command = { file: string; args: string[] };
export async function command({ executable, args, cwd, env, timeoutMs, signal, input, processObserver = { file: '/bin/ps', args: [] } }: {
  executable: Command; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; input?: string; processObserver?: Command;
}): Promise<{ termination: Termination; stdout: string; stderr: string }> {
  if (signal?.aborted) return { termination: { kind: 'signal', reason: 'signal' }, stdout: '', stderr: '' };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { termination: { kind: 'timeout', reason: 'timeout' }, stdout: '', stderr: '' };
  const deadline = performance.now() + timeoutMs;
  return new Promise((done) => {
    const child = spawn(executable.file, [...executable.args, ...args], {
      cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let phase: 'running' | 'cleaning' | 'finished' = 'running';
    let termination: Termination | null = null;
    let exited = false;
    let closed = false;
    let forced = false;
    let stdout = '';
    let stderr = '';
    let tracking: ReturnType<typeof setTimeout> | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let inspection: Promise<void> | undefined;
    const processes = child.pid ? new CommandProcesses(child.pid, () => exited, processObserver) : null;
    const finish = (confirmed: boolean) => {
      if (phase === 'finished') return;
      phase = 'finished';
      clearTimeout(timer); clearTimeout(tracking); clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort', abort);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      let result = termination ?? { kind: 'signal' as const, reason: 'Command cleanup was not confirmed.' };
      if (result.kind === 'exited' && (forced || !confirmed)) {
        result = { kind: 'signal', reason: confirmed ? 'Command required descendant termination.' : 'Command cleanup was not confirmed.' };
      } else if (!confirmed && result.kind !== 'exited') result = { ...result, reason: `${result.reason}; command cleanup was not confirmed.` };
      done({ termination: result, stdout, stderr });
    };
    const inspect = () => {
      inspection ??= (processes?.inspect() ?? Promise.resolve()).finally(() => { inspection = undefined; });
      return inspection;
    };
    const clean = () => exited && closed && (!processes || (processes.confirmed && processes.live.length === 0));
    const cleanup = async (cleanupDeadline: number) => {
      const grace = performance.now() + (termination?.kind === 'exited' ? 75 : 0);
      await inspection;
      while (phase === 'cleaning') {
        await inspect();
        if (phase !== 'cleaning') return;
        if (clean()) { finish(true); return; }
        if (performance.now() >= grace) {
          if (processes?.live.length) {
            forced = true;
            processes.signal(processes.live.every((p) => p.state.startsWith('T')) || performance.now() + 100 >= cleanupDeadline ? 'SIGKILL' : 'SIGSTOP');
          } else if (!exited) {
            forced = true;
            child.kill('SIGKILL');
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const stop = (reason: Termination) => {
      if (phase === 'finished') return;
      if (termination === null || (termination.kind === 'exited' && reason.kind !== 'exited')) termination = reason;
      if (phase === 'cleaning') return;
      phase = 'cleaning';
      clearTimeout(tracking);
      const cleanupDeadline = performance.now() + 1500;
      cleanupTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
        finish(false);
      }, 1500);
      void cleanup(cleanupDeadline);
    };
    const abort = () => stop({ kind: 'signal', reason: 'signal' });
    const timer = setTimeout(() => stop({ kind: 'timeout', reason: 'timeout' }), Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', abort, { once: true });
    const track = async () => {
      await inspect();
      if (phase === 'running') tracking = setTimeout(() => { void track(); }, 20);
    };
    const collect = (chunk: string, stream: 'stdout' | 'stderr') => {
      const remaining = 8_000_000 - stdout.length - stderr.length;
      if (stream === 'stdout') stdout += chunk.slice(0, remaining); else stderr += chunk.slice(0, remaining);
      if (chunk.length > remaining) stop({ kind: 'signal', reason: 'Command output exceeded its limit.' });
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, 'stdout'));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, 'stderr'));
    child.stdin.on('error', () => {});
    child.on('error', () => { exited = true; stop({ kind: 'not-started', reason: 'Executable unavailable.' }); });
    child.on('exit', (code, exitSignal) => {
      exited = true;
      stop(exitSignal ? { kind: 'signal', reason: exitSignal } : { kind: 'exited', code: code ?? 1 });
    });
    child.on('close', () => { closed = true; });
    child.stdin.end(input);
    if (signal?.aborted) abort();
    if (phase === 'running') void track();
  });
}

export function succeeded(result: { termination: Termination }): boolean {
  return result.termination.kind === 'exited' && result.termination.code === 0;
}

export function safeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'SYSTEMROOT'].flatMap((key) => {
    const value = source[key];
    return value === undefined ? [] : [[key, value]];
  }));
}
