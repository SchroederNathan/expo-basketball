// A generated acceptance test belongs to one open issue. The test agent writes it
// before any fix exists, and the controller freezes its bytes by SHA-256.
// The file lives in a dot folder so the app typecheck and the fix agent never touch it.
export const generatedTestDirectory = '.agent-tests';
export const generatedTestPattern = /^\.agent-tests\/issue-[1-9][0-9]{0,8}\.e2e\.ts$/;
export const generatedTestPath = (issue: number) => `${generatedTestDirectory}/issue-${issue}.e2e.ts`;
export const generatedTestTitle = (issue: number) => `Issue #${issue} acceptance`;
export const generatedRunnerFile = (issue: number) => `tests/issue-${issue}.e2e.ts`;
export const maxGeneratedChecks = 6;

const allowedImports = new Set([
  "import { test } from '@e2e-dev/mobile';",
  "import { expect } from 'e2e';",
  "import { runtimeContext, identityLabel } from '../context';",
]);
// The test runs with the controller's model login, so it may only drive the app
// through the runner fixtures. It cannot reach the host, the network, or other apps.
const forbidden: [RegExp, string][] = [
  [/\brequire\s*\(|\bimport\s*\(/, 'dynamic imports'],
  [/\b(?:process|globalThis|Bun|Deno|eval|fetch|XMLHttpRequest|WebSocket)\b|\bFunction\s*\(|child_process|node:/, 'host or network access'],
  [/\.(?:only|skip|fixme)\b|\btest\.(?:extend|describe|step)\b|\bdescribe\s*\(/, 'test filtering or nesting'],
  [/\bagent\.(?:assert|extract|waitFor)\b/, 'model judgments in place of exact checks'],
  [/\bdevice\.(?:openApp|openLink|installApp|setPermission|clearKeychain|closeApp)\b/, 'app installs, links, or permissions'],
  [/\bset(?:Timeout|Interval)\s*\(/, 'timers'],
];

export type GeneratedSpec = { file: string; title: string; checks: [string, ...string[]] };

export function parseGeneratedTest(source: string, issue: number): GeneratedSpec {
  if (!source.trim() || Buffer.byteLength(source) > 16_000) throw new Error('The generated test must be a nonempty file under 16 KB.');
  const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line)).map((line) => line.trim());
  if (imports.some((line) => !allowedImports.has(line)) || new Set(imports).size !== imports.length) {
    throw new Error('The generated test may only import test, expect, runtimeContext, and identityLabel.');
  }
  for (const [pattern, what] of forbidden) if (pattern.test(source)) throw new Error(`The generated test uses ${what}.`);
  const titles = [...source.matchAll(/\btest\(\s*'([^'\\\n]{1,120})'/g)].map((match) => match[1]);
  if ((source.match(/\btest\(/g) ?? []).length !== 1 || titles.length !== 1 || titles[0] !== generatedTestTitle(issue)) {
    throw new Error(`The generated test must contain exactly one test titled "${generatedTestTitle(issue)}".`);
  }
  const shots = [...source.matchAll(/\bapp\.screenshot\(\s*'([a-z0-9-]+)'\s*\)/g)].map((match) => match[1]!);
  if ((source.match(/\bapp\.screenshot\(/g) ?? []).length !== shots.length) throw new Error('Every screenshot needs a literal name.');
  const checks = shots.slice(1, -1);
  if (shots[0] !== 'controller-start' || shots.at(-1) !== 'controller-end' || !checks.length || checks.length > maxGeneratedChecks ||
    new Set(checks).size !== checks.length || checks.some((id) => !/^[a-z][a-z0-9-]{1,39}$/.test(id) || id.startsWith('controller-'))) {
    throw new Error(`Screenshots must be controller-start, 1 to ${maxGeneratedChecks} unique check names, then controller-end.`);
  }
  if ((source.match(/identityLabel\(runtimeContext\(\)\.target\)/g) ?? []).length !== 1) {
    throw new Error('The generated test must read the installed identity once with identityLabel(runtimeContext().target).');
  }
  return { file: generatedRunnerFile(issue), title: generatedTestTitle(issue), checks: checks as [string, ...string[]] };
}
