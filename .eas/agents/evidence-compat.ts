import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evidencePhase } from './evidence-phase';
import { ghPin, probeEvidenceRuntime } from './evidence-tools';
import { digest } from './result';

const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());
const directory = await mkdtemp(join(tmpdir(), 'lob-evidence-compat-'));
try {
  const pin = process.platform === 'linux' && process.arch === 'x64' ? ghPin.linux
    : process.platform === 'darwin' && process.arch === 'arm64' ? ghPin.darwin : null;
  if (!pin || process.argv.length !== 3) throw new Error('Usage: evidence-compat.ts <existing pinned gh binary>.');
  const file = resolve(process.argv[2]!);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || digest(await readFile(file)) !== pin.binary) throw new Error('Existing gh binary pin mismatch.');
  await probeEvidenceRuntime({ gh: { file, args: [] }, directory, env: { PATH: process.env.PATH }, phase: evidencePhase(cancellation.signal, 120_000) });
  process.stdout.write(JSON.stringify({ platform: process.platform, arch: process.arch, gh: ghPin.version, binarySha256: pin.binary,
    commentHelp: ['pr', 'issue'], playbackCanaryFrames: 6, authentication: false, network: false }) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
