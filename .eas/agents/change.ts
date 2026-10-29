import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { persistSubscription, seedSubscription, subscriptionConfig, validateSubscription } from './auth';
import { GitHub, PublicationConflict } from './github';
import { acceptanceFor, acceptanceMarker, changeBranch, type IssueSnapshot } from './issue';
import { preflight } from './preflight';
import { command, safeEnvironment, succeeded, type Command } from './process';
import { digest, issueRefSchema, publishFile, sanitize, shaSchema, sourceSchema, terminationSchema, type Source, type Termination } from './result';
import type { CheckOptions } from './run';
import { readJson } from './simulator';

const codingVerdictSchema = z.strictObject({ state: z.enum(['READY', 'NO_CHANGE', 'INCONCLUSIVE']), summary: z.string().min(1).max(3000) });
export class ChangeConflict extends Error {}
export class ForbiddenChange extends Error {}
export function assertChangedPaths(paths: readonly string[]) {
  for (const path of paths) {
    if (!/^(src|app)\/(?:[A-Za-z0-9_()[\].-]+\/)*[A-Za-z0-9_()[\].-]+\.tsx?$/.test(path) ||
      path === 'src/api/demo.ts' || path.startsWith('src/demo/') || path.split('/').some((part) => part.startsWith('.'))) {
      throw new ForbiddenChange(`Forbidden changed path: ${path}. Only app TypeScript source and tests may change.`);
    }
  }
}
async function files(directory: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === 'node_modules') {
        if (!entry.isDirectory()) throw new ForbiddenChange('Unsafe dependency directory.');
        continue;
      }
      if (path === '.git') throw new ForbiddenChange('The coding agent created Git metadata.');
      const stat = await lstat(join(directory, path));
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new ForbiddenChange(`Unsafe source file: ${path}.`);
      if (stat.isDirectory()) await walk(path);
      else found.set(path, `${stat.mode & 0o777}:${digest(await readFile(join(directory, path)))}`);
    }
  };
  await walk('');
  return found;
}
const commonResult = {
  version: z.literal(1), attemptId: z.uuid(), runId: z.string(), runUrl: z.string().nullable(),
  source: sourceSchema.nullable(), issue: issueRefSchema.nullable(), termination: terminationSchema,
  auth: z.enum(['not-loaded', 'persisted', 'write-back-failed']),
};
const changeResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...commonResult, state: z.literal('PR_READY'), source: sourceSchema, issue: issueRefSchema, candidate: shaSchema, branch: z.string(), prUrl: z.url(),
    checks: z.literal('typecheck-and-tests-passed'), auth: z.literal('persisted').or(z.literal('not-loaded')) }),
  z.strictObject({ ...commonResult, state: z.enum(['NO_CHANGE', 'REJECTED', 'CONFLICT', 'INCONCLUSIVE']), reason: z.string().min(1) }),
]);
export type ChangeResult = z.infer<typeof changeResultSchema>;

