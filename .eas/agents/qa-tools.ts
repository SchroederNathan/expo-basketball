import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import manifest from './qa-tools/package.json';
import { command, safeEnvironment, succeeded, type Command, type CommandObservation } from './process';

export const qaToolPins = { bun: '1.2.22', eas: manifest.dependencies['eas-cli'],
  codex: manifest.dependencies['@openai/codex'], agentDevice: manifest.dependencies['agent-device'] };
export type QaToolCommands = Record<'eas' | 'codex' | 'device', Command>;
export type PreparedQaTools = { commands: Omit<QaToolCommands, 'device'> & { device: { file: string; args: [] } }; binDirectory: string };
type Stage = 'storage' | 'runtime' | 'install' | 'metadata' | 'shim' | 'probe';
type Tool = keyof QaToolCommands | 'bun' | 'node' | 'bundle';
type Reason = 'unavailable' | 'incompatible-version' | 'invalid-bundle' | 'invalid-package' | 'invalid-bin' |
  'command-failed' | 'version-mismatch' | 'deadline' | 'cancelled' | 'io-failed';
export class QaToolPreparationError extends Error {
  constructor(readonly stage: Stage, readonly tool: Tool, readonly reason: Reason, readonly diagnostics: {
    nodeVersion: string | null; packageChecks: 'validated' | 'injected' | 'unverified';
    command: (CommandObservation & { stage: Stage; tool: Tool; termination: Awaited<ReturnType<typeof command>>['termination']['kind'];
      versionOutputMatches: boolean | null; stdoutPresent: boolean; stderr: ReturnType<typeof classifyStderr> }) | null;
    storageCleanup: 'removed' | 'failed' | 'not-owned';
  } | null = null) {
    super(`QA tool preparation ${stage}/${tool}/${reason}.`);
  }
}
const packages = {
  eas: { name: 'eas-cli', bin: 'eas', entry: 'bin/run', version: qaToolPins.eas },
  codex: { name: '@openai/codex', bin: 'codex', entry: 'bin/codex.js', version: qaToolPins.codex },
  device: { name: 'agent-device', bin: 'agent-device', entry: 'bin/agent-device.mjs', version: qaToolPins.agentDevice },
};
const packageSchema = z.object({ name: z.string(), version: z.string(), bin: z.union([z.string(), z.record(z.string(), z.string())]) });
const nodeSchema = z.object({ file: z.string(), version: z.string() });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const within = (parent: string, child: string) => { const path = relative(parent, child); return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path); };
const errorCodes = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_REQUIRE_ESM',
  'ERR_REQUIRE_ASYNC_MODULE', 'ERR_INVALID_PACKAGE_CONFIG', 'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_DLOPEN_FAILED', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_INVALID_ARG_TYPE', 'ENOENT', 'EACCES', 'EPERM', 'ENOSPC',
  'ENOMEM', 'EAGAIN', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'] as const;

function classifyStderr(stderr: string, lockedPackages: Set<string>) {
  const text = stderr.slice(0, 32_768).replace(/\u001b\[[0-9;]*m/g, '');
  const code = errorCodes.find((code) => new RegExp(`(?:\\bcode:\\s*['"]${code}['"]|\\[${code}\\]|\\bError: ${code}\\b)`).test(text)) ?? null;
  const specifier = /Cannot find (?:module|package) ['"]([^'"\r\n]{1,500})['"]/.exec(text)?.[1];
  const packageName = specifier && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?=\/|$)/.exec(specifier)?.[0];
  const dependency = packageName && lockedPackages.has(packageName) ? packageName : null;
  const target = !specifier ? null : specifier.startsWith('.') ? 'relative-file'
    : isAbsolute(specifier) || specifier.startsWith('file:') ? 'absolute-file'
      : dependency ? specifier === dependency ? 'locked-package' : 'locked-package-subpath' : 'unrecognized-specifier';
  const type = ['SyntaxError', 'ReferenceError', 'TypeError', 'RangeError'].find((type) => new RegExp(`\\b${type}:`).test(text)) ?? null;
  return { present: stderr.length > 0, truncated: stderr.length > 32_768, code, type, dependency, target,
    cause: code ?? type ?? (/heap out of memory|Allocation failed.*heap/i.test(text) ? 'heap-exhausted'
      : /bad option:|unknown (?:option|flag)/i.test(text) ? 'invalid-option' : stderr.length ? 'unclassified' : 'empty'),
    origin: /node_modules[\/]eas-cli[\/]bin[\/]run\b/.test(text) ? 'eas-launcher'
      : /node_modules[\/]@oclif[\/]core[\/]/.test(text) ? 'oclif' : 'unclassified' };
}

