import { setTimeout as delay } from 'node:timers/promises';
import type { Termination } from './result';

// Names why `codex exec` failed without publishing its output. Only a fixed
// category, the exit code, and an HTTP status number leave the controller.
const categories: readonly (readonly [string, RegExp])[] = [
  ['usage limit', /usage limit|insufficient_quota|quota exceeded|exceeded your (current )?quota|plan limit/i],
  ['rate limit', /rate[ _-]?limit|too many requests|\b429\b/i],
  ['authentication', /unauthori[sz]ed|\b401\b|\b403\b|forbidden|not logged in|login required|refresh token|token (has )?expired/i],
  // A model at capacity clears within minutes, so it counts as an overload, not a missing model.
  ['provider overloaded', /at capacity|try a different model/i],
  ['model unavailable', /model\b.{0,80}\b(not found|not supported|unsupported|does not exist|unknown|unavailable)|unsupported model|invalid model/i],
  ['provider overloaded', /overloaded|server[_ ]error|service unavailable|bad gateway|\b5\d\d\b/i],
  ['network', /econnrefused|econnreset|enotfound|etimedout|stream disconnected|connection (reset|refused|closed)|network error/i],
];

type CodexRun = { termination: Termination; stdout: string; stderr: string };

function category(run: CodexRun) {
  const output = `${run.stderr}\n${run.stdout}`;
  return categories.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unrecognized error';
}

export function codexFailure(run: CodexRun) {
  if (run.termination.kind === 'timeout') return 'Codex did not finish successfully (timed out).';
  if (run.termination.kind !== 'exited') return `Codex did not finish successfully (${run.termination.kind}).`;
  const output = `${run.stderr}\n${run.stdout}`;
  const status = /\b(?:status|http|code)\D{0,4}([45]\d\d)\b/i.exec(output)?.[1];
  return `Codex did not finish successfully (exit ${run.termination.code}, ${category(run)}${status ? `, HTTP ${status}` : ''}).`;
}

// A short provider overload, a model at capacity, or a dropped stream ends
// `codex exec` with a nonzero exit. These clear within minutes, so the run tries again. Usage,
// rate, and authentication limits do not clear that fast and fail at once.
const transient = new Set(['provider overloaded', 'network']);
export const codexRetryDelaysMs = [60_000, 180_000, 300_000] as const;

export async function withCodexRetry<Run extends CodexRun>({ run, beforeRetry, signal, delaysMs = codexRetryDelaysMs }: {
  run: () => Promise<Run>; beforeRetry?: () => Promise<void>; signal?: AbortSignal; delaysMs?: readonly number[];
}): Promise<Run & { attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    const result = await run();
    const wait = delaysMs[attempt - 1];
    if (result.termination.kind !== 'exited' || result.termination.code === 0 || wait === undefined || !transient.has(category(result))) {
      return { ...result, attempts: attempt };
    }
    await delay(wait, undefined, { signal });
    await beforeRetry?.();
  }
}
