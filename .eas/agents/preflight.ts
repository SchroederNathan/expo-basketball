import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import fixture from '../../demo/fixtures/prizepicks-v1.json';
import { command, succeeded } from './process';
import { freezeIssue, readAcceptance, type Acceptance } from './issue';
import { digest, fixtureSchema, shaSchema, sourceSchema } from './result';

const requestSchema = z.strictObject({
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  source: sourceSchema, baseline: shaSchema,
  pullRequest: z.number().int().positive().nullable(),
});
export type Request = z.infer<typeof requestSchema>;
const repoSchema = z.object({ full_name: z.string(), private: z.boolean() });
const commitSchema = z.object({ sha: shaSchema });
const branchSchema = z.object({ name: z.string(), commit: commitSchema });
const prSchema = z.object({
  body: z.string().nullable().optional(),
  state: z.literal('open'), draft: z.literal(false),
  author_association: z.enum(['OWNER', 'MEMBER', 'COLLABORATOR']),
  head: z.object({ sha: shaSchema, ref: z.string(), repo: repoSchema }),
  base: z.object({ sha: shaSchema, ref: z.string(), repo: repoSchema }),
});
const protectedFiles = ['.eas/agents', '.eas/workflows', '.github', 'eas.json', 'app.config.ts', 'fingerprint.config.cjs',
  'demo/fixtures', 'demo/issues', 'src/api/demo.ts', 'src/demo'];

export function requestFromEnvironment(env: NodeJS.ProcessEnv): Request {
  return requestSchema.parse({
    repository: env.AGENT_REPOSITORY,
    source: { ref: env.AGENT_SOURCE_REF, sha: env.AGENT_SOURCE_SHA },
    baseline: env.AGENT_WORKFLOW_BASELINE_SHA,
    pullRequest: env.AGENT_PR_NUMBER ? Number(env.AGENT_PR_NUMBER) : null,
  });
}

export async function preflight({ env, cwd, apiBase = 'https://api.github.com' }: {
  env: NodeJS.ProcessEnv; cwd: string; apiBase?: string;
}) {
  const request = requestFromEnvironment(env);
  let task = z.enum(['check', 'triage', 'change', 'acceptance']).parse(env.AGENT_TASK || 'check');
  let expected: Acceptance | undefined;
  if (env.AGENT_TRUSTED_REPOSITORY !== request.repository || env.AGENT_TRUSTED_AUTOMATION !== 'enabled') {
    throw new Error('Enable trusted automation for this exact repository before dispatch.');
  }
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${apiBase}/repos/${request.repository}${path}`, {
      headers: { ...(env.AGENT_GITHUB_READ_TOKEN ? { Authorization: `Bearer ${env.AGENT_GITHUB_READ_TOKEN}` } : {}),
        Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('GitHub source verification failed.');
    return response.json();
  };
  const repository = repoSchema.parse(await get(''));
  if (repository.full_name !== request.repository) throw new Error('Repository identity mismatch.');
  if (request.pullRequest !== null) {
    const pr = prSchema.parse(await get(`/pulls/${request.pullRequest}`));
    if (pr.head.repo.full_name !== request.repository || pr.base.repo.full_name !== request.repository ||
      pr.head.sha !== request.source.sha || pr.head.ref !== request.source.ref) throw new Error('PR source/ref disagreement.');
    const receipt = readAcceptance(pr.body ?? '');
    if (pr.head.ref.startsWith('agent/issue-') && !receipt) throw new Error('Issue candidate lacks its immutable acceptance receipt.');
    if (receipt) {
      if (receipt.target.ref !== pr.base.ref) throw new Error('PR base differs from original target.');
      task = 'acceptance';
      expected = receipt;
      const ancestry = await command({ executable: { file: 'git', args: [] }, args: ['merge-base', '--is-ancestor', receipt.target.sha, pr.head.sha], cwd, env, timeoutMs: 10_000 });
      if (!succeeded(ancestry)) throw new Error('Issue candidate lacks its frozen base ancestry.');
    }
    const base = await command({ executable: { file: 'git', args: [] }, args: ['merge-base', '--is-ancestor', request.baseline, pr.base.sha], cwd, env, timeoutMs: 10_000 });
    if (!succeeded(base)) throw new Error('PR target branch lacks the audited workflow baseline.');
  }
  const resolved = branchSchema.parse(await get(`/branches/${encodeURIComponent(request.source.ref)}`));
  if (resolved.name !== request.source.ref || resolved.commit.sha !== request.source.sha) throw new Error('Requested branch/source disagreement.');
  const git = async (args: string[]) => {
    const result = await command({ executable: { file: 'git', args: [] }, args, cwd, env, timeoutMs: 10_000 });
    if (!succeeded(result)) throw new Error('Audited workflow baseline is absent or modified.');
    return result.stdout.trim();
  };
  await git(['check-ref-format', `refs/heads/${request.source.ref}`]);
  const actualSha = shaSchema.parse(await git(['rev-parse', 'HEAD']));
  if (actualSha !== request.source.sha || (env.EAS_BUILD_GIT_COMMIT_HASH && env.EAS_BUILD_GIT_COMMIT_HASH !== actualSha)) {
    throw new Error('Workflow checkout differs from the candidate. Dispatch at the exact SHA.');
  }
  await git(['merge-base', '--is-ancestor', request.baseline, actualSha]);
  await git(['diff', '--exit-code', request.baseline, actualSha, '--', ...protectedFiles]);
  await git(['diff', '--exit-code', 'HEAD', '--', ...protectedFiles, 'src']);
  const demoFixture = fixtureSchema.parse({
    id: fixture.id, date: fixture.date, zone: fixture.zone,
    sha256: digest(await readFile(join(cwd, 'demo/fixtures/prizepicks-v1.json'))),
  });
  if (task === 'acceptance' && !expected && (!env.AGENT_ISSUE_DIGEST || !env.AGENT_CRITERIA_SHA256)) {
    throw new Error('Manual acceptance requires the frozen issue and criteria digests.');
  }
  const issue = task === 'check' ? null : await freezeIssue({ env, cwd, get, expected });
  const criteria = issue ? { path: issue.criteria.path, sha256: issue.criteria.sha256 }
    : { path: '.eas/agents/check-ios.md', sha256: digest(await readFile(join(cwd, '.eas/agents/check-ios.md'))) };
  return { request, demoFixture, criteria, issue, task };
}