export async function prepareQaTools(options: { sourceDirectory: string; directory: string; env: NodeJS.ProcessEnv;
  signal: AbortSignal; timeoutMs?: number; commands?: QaToolCommands }): Promise<PreparedQaTools> {
  const deadline = performance.now() + Math.min(options.timeoutMs ?? 120_000, 120_000);
  let stage: Stage = 'storage';
  let tool: Tool = 'bundle';
  let owned = false;
  let nodeVersion: string | null = null;
  let packageChecks: NonNullable<QaToolPreparationError['diagnostics']>['packageChecks'] = 'unverified';
  let lastCommand: NonNullable<QaToolPreparationError['diagnostics']>['command'] = null;
  const lockedPackages = new Set<string>();
  function fail(reason: Reason): never { throw new QaToolPreparationError(stage, tool, reason); }
  const remaining = () => {
    if (options.signal.aborted) fail('cancelled');
    const ms = deadline - performance.now();
    if (!Number.isFinite(ms) || ms <= 0) fail('deadline');
    return ms;
  };
  try {
    remaining();
    if (!isAbsolute(options.directory)) fail('invalid-bundle');
    await mkdir(options.directory, { mode: 0o700 });
    owned = true;
    const directory = await realpath(options.directory);
    const install = join(directory, 'install');
    const home = join(directory, 'home');
    const cache = join(directory, 'cache');
    const temporary = join(directory, 'tmp');
    const binDirectory = join(directory, 'bin');
    for (const directory of [install, home, cache, temporary, binDirectory]) await mkdir(directory, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...safeEnvironment(options.env), HOME: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      XDG_CONFIG_HOME: home, XDG_CACHE_HOME: cache, BUN_INSTALL_CACHE_DIR: cache, CI: '1' };
    const run = async (executable: Command, args: string[], expectedVersion?: string) => {
      const result = await command({ executable, args, cwd: install, env, signal: options.signal, timeoutMs: remaining() });
      lastCommand = { ...result.observation, stage, tool, termination: result.termination.kind, stdoutPresent: result.stdout.length > 0,
        versionOutputMatches: expectedVersion === undefined ? null : result.stdout.trim() === expectedVersion,
        stderr: classifyStderr(result.stderr, lockedPackages) };
      remaining();
      if (result.termination.kind === 'timeout') fail('deadline');
      if (!succeeded(result)) fail(result.termination.kind === 'not-started' ? 'unavailable' : 'command-failed');
      return result.stdout.trim();
    };
    stage = 'runtime'; tool = 'node';
    const runtime = nodeSchema.parse(JSON.parse(await run({ file: 'node', args: [] },
      ['-p', 'JSON.stringify({file:process.execPath,version:process.versions.node})'])));
    if (!isAbsolute(runtime.file)) fail('incompatible-version');
    const version = /^(\d+)\.(\d+)\.\d+$/.exec(runtime.version);
    if (!version || !(Number(version[1]) > 22 || (Number(version[1]) === 22 && Number(version[2]) >= 12))) fail('incompatible-version');
    nodeVersion = runtime.version.length <= 32 ? runtime.version : null;
    const node = await realpath(runtime.file);
    if (await run({ file: node, args: [] }, ['--version'], `v${runtime.version}`) !== `v${runtime.version}`) fail('incompatible-version');
    let commands: QaToolCommands;
    if (options.commands) {
      commands = options.commands;
      packageChecks = 'injected';
    } else {
      tool = 'bun';
      let bun: string | undefined;
      for (const directory of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
        try { const candidate = await realpath(join(directory, 'bun')); await access(candidate, constants.X_OK); bun = candidate; break; } catch {}
      }
      if (!bun) fail('unavailable');
      if (await run({ file: bun, args: [] }, ['--version'], qaToolPins.bun) !== qaToolPins.bun) fail('incompatible-version');
      stage = 'storage'; tool = 'bundle';
      const source = join(options.sourceDirectory, '.eas/agents/qa-tools');
      const protectedManifest: unknown = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      if (JSON.stringify(protectedManifest) !== JSON.stringify(manifest)) fail('invalid-bundle');
      for (const name of ['package.json', 'bun.lock']) await copyFile(join(source, name), join(install, name));
      const lock = await readFile(join(install, 'bun.lock'), 'utf8');
      if (!lock.trim()) fail('invalid-bundle');
      for (const match of lock.matchAll(/^\s*"[^"\r\n]+":\s*\["((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@/gm)) lockedPackages.add(match[1]!);
      stage = 'install'; tool = 'bun';
      await run({ file: bun, args: [] }, ['install', '--frozen-lockfile', '--ignore-scripts', '--omit', 'peer',
        '--backend', 'copyfile', '--cache-dir', cache, '--registry', 'https://registry.npmjs.org']);
      stage = 'metadata';
      const installed = async (name: keyof QaToolCommands): Promise<Command> => {
        tool = name;
        const expected = packages[name];
        const directory = join(install, 'node_modules', expected.name);
        const base = await realpath(directory);
        if (!within(install, base)) fail('invalid-package');
        const parsed = packageSchema.safeParse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')));
        if (!parsed.success || parsed.data.name !== expected.name || parsed.data.version !== expected.version) fail('invalid-package');
        const entry = typeof parsed.data.bin === 'string' ? parsed.data.bin : parsed.data.bin[expected.bin];
        if (!entry || entry.replace(/^\.\//, '') !== expected.entry) fail('invalid-bin');
        let file: string;
        try {
          file = await realpath(resolve(directory, entry));
          if (!within(base, file) || !(await stat(file)).isFile()) fail('invalid-bin');
        } catch { fail('invalid-bin'); }
        return { file: node, args: [file] };
      };
      commands = { eas: await installed('eas'), codex: await installed('codex'), device: await installed('device') };
      packageChecks = 'validated';
    }
    stage = 'shim'; tool = 'device';
    const device = { file: join(binDirectory, 'agent-device'), args: [] satisfies [] };
    for (const name of ['eas', 'codex', 'device'] as const) {
      tool = name;
      if (!isAbsolute(commands[name].file)) fail('invalid-bin');
    }
    tool = 'device';
    const rawDevice = commands.device;
    await writeFile(device.file, `#!/bin/sh\nexec ${[rawDevice.file, ...rawDevice.args].map(quote).join(' ')} "$@"\n`, { mode: 0o700, flag: 'wx' });
    const prepared = { commands: { eas: commands.eas, codex: commands.codex, device }, binDirectory };
    stage = 'probe';
    for (const name of ['eas', 'codex', 'device'] as const) {
      tool = name;
      const expected = name === 'eas' ? `eas-cli/${qaToolPins.eas} ${process.platform}-${process.arch} node-v${runtime.version}`
        : name === 'codex' ? `codex-cli ${qaToolPins.codex}` : qaToolPins.agentDevice;
      if (await run(prepared.commands[name], ['--version'], expected) !== expected) fail('version-mismatch');
    }
    remaining();
    return prepared;
  } catch (error) {
    let storageCleanup: NonNullable<QaToolPreparationError['diagnostics']>['storageCleanup'] = 'not-owned';
    if (owned) {
      try { await rm(options.directory, { recursive: true, force: true }); storageCleanup = 'removed'; }
      catch { storageCleanup = 'failed'; }
    }
    throw new QaToolPreparationError(error instanceof QaToolPreparationError ? error.stage : stage,
      error instanceof QaToolPreparationError ? error.tool : tool, error instanceof QaToolPreparationError ? error.reason : 'io-failed',
      { nodeVersion, packageChecks, command: lastCommand, storageCleanup });
  }
}
