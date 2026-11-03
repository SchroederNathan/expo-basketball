import type { Termination } from './result';

// Names why `codex exec` failed without publishing its output. Only a fixed
// category, the exit code, and an HTTP status number leave the controller.
const categories: readonly (readonly [string, RegExp])[] = [
  ['usage limit', /usage limit|insufficient_quota|quota exceeded|exceeded your (current )?quota|plan limit/i],
  ['rate limit', /rate[ _-]?limit|too many requests|\b429\b/i],
  ['authentication', /unauthori[sz]ed|\b401\b|\b403\b|forbidden|not logged in|login required|refresh token|token (has )?expired/i],
  ['model unavailable', /model\b.{0,80}\b(not found|not supported|unsupported|does not exist|unknown|unavailable)|unsupported model|invalid model/i],
  ['provider overloaded', /overloaded|server[_ ]error|service unavailable|bad gateway|\b5\d\d\b/i],
  ['network', /econnrefused|econnreset|enotfound|etimedout|stream disconnected|connection (reset|refused|closed)|network error/i],
];

export function codexFailure(run: { termination: Termination; stdout: string; stderr: string }) {
  if (run.termination.kind === 'timeout') return 'Codex did not finish successfully (timed out).';
  if (run.termination.kind !== 'exited') return `Codex did not finish successfully (${run.termination.kind}).`;
  const output = `${run.stderr}\n${run.stdout}`;
  const category = categories.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unrecognized error';
  const status = /\b(?:status|http|code)\D{0,4}([45]\d\d)\b/i.exec(output)?.[1];
  return `Codex did not finish successfully (exit ${run.termination.code}, ${category}${status ? `, HTTP ${status}` : ''}).`;
}
