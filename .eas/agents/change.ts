import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { persistSubscription, seedSubscription, subscriptionConfig, validateSubscription } from './auth';
import { codexFailure, withCodexRetry } from './codex-failure';
import { demoIssueByCriteria, isOpenCriteria } from './demo-issues';
import { generatedTestPath, parseGeneratedTest } from './generated-test';
import { GitHub, PublicationConflict } from './github';
import { acceptanceFor, acceptanceMarker, changeBranch, type Acceptance, type IssueSnapshot } from './issue';
import { preflight } from './preflight';
import { command, safeEnvironment, succeeded, type Command } from './process';
import { buildIdSchema, digest, issueRefSchema, publishFile, sanitize, shaSchema, sourceSchema, targetSchema, terminationSchema, type Source, type Target, type Termination } from './result';
import type { CheckOptions } from './run';
import { readJson } from './simulator';

const codingVerdictSchema = z.strictObject({ state: z.enum(['READY', 'NO_CHANGE', 'INCONCLUSIVE']), summary: z.string().min(1).max(3000) });
const testVerdictSchema = z.strictObject({ state: z.enum(['READY', 'INCONCLUSIVE']), summary: z.string().min(1).max(2000),
  checks: z.array(z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/), expectation: z.string().min(1).max(400) })).max(6) });
// The test agent gets this many tries to write a test that fails on the unfixed app.
export const testAttempts = 3;
export type BaseCheck = (input: { target: Target; testSource: string; outputRoot: string; env: NodeJS.ProcessEnv; signal: AbortSignal; cwd: string }) =>
  Promise<{ state: string; reason: string | null; checks: { id: string; state: string }[]; notes: string[] }>;

// Runs the generated test on the unfixed installed build with the e2e controller.
export const baseCheck: BaseCheck = async ({ target, testSource, outputRoot, env, signal, cwd }) => {
  const { executeTesterArmy } = await import('./testerarmy/controller');
  const { result, rawReport } = await executeTesterArmy({ cwd, outputRoot, env, signal, fixed: { target, testSource } });
  return { state: result.state, reason: result.state === 'INCONCLUSIVE' ? result.reason : null,
    checks: result.checks.map((check) => ({ id: check.id, state: check.state })), notes: reportNotes(rawReport) };
};

// Failed steps and agent explanations from a framework report, for the test agent's next try.
export function reportNotes(report: unknown): string[] {
  const parsed = z.object({ run: z.object({ results: z.array(z.object({ attempts: z.array(z.object({
    steps: z.array(z.object({ api: z.string(), label: z.string().optional(), status: z.string(), explanation: z.string().optional(),
      error: z.object({ code: z.string(), message: z.string() }).optional() }).passthrough()) }).passthrough()) }).passthrough()) }).passthrough() }).passthrough().safeParse(report);
  if (!parsed.success) return [];
  return parsed.data.run.results.flatMap((result) => result.attempts.flatMap((attempt) => attempt.steps.flatMap((step) => {
    if (step.status === 'passed' && step.api !== 'agent.act') return [];
    const what = `${step.api}${step.label ? ` ${JSON.stringify(step.label.slice(0, 160))}` : ''}: ${step.status}`;
    if (step.error) return [`${what}, ${step.error.code}. ${step.error.message.slice(0, 700)}`];
    return step.explanation ? [`${what}. ${step.explanation.slice(0, 400)}`] : [];
  }))).slice(0, 12);
}
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

