import { spawn } from 'node:child_process';
import type { Termination } from './result';

export type Command = { file: string; args: string[] };
export async function command({ executable, args, cwd, env, timeoutMs, signal, input }: {
  executable: Command; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; input?: string;
}): Promise<{ termination: Termination; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(executable.file, [...executable.args, ...args], {
      cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let termination: Termination | null = null;
    let stdout = '';
    let stderr = '';
    const kill = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    };
    const stop = (kind: 'timeout' | 'signal') => { termination = { kind, reason: kind }; kill(); };
    const abort = () => stop('signal');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 8_000_000) stop('signal');
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', () => { termination = { kind: 'not-started', reason: 'Executable unavailable.' }; });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      kill();
      done({ termination: termination ?? { kind: 'exited', code: code ?? 1 }, stdout, stderr });
    });
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
