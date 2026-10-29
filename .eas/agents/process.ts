import { execFile, spawn } from 'node:child_process';
import type { Termination } from './result';

type ProcessIdentity = { pid: number; parent: number; group: number; state: string; started: string };
type InspectionIssue = 'observer-unavailable' | 'observer-timeout' | 'observer-failed' | 'observer-invalid-output' |
  'root-identity-unconfirmed' | 'controller-overlap' | 'signal-failed';
export type CommandObservation = {
  trigger: 'exit' | 'spawn-error' | 'cancelled' | 'timeout' | 'output-limit';
  exitCode: number | null; signal: NodeJS.Signals | null;
  spawnError: 'ENOENT' | 'EACCES' | 'ENOEXEC' | 'ENOMEM' | 'EAGAIN' | 'other' | null;
  elapsedMs: number;
  cleanup: { confirmed: boolean; forced: boolean; issue: InspectionIssue | null;
    rootExited: boolean; streamsClosed: boolean; liveProcesses: number };
};

function processTable(observer: Command): Promise<{ rows: ProcessIdentity[]; issue: null } | { rows: null; issue: InspectionIssue }> {
  return new Promise((done) => {
    let settled = false;
    const finish = (result: Awaited<ReturnType<typeof processTable>>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const query = execFile(observer.file, [...observer.args, '-axo', 'pid=,ppid=,pgid=,stat=,lstart='], {
      env: { LC_ALL: 'C' }, timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4_000_000,
    }, (error, stdout) => {
      if (error) {
        finish({ rows: null, issue: error.killed ? 'observer-timeout' : error.code === 'ENOENT' ? 'observer-unavailable' : 'observer-failed' });
        return;
      }
      const rows: ProcessIdentity[] = [];
      for (const line of stdout.trim().split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
        if (!match) { finish({ rows: null, issue: 'observer-invalid-output' }); return; }
        rows.push({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), state: match[4]!, started: match[5]! });
      }
      finish({ rows, issue: null });
    });
    const timer = setTimeout(() => {
      query.kill('SIGKILL');
      query.stdin?.destroy(); query.stdout?.destroy(); query.stderr?.destroy();
      finish({ rows: null, issue: 'observer-timeout' });
    }, 1000);
  });
}

class CommandProcesses {
  private owned = new Map<number, ProcessIdentity>();
  private groups = new Set<number>();
  private seeded = false;
  private current = false;
  confirmed = true;
  issue: InspectionIssue | null = null;

  constructor(private root: number, private exited: () => boolean, private observer: Command) {}

  get live() { return [...this.owned.values()].filter((p) => !p.state.startsWith('Z')); }
  private unconfirmed(issue: InspectionIssue) { this.confirmed = false; this.issue ??= issue; }

  async inspect() {
    const rootRunning = !this.exited();
    const { rows, issue } = await processTable(this.observer);
    this.current = rows !== null;
    if (!rows) { this.unconfirmed(issue); return; }
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
      } else this.unconfirmed('root-identity-unconfirmed');
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
    if (controller && this.groups.delete(controller.group)) this.unconfirmed('controller-overlap');
    if (this.owned.delete(process.pid)) this.unconfirmed('controller-overlap');
  }

  signal(signal: 'SIGSTOP' | 'SIGKILL') {
    if (!this.current) return;
    const targets = new Set(this.live.map((p) => this.groups.has(p.group) ? -p.group : p.pid));
    for (const pid of targets) {
      try { process.kill(pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.unconfirmed('signal-failed'); }
    }
  }
}

export type Command = { file: string; args: string[] };
export async function command({ executable, args, cwd, env, timeoutMs, signal, input, processObserver = { file: '/bin/ps', args: [] } }: {
  executable: Command; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; input?: string; processObserver?: Command;
}): Promise<{ termination: Termination; stdout: string; stderr: string; observation: CommandObservation }> {
  const started = performance.now();
  const observation: CommandObservation = { trigger: 'exit', exitCode: null, signal: null, spawnError: null, elapsedMs: 0,
    cleanup: { confirmed: true, forced: false, issue: null, rootExited: false, streamsClosed: true, liveProcesses: 0 } };
  if (signal?.aborted) return { termination: { kind: 'signal', reason: 'signal' }, stdout: '', stderr: '', observation: { ...observation, trigger: 'cancelled' } };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { termination: { kind: 'timeout', reason: 'timeout' }, stdout: '', stderr: '', observation: { ...observation, trigger: 'timeout' } };
  const deadline = started + timeoutMs;
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
      done({ termination: result, stdout, stderr, observation: { ...observation, elapsedMs: Math.round(performance.now() - started),
        cleanup: { confirmed, forced, issue: processes?.issue ?? null, rootExited: exited, streamsClosed: closed,
          liveProcesses: processes?.live.length ?? 0 } } });
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
    const stop = (reason: Termination, trigger: CommandObservation['trigger']) => {
      if (phase === 'finished') return;
      if (termination === null || (termination.kind === 'exited' && reason.kind !== 'exited')) { termination = reason; observation.trigger = trigger; }
      if (phase === 'cleaning') return;
      phase = 'cleaning';
      clearTimeout(tracking);
      const cleanupDeadline = performance.now() + 1500;
      cleanupTimer = setTimeout(() => {
        if (!exited) { forced = true; child.kill('SIGKILL'); }
        finish(false);
      }, 1500);
      void cleanup(cleanupDeadline);
    };
    const abort = () => stop({ kind: 'signal', reason: 'signal' }, 'cancelled');
    const timer = setTimeout(() => stop({ kind: 'timeout', reason: 'timeout' }, 'timeout'), Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', abort, { once: true });
    const track = async () => {
      await inspect();
      if (phase === 'running') tracking = setTimeout(() => { void track(); }, 20);
    };
    const collect = (chunk: string, stream: 'stdout' | 'stderr') => {
      const remaining = 8_000_000 - stdout.length - stderr.length;
      if (stream === 'stdout') stdout += chunk.slice(0, remaining); else stderr += chunk.slice(0, remaining);
      if (chunk.length > remaining) stop({ kind: 'signal', reason: 'Command output exceeded its limit.' }, 'output-limit');
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, 'stdout'));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, 'stderr'));
    child.stdin.on('error', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      const codes = ['ENOENT', 'EACCES', 'ENOEXEC', 'ENOMEM', 'EAGAIN'] as const;
      observation.spawnError = codes.find((code) => code === error.code) ?? 'other';
      exited = true; stop({ kind: 'not-started', reason: 'Executable unavailable.' }, 'spawn-error');
    });
    child.on('exit', (code, exitSignal) => {
      exited = true;
      observation.exitCode = code;
      observation.signal = exitSignal;
      stop(exitSignal ? { kind: 'signal', reason: exitSignal } : { kind: 'exited', code: code ?? 1 }, 'exit');
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