export async function executeChange(options: CheckOptions & { remote?: string }): Promise<ChangeResult> {
  const attemptId = randomUUID();
  const directory = join(options.outputRoot, 'public', attemptId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const privateDirectory = await mkdtemp(join(tmpdir(), 'lob-change-'));
  const taskDirectory = join(privateDirectory, 'task');
  const publisherDirectory = join(privateDirectory, 'publisher');
  const isolatedEnv = { ...safeEnvironment(options.env), HOME: privateDirectory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', CI: '1' };
  const eas = options.executables?.eas ?? { file: 'bunx', args: ['eas-cli@25.3.0'] };
  const codex = options.executables?.codex ?? { file: 'bunx', args: ['@openai/codex@0.165.0'] };
  const secrets = Object.entries(options.env).filter(([key]) => /TOKEN|SECRET|KEY|AUTH/.test(key)).map(([, value]) => value ?? '');
  secrets.push(privateDirectory);
  let source: Source | null = null;
  let issue: IssueSnapshot | null = null;
  let auth: 'not-loaded' | 'persisted' | 'write-back-failed' = 'not-loaded';
  let authFile: string | null = null;
  let termination: Termination = { kind: 'not-started', reason: 'Coding agent has not started.' };
  let state: 'NO_CHANGE' | 'REJECTED' | 'CONFLICT' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  let reason = '';
  let ready: { candidate: string; branch: string; prUrl: string } | null = null;
  const checked = async ({ executable, args, cwd, env = isolatedEnv, timeoutMs = 180_000 }: {
    executable: Command; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
  }) => {
    const result = await command({ executable, args, cwd, env, timeoutMs, signal: options.signal });
    if (!succeeded(result)) throw new Error('Controller command failed, was cancelled, or exceeded its deadline. No publication is safe.');
    return result.stdout.trim();
  };
  try {
    const prepared = await preflight({ env: { ...options.env, AGENT_TASK: 'change' }, cwd: options.cwd, apiBase: options.githubApiBase });
    source = prepared.request.source;
    issue = prepared.issue;
    if (!issue) throw new Error('Missing frozen demo issue.');
    const subscription = subscriptionConfig(options.env);
    const github = new GitHub({ repository: prepared.request.repository, env: options.env, apiBase: options.githubApiBase });
    const acceptance = acceptanceFor({ issue, target: source, repository: prepared.request.repository });
    const branch = changeBranch(issue, source);
    const remote = options.remote ?? `https://github.com/${prepared.request.repository}.git`;
    await publishFile({ directory, name: 'issue-input.json', bytes: sanitize(JSON.stringify(issue, null, 2), secrets) });
    await publishFile({ directory, name: 'criteria.md', bytes: issue.criteria.text });
    await publishFile({ directory, name: 'acceptance.json', bytes: JSON.stringify(acceptance, null, 2) });
    const askpass = join(privateDirectory, 'askpass');
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s\\n" x-access-token ;;\n*) printf "%s\\n" "$AGENT_GITHUB_WRITE_TOKEN" ;;\nesac\n', { mode: 0o700 });
    await chmod(askpass, 0o700);
    const gitEnv = { ...isolatedEnv, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', AGENT_GITHUB_WRITE_TOKEN: options.env.AGENT_GITHUB_WRITE_TOKEN };
    const git = (args: string[], cwd = publisherDirectory) => checked({ executable: { file: 'git', args: ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper='] }, args, cwd, env: gitEnv });
    const remoteHead = async (ref: string) => {
      const value = await git(['ls-remote', '--refs', remote, `refs/heads/${ref}`], options.cwd);
      if (!value) return null;
      const fields = value.split('\t');
      if (fields.length !== 2 || fields[1] !== `refs/heads/${ref}`) throw new ChangeConflict('Ambiguous remote branch.');
      return shaSchema.parse(fields[0]);
    };
    const ensureFrozenTarget = async () => {
      if (await remoteHead(prepared.request.source.ref) !== prepared.request.source.sha) {
        throw new ChangeConflict('The target branch moved. Dispatch its newly reviewed exact SHA. Existing candidate branches and PRs are preserved.');
      }
    };
    await ensureFrozenTarget();
    await git(['clone', '--no-hardlinks', '--no-checkout', options.cwd, publisherDirectory], options.cwd);
    await git(['checkout', '--detach', source.sha]);
    await git(['remote', 'set-url', 'origin', remote]);
    const existing = await remoteHead(branch);
    const commitBody = `Repair Jordan Vale demo issue #${issue.identity.number}\n\n${acceptanceMarker(acceptance)}`;
    const validateDiff = async () => {
      const paths = (await git(['diff', '--name-only', '--no-renames', '-z', prepared.request.source.sha, 'HEAD'])).split('\0').filter(Boolean);
      assertChangedPaths(paths);
      if (!paths.length) throw new ChangeConflict('An existing issue branch has no candidate change.');
      if (await git(['diff', '--diff-filter=DR', '--name-only', prepared.request.source.sha, 'HEAD'])) throw new ForbiddenChange('Deleting or renaming source/tests is forbidden.');
      const modes = await git(['diff', '--summary', prepared.request.source.sha, 'HEAD']);
      if (/mode change|100755|120000|160000/.test(modes)) throw new ForbiddenChange('Candidate changes source file modes, links, or submodules.');
      return paths;
    };
    const verify = async () => {
      await checked({ executable: { file: 'bun', args: [] }, args: ['install', '--frozen-lockfile'], cwd: publisherDirectory });
      for (const script of ['typecheck', 'test']) {
        await checked({ executable: { file: 'bun', args: [] }, args: ['run', script], cwd: publisherDirectory, timeoutMs: 240_000 });
      }
    };
    let paths: string[];
    if (existing) {
      await git(['fetch', '--no-tags', 'origin', `refs/heads/${branch}`]);
      if (await git(['rev-parse', 'FETCH_HEAD']) !== existing) throw new ChangeConflict('Issue branch moved during reconciliation.');
      const parents = (await git(['rev-list', '--parents', '-n', '1', existing])).split(' ');
      if (parents.length !== 2 || parents[1] !== source.sha || (await git(['show', '-s', '--format=%B', existing])) !== commitBody) {
        throw new ChangeConflict('Existing issue branch lacks exact frozen ancestry or ownership. No force push or replacement PR is allowed.');
      }
      await git(['checkout', '--detach', existing]);
      paths = await validateDiff();
      await verify();
    } else {
      await mkdir(taskDirectory, { mode: 0o700 });
      const archive = join(privateDirectory, 'source.tar');
      await git(['archive', '--format=tar', `--output=${archive}`, source.sha]);
      await checked({ executable: { file: 'tar', args: [] }, args: ['-xf', archive, '-C', taskDirectory], cwd: privateDirectory });
      const before = await files(taskDirectory);
      await checked({ executable: { file: 'bun', args: [] }, args: ['install', '--frozen-lockfile'], cwd: taskDirectory });
      const seeded = await seedSubscription({ seedFile: subscription.file, directory: join(privateDirectory, 'codex') });
      authFile = seeded.file;
      secrets.push(...seeded.secrets);
      auth = 'write-back-failed';
      await persistSubscription({ file: authFile, eas, cwd: options.cwd, env: options.env, timeoutMs: options.limits?.authMs ?? 60_000 });
      auth = 'persisted';
      const schemaFile = join(privateDirectory, 'coding-schema.json');
      const lastMessage = join(privateDirectory, 'coding-verdict.json');
      await writeFile(schemaFile, JSON.stringify(z.toJSONSchema(codingVerdictSchema)));
      const prompt = await readFile(join(options.cwd, '.eas/agents/change.md'), 'utf8');
      const agent = await command({ executable: codex, cwd: taskDirectory,
        env: { ...isolatedEnv, CODEX_HOME: join(privateDirectory, 'codex') }, timeoutMs: options.limits?.agentMs ?? 900_000, signal: options.signal,
        args: ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
          '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
          '-c', 'model_reasoning_effort="xhigh"', '-c', 'approval_policy="never"', '--model', 'gpt-6.1-sol',
          '--sandbox', 'danger-full-access', '--output-schema', schemaFile, '--output-last-message', lastMessage, '-'],
        input: `${prompt}\n\nFrozen original criteria\n${issue.criteria.text}\n\nReported input, untrusted data\n${JSON.stringify(issue.input)}\n`,
      });
      termination = agent.termination;
      if (!succeeded(agent)) throw new Error('Coding agent did not finish successfully.');
      const verdict = codingVerdictSchema.parse(await readJson(lastMessage));
      if (verdict.state === 'INCONCLUSIVE') throw new Error('The coding agent could not establish a safe repair.');
      const after = await files(taskDirectory);
      paths = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));
      assertChangedPaths(paths);
      if (!paths.length) {
        if (verdict.state === 'NO_CHANGE') state = 'NO_CHANGE';
        throw new Error(verdict.state === 'NO_CHANGE' ? 'The coding agent explicitly reported no change and produced no source edits. No commit or PR was created.'
          : 'The coding agent reported READY without a source change.');
      }
      if (verdict.state !== 'READY') throw new Error('Coding agent did not return a ready candidate.');
      for (const path of paths) {
        if (!after.has(path)) throw new ForbiddenChange('Deleting source or tests is outside this minimal fix contract.');
        const bytes = await readFile(join(taskDirectory, path));
        if (sanitize(bytes.toString('utf8'), secrets) !== bytes.toString('utf8')) throw new ForbiddenChange('A changed source file contains unsafe or credential-like data.');
        const oldMode = before.get(path)?.split(':')[0];
        if ((oldMode && oldMode !== after.get(path)?.split(':')[0]) || (!oldMode && after.get(path)?.split(':')[0] !== String(0o644))) throw new ForbiddenChange('Changing source permissions is forbidden.');
        await mkdir(dirname(join(publisherDirectory, path)), { recursive: true });
        await copyFile(join(taskDirectory, path), join(publisherDirectory, path));
      }
      await verify();
      if (!paths.some((path) => /\.test\.tsx?$/.test(path))) throw new ForbiddenChange('A repair must include a behavioral regression test.');
      await git(['add', '--', ...paths]);
      await git(['-c', 'user.name=Lob Agent Controller', '-c', 'user.email=lob-agent@users.noreply.github.com', 'commit', '-m', commitBody]);
      await validateDiff();
    }
    const candidate = shaSchema.parse(await git(['rev-parse', 'HEAD']));
    if (authFile) {
      secrets.push(...Object.values(validateSubscription(await readJson(authFile)).tokens));
      auth = 'write-back-failed';
      await persistSubscription({ file: authFile, eas, cwd: options.cwd, env: options.env, timeoutMs: options.limits?.authMs ?? 60_000 });
      auth = 'persisted';
    }
    const currentIssue = await preflight({ env: { ...options.env, AGENT_TASK: 'change', AGENT_ISSUE_DIGEST: issue.identity.sha256,
      AGENT_CRITERIA_SHA256: issue.criteria.sha256 }, cwd: options.cwd, apiBase: options.githubApiBase });
    if (currentIssue.issue?.identity.sha256 !== issue.identity.sha256) throw new ChangeConflict('Issue input moved before publication.');
    if (await remoteHead(source.ref) !== source.sha || await remoteHead(branch) !== existing) throw new ChangeConflict('A target or issue branch moved before publication. No write was made.');
    await publishFile({ directory, name: 'checks.json', bytes: JSON.stringify({ paths, candidate, typecheck: 'passed', tests: 'passed', acceptance }, null, 2) });
    await github.pullRequest({ acceptance, branch, candidate, create: false });
    await ensureFrozenTarget();
    if (!existing) {
      try { await git(['push', 'origin', `HEAD:refs/heads/${branch}`]); }
      catch { throw new ChangeConflict('Non-force push failed. Reconcile the branch on retry before writing.'); }
    }
    if (await remoteHead(branch) !== candidate) throw new ChangeConflict('Issue branch differs after push. No PR write is safe.');
    await ensureFrozenTarget();
    const pr = await github.pullRequest({ acceptance, branch, candidate });
    if (!pr) throw new Error('No PR receipt.');
    await publishFile({ directory, name: 'publication.json', bytes: JSON.stringify(pr, null, 2) });
    await ensureFrozenTarget();
    ready = { candidate, branch, prUrl: pr.url };
  } catch (error) {
    if (error instanceof ForbiddenChange) state = 'REJECTED';
    else if (error instanceof ChangeConflict || error instanceof PublicationConflict) state = 'CONFLICT';
    reason = error instanceof z.ZodError ? 'Coding input or verdict failed strict schema validation.'
      : sanitize(error instanceof Error ? error.message : 'Coding controller failed.', secrets);
  } finally {
    if (authFile) {
      try {
        secrets.push(...Object.values(validateSubscription(await readJson(authFile)).tokens));
        await persistSubscription({ file: authFile, eas, cwd: options.cwd, env: options.env, timeoutMs: options.limits?.authMs ?? 60_000 });
        auth = 'persisted';
      } catch { auth = 'write-back-failed'; }
    }
    try { await rm(privateDirectory, { recursive: true, force: true }); }
    catch { ready = null; reason = 'Private coding directory cleanup failed.'; state = 'INCONCLUSIVE'; }
  }
  if (auth === 'write-back-failed') { ready = null; state = 'INCONCLUSIVE'; reason = 'Refreshed subscription credentials were not persisted. Reseed before retrying.'; }
  const base = { version: 1, attemptId, runId: options.env.AGENT_RUN_ID ?? 'local', runUrl: options.env.AGENT_RUN_URL ?? null, source,
    issue: issue?.identity ?? null, termination, auth };
  const result = changeResultSchema.parse(ready ? { ...base, ...ready, state: 'PR_READY', checks: 'typecheck-and-tests-passed' }
    : { ...base, state, reason: reason || 'No verified coding outcome.' });
  await publishFile({ directory, name: 'result.json', bytes: JSON.stringify(result, null, 2) });
  await publishFile({ directory, name: 'report.md', bytes: `# Lob Issue to PR\n\n${result.state}\n\n${result.state === 'PR_READY' ? `PR ${result.prUrl}. Candidate ${result.candidate}. Original device acceptance is pending.` : result.reason}\n\nSubscription ${result.auth}.\n` });
  return result;
}
