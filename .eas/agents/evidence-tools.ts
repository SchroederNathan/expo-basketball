import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { evidencePhase, phaseBudget, type EvidencePhase } from './evidence-phase';
import { GitHub } from './github';
import { verifyPlaybackReadiness } from './evidence-media';
import { publicBytes } from './evidence-files';
import { command, safeEnvironment, succeeded, type Command } from './process';
import { digest } from './result';

export const ghPin = { version: '2.103.1', checksums: '021c405cf11d08980df1266e231f801e3f4da0e29b09733ccee40721e79298fd',
  linux: { name: 'gh_2.103.1_linux_amd64.tar.gz', archive: '57500f347b5e84efb6578c9b644eeb3b4e54046762635a939dd0ee2cca1c1add', binary: 'fb90b33d21942f354b70577f29d97aca4738c6bf1868c1e4097837493cd64cb0' },
  darwin: { name: 'gh_2.103.1_macOS_arm64.zip', archive: '71b5ffc74bb69cdb72ca397d9b486d78755019be33ca927288299197ad7f6807', binary: '0f8037e2f4182b431ae714568f355391b5565b5e7a3d47390208fa7ad78e9552' } } as const;
export type EvidenceWriter = { github: GitHub; gh: Command; actor: number; binarySha256: string; directory: string; env: NodeJS.ProcessEnv };

export async function prepareEvidenceWriter({ repository, env, directory, apiBase, download = publicBytes, phase = evidencePhase(undefined, 120_000) }: {
  repository: string; env: NodeJS.ProcessEnv; directory: string; apiBase?: string; download?: typeof publicBytes; phase?: EvidencePhase;
}): Promise<EvidenceWriter> {
  const github = new GitHub({ repository, env, apiBase });
  const actor = await github.writer(phaseBudget(phase, 20_000).signal);
  const pin = process.platform === 'linux' && process.arch === 'x64' ? ghPin.linux
    : process.platform === 'darwin' && process.arch === 'arm64' ? ghPin.darwin : null;
  if (!pin) throw new Error('Pinned evidence CLI supports Linux AMD64 and macOS ARM64 only.');
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, 'gh');
  let cached: Buffer | null = null;
  try { const stat = await lstat(binary); if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe cached gh.'); cached = await readFile(binary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!cached || digest(cached) !== pin.binary) {
    const prefix = 'https://github.com/cli/cli/releases/download/v2.103.1/';
    const checksums = await download(prefix + 'gh_2.103.1_checksums.txt', 10_000, true, phase.signal);
    if (digest(checksums) !== ghPin.checksums || !Buffer.from(checksums).toString().split('\n').some((line) => line.trim().split(/\s+/).join(' ') === `${pin.archive} ${pin.name}`)) throw new Error('Official gh checksum pin mismatch.');
    const archive = await download(prefix + pin.name, 25_000_000, true, phase.signal);
    if (digest(archive) !== pin.archive) throw new Error('gh archive pin mismatch.');
    const path = join(directory, pin.name);
    await writeFile(path, archive, { mode: 0o600 });
    const member = pin.name.replace(/\.(zip|tar.gz)$/, '') + '/bin/gh';
    const extracted = await command({ executable: { file: 'python3', args: [] }, cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 30_000),
      args: ['-c', `import sys,tarfile,zipfile,stat\np,m,o=sys.argv[1:]\nif p.endswith('.zip'):\n a=zipfile.ZipFile(p); i=a.getinfo(m); assert not stat.S_ISLNK(i.external_attr>>16); b=a.read(i)\nelse:\n a=tarfile.open(p); i=a.getmember(m); assert i.isfile() and not i.issym() and not i.islnk(); b=a.extractfile(i).read()\nassert len(b)<70000000\nopen(o,'wb').write(b)`, path, member, binary] });
    if (!succeeded(extracted) || digest(await readFile(binary)) !== pin.binary) throw new Error('gh binary pin mismatch.');
  }
  await chmod(binary, 0o700);
  const isolated = { ...safeEnvironment(env), HOME: directory, GH_CONFIG_DIR: directory, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_TOKEN: env.AGENT_GITHUB_WRITE_TOKEN };
  const gh = { file: binary, args: [] };
  await probeEvidenceRuntime({ gh, directory, env, phase });
  return { github, gh, actor, binarySha256: pin.binary, directory, env: isolated };
}

export async function probeEvidenceRuntime({ gh, directory, env, phase = evidencePhase(undefined, 120_000) }: {
  gh: Command; directory: string; env: NodeJS.ProcessEnv; phase?: EvidencePhase;
}) {
  const isolated = { ...safeEnvironment(env), HOME: directory, GH_CONFIG_DIR: directory, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  for (const args of [['--version'], ['pr', 'comment', '--help'], ['issue', 'comment', '--help']]) {
    const probe = await command({ executable: gh, args, cwd: directory, env: isolated, ...phaseBudget(phase, 15_000) });
    if (!succeeded(probe) || (args[0] === '--version' ? !probe.stdout.startsWith('gh version 2.103.1 ')
      : !probe.stdout.includes('--attach') || !probe.stdout.includes('--body-file'))) throw new Error('Pinned gh runtime readiness failed.');
  }
  for (const file of ['ffprobe', 'ffmpeg']) {
    const probe = await command({ executable: { file, args: [] }, args: ['-version'], cwd: directory, env: safeEnvironment(env), ...phaseBudget(phase, 10_000) });
    if (!succeeded(probe)) throw new Error('Evidence media tools are unavailable.');
  }
  await verifyPlaybackReadiness(directory, env, phase);
}
