import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'e2e/runner';

if (process.versions.node !== '22.23.1' || process.versions.bun) throw new Error('TesterArmy requires Node 22.23.1.');
const context = JSON.parse(readFileSync(process.env.TESTERARMY_CONTEXT, 'utf8'));
const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());
const timer = setInterval(() => { if (existsSync(context.abortFile)) cancellation.abort(); }, 200);
try {
  const outcome = await run({ cwd: process.cwd(), config: resolve('e2e.config.ts'), files: ['tests/jordan.e2e.ts'], interruptSignal: cancellation.signal });
  writeFileSync('outcome.json', JSON.stringify({ exitCode: outcome.exitCode, status: outcome.status, reportPath: outcome.reportPath }), { flag: 'wx', mode: 0o600, flush: true });
  process.exitCode = outcome.exitCode;
} finally { clearInterval(timer); }
