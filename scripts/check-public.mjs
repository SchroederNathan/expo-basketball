import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
  ['machine path', /(?:\/Users\/|\/Volumes\/|[A-Z]:\\Users\\)/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider credential', /\bsk-[A-Za-z0-9_-]{24,}/],
];
const failures = [];
for (const file of files) {
  if (!/\.(?:md|mjs|ts|tsx|json|tsv|yml|yaml)$/.test(file)) continue;
  if (!statSync(file).isFile()) continue;
  const contents = readFileSync(file, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(contents)) failures.push(`${file}: ${label}`);
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Public-file checks passed.\n');
}