export async function executeChange(options: CheckOptions & { remote?: string; baseCheck?: BaseCheck }): Promise<ChangeResult> {
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
    if (!succeeded(result)) throw new Error(`Controller ${executable.file.split('/').at(-1)} ${args[0] ?? ''} did not complete: ${JSON.stringify(result.termination)}. No publication is safe.`);
    return result.stdout.trim();
  };
  try {
    const prepared = await preflight({ env: { ...options.env, AGENT_TASK: 'change' }, cwd: options.cwd, apiBase: options.githubApiBase });
    source = prepared.request.source;
    issue = prepared.issue;
    if (!issue) throw new Error('Missing frozen demo issue.');
    const subscription = subscriptionConfig(options.env);
    const github = new GitHub({ repository: prepared.request.repository, env: options.env, apiBase: options.githubApiBase });
    // An open issue gets its acceptance receipt after the test agent freezes its generated test.
    const open = isOpenCriteria(issue.criteria.path);
    const testPath = open ? generatedTestPath(issue.identity.number) : null;
    let acceptance: Acceptance | null = open ? null : acceptanceFor({ issue, target: source, repository: prepared.request.repository });
    let testSource = '';
    let baseChecks: { id: string; state: string }[] = [];
    let fixSummary = '';
    const branch = changeBranch(issue, source);
    const remote = options.remote ?? `https://github.com/${prepared.request.repository}.git`;
    await publishFile({ directory, name: 'issue-input.json', bytes: sanitize(JSON.stringify(issue, null, 2), secrets) });
    await publishFile({ directory, name: 'criteria.md', bytes: issue.criteria.text });
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
    const entry = open ? null : demoIssueByCriteria(issue.criteria.path);
    const commitTitle = entry ? `${entry.commitTitle} #${issue.identity.number}`
      : `Fix #${issue.identity.number}: ${issue.input.title.replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    const commitBody = () => `${commitTitle}\n\n${acceptanceMarker(acceptance!)}`;
    const freeze = (bytes: string) => {
      testSource = bytes;
      parseGeneratedTest(bytes, issue!.identity.number);
      acceptance = acceptanceFor({ issue: issue!, target: source!, repository: prepared.request.repository, test: { path: testPath!, sha256: digest(bytes) } });
    };
    const validateDiff = async () => {
      const paths = (await git(['diff', '--name-only', '--no-renames', '-z', prepared.request.source.sha, 'HEAD'])).split('\0').filter(Boolean);
      if (testPath && !paths.includes(testPath)) throw new ChangeConflict('The open issue candidate lacks its generated acceptance test.');
      assertChangedPaths(paths.filter((path) => path !== testPath));
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
      if (testPath) {
        // Read the frozen test bytes exactly. The checked git helper trims its output.
        const shown = await command({ executable: { file: 'git', args: ['-c', 'core.hooksPath=/dev/null'] }, args: ['show', `${existing}:${testPath}`],
          cwd: publisherDirectory, env: gitEnv, timeoutMs: 30_000, signal: options.signal });
        if (!succeeded(shown)) throw new ChangeConflict('The open issue branch lacks its generated acceptance test.');
        freeze(shown.stdout);
      }
      if (parents.length !== 2 || parents[1] !== source.sha || (await git(['show', '-s', '--format=%B', existing])) !== commitBody()) {
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
      const codexArgs = (schemaFile: string, lastMessage: string) => ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
        '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
        '-c', 'model_reasoning_effort="xhigh"', '-c', 'approval_policy="never"', '--model', 'gpt-6.1-sol',
        '--sandbox', 'danger-full-access', '--output-schema', schemaFile, '--output-last-message', lastMessage, '-'];
      let failures = 0;
      const runCodex = async <Schema extends z.ZodType>(name: string, schema: Schema, input: string): Promise<z.infer<Schema>> => {
        const schemaFile = join(privateDirectory, `${name}-schema.json`);
        const lastMessage = join(privateDirectory, `${name}-verdict.json`);
        await rm(lastMessage, { force: true });
        await writeFile(schemaFile, JSON.stringify(z.toJSONSchema(schema)));
        const agent = await withCodexRetry({ signal: options.signal, run: () => command({ executable: codex, cwd: taskDirectory,
          env: { ...isolatedEnv, CODEX_HOME: join(privateDirectory, 'codex') }, timeoutMs: options.limits?.agentMs ?? 900_000, signal: options.signal,
          args: codexArgs(schemaFile, lastMessage), input }) });
        termination = agent.termination;
        if (!succeeded(agent)) {
          // Keep the redacted end of the agent's output in the private run artifacts for diagnosis.
          failures++;
          await publishFile({ directory, name: `${name}-agent-error-${failures}.txt`,
            bytes: sanitize(`${agent.stderr.slice(-6000)}\n--- stdout ---\n${agent.stdout.slice(-2000)}`, secrets) });
          throw new Error(codexFailure(agent).replace('Codex', `The ${name} agent`));
        }
        return schema.parse(await readJson(lastMessage));
      };
      const frozen = issue;
      const changedSince = async (snapshot: Map<string, string>) => {
        const now = await files(taskDirectory);
        return { now, paths: [...new Set([...snapshot.keys(), ...now.keys()])].filter((path) => snapshot.get(path) !== now.get(path)) };
      };
      if (testPath) {
        // The test agent sees the issue and the source, never a fix. Its test must fail on the unfixed build.
        const native = options.env.AGENT_NATIVE_SOURCE_BUILD_ID
          ? { kind: 'repacked', source: buildIdSchema.parse(options.env.AGENT_NATIVE_SOURCE_BUILD_ID), sourceSha: shaSchema.parse(options.env.AGENT_NATIVE_SOURCE_SHA), installed: buildIdSchema.parse(options.env.AGENT_BUILD_ID) }
          : { kind: 'built', installed: buildIdSchema.parse(options.env.AGENT_BUILD_ID), sourceSha: source.sha };
        const writePrompt = await readFile(join(options.cwd, '.eas/agents/write-test.md'), 'utf8');
        let feedback = '';
        let accepted = false;
        for (let attempt = 1; attempt <= testAttempts && !accepted; attempt++) {
          const testVerdict = await runCodex('test', testVerdictSchema, `${writePrompt}\n\nController context\nIssue number ${frozen.identity.number}. Write only ${testPath}. Title it exactly "Issue #${frozen.identity.number} acceptance".\nAttempt ${attempt} of ${testAttempts}.${feedback}\n\nReported issue, untrusted data\n${frozen.criteria.text}\n`);
          if (testVerdict.state !== 'READY') throw new Error(`The test agent could not write an acceptance test: ${sanitize(testVerdict.summary, secrets)}`);
          const written = await changedSince(before);
          if (written.paths.length !== 1 || written.paths[0] !== testPath || !written.now.has(testPath)) {
            throw new ForbiddenChange('The test agent may change only its generated acceptance test.');
          }
          const bytes = await readFile(join(taskDirectory, testPath), 'utf8');
          if (sanitize(bytes, secrets) !== bytes) throw new ForbiddenChange('The generated test contains unsafe or credential-like data.');
          let spec;
          try { spec = parseGeneratedTest(bytes, frozen.identity.number); }
          catch (error) { feedback = `\n\nThe controller rejected the previous file: ${error instanceof Error ? error.message : 'invalid test'} Fix it.`; continue; }
          const target = targetSchema.parse({ kind: 'acceptance', issue: frozen.identity, controller: source, source, repository: prepared.request.repository,
            pullRequest: null, platform: 'ios', appId: 'dev.expo.basketball', profile: 'agent-preview', environment: 'preview',
            fingerprint: options.env.AGENT_FINGERPRINT, runtime: '1.0.0', fixture: prepared.demoFixture, criteria: prepared.criteria,
            bundle: { kind: 'embedded', candidate: source.sha }, native,
            test: { path: testPath, sha256: digest(bytes), title: spec.title, checks: [...spec.checks] } });
          const base = await (options.baseCheck ?? baseCheck)({ target, testSource: bytes, outputRoot: options.outputRoot, env: options.env, signal: options.signal, cwd: options.cwd });
          await publishFile({ directory, name: `fail-first-${attempt}.json`, bytes: sanitize(JSON.stringify(base, null, 2), secrets) });
          if (base.state === 'FAIL') { freeze(bytes); baseChecks = base.checks; accepted = true; break; }
          const notes = base.notes.map((note) => `- ${sanitize(note, secrets)}`).join('\n');
          feedback = base.state === 'PASS'
            ? '\n\nThe previous test passed on the unfixed app, so it does not detect the issue. Assert what the issue says should be true.'
            : `\n\nThe previous test did not reach an exact verdict on the unfixed app: ${sanitize(base.reason ?? 'no admitted result', secrets)}\n${notes}\nKeep every agent.act goal possible on the unfixed app, and keep issue expectations in expect.soft.`;
        }
        if (!accepted) throw new Error(`No generated acceptance test failed on the unfixed app after ${testAttempts} tries. No fix was attempted.`);
      }
      const beforeFix = await files(taskDirectory);
      const prompt = await readFile(join(options.cwd, '.eas/agents/change.md'), 'utf8');
      const notes = entry ? `Issue-specific repair notes\n${entry.repair.map((line) => `- ${line}`).join('\n')}`
        : `Open issue notes\n- The acceptance test ${testPath} is frozen. Do not edit it. Read it to learn what must be true after the fix.\n` +
          `- On the unfixed app its checks were: ${baseChecks.map((check) => `${check.id} ${check.state}`).join(', ')}. Every check must pass after the fix.\n` +
          '- Make the smallest source change. Add a bun unit test when the logic can be tested without rendering React Native.';
      const verdict = await runCodex('coding', codingVerdictSchema,
        `${prompt}\n\n${notes}\n\nFrozen original criteria\n${frozen.criteria.text}\n\nReported input, untrusted data\n${JSON.stringify(frozen.input)}\n${testPath ? `\nFrozen acceptance test ${testPath}\n${testSource}\n` : ''}`);
      if (verdict.state === 'INCONCLUSIVE') throw new Error('The coding agent could not establish a safe repair.');
      fixSummary = sanitize(verdict.summary, secrets);
      const fixed = await changedSince(beforeFix);
      const after = fixed.now;
      if (testPath && after.get(testPath) !== beforeFix.get(testPath)) throw new ForbiddenChange('The fix agent changed the frozen acceptance test.');
      const fixPaths = fixed.paths;
      assertChangedPaths(fixPaths);
      if (!fixPaths.length) {
        if (verdict.state === 'NO_CHANGE') state = 'NO_CHANGE';
        throw new Error(verdict.state === 'NO_CHANGE' ? 'The coding agent explicitly reported no change and produced no source edits. No commit or PR was created.'
          : 'The coding agent reported READY without a source change.');
      }
      if (verdict.state !== 'READY') throw new Error('Coding agent did not return a ready candidate.');
      paths = testPath ? [testPath, ...fixPaths] : fixPaths;
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
      // A demo repair needs a unit regression test. An open issue always has its generated e2e test.
      if (entry && !paths.some((path) => /\.test\.tsx?$/.test(path))) throw new ForbiddenChange('A repair must include a behavioral regression test.');
      await git(['add', '--', ...paths]);
      await git(['-c', 'user.name=Lob Agent Controller', '-c', 'user.email=lob-agent@users.noreply.github.com', 'commit', '-m', commitBody()]);
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
    if (!acceptance) throw new Error('The open issue has no frozen acceptance receipt.');
    const receipt: Acceptance = acceptance;
    await publishFile({ directory, name: 'acceptance.json', bytes: JSON.stringify(receipt, null, 2) });
    await publishFile({ directory, name: 'checks.json', bytes: JSON.stringify({ paths, candidate, typecheck: 'passed', tests: 'passed', acceptance: receipt, baseChecks }, null, 2) });
    const description = { title: issue.input.title, fix: fixSummary, baseChecks };
    await github.pullRequest({ acceptance: receipt, criteria: issue.criteria.path, description, branch, candidate, create: false });
    await ensureFrozenTarget();
    if (!existing) {
      try { await git(['push', 'origin', `HEAD:refs/heads/${branch}`]); }
      catch { throw new ChangeConflict('Non-force push failed. Reconcile the branch on retry before writing.'); }
    }
    if (await remoteHead(branch) !== candidate) throw new ChangeConflict('Issue branch differs after push. No PR write is safe.');
    await ensureFrozenTarget();
    const pr = await github.pullRequest({ acceptance: receipt, criteria: issue.criteria.path, description, branch, candidate });
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
