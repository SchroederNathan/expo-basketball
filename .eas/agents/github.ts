import { join } from 'node:path';
import { z } from 'zod';
import { acceptanceFor, acceptanceMarker, changeBranch, freezeIssue, type Acceptance } from './issue';
import { publishFile, resultSchema, shaSchema, type Result } from './result';

const userSchema = z.object({ id: z.number().int().positive() });
const commentSchema = z.object({ id: z.number().int().positive(), body: z.string(), html_url: z.url(), user: userSchema });
const prSchema = z.object({ number: z.number().int().positive(), html_url: z.url(), body: z.string().nullable(),
  state: z.enum(['open', 'closed']), head: z.object({ ref: z.string(), sha: shaSchema, repo: z.object({ full_name: z.string() }) }),
  base: z.object({ ref: z.string(), sha: shaSchema, repo: z.object({ full_name: z.string() }) }) });

export class PublicationConflict extends Error {}

export class GitHub {
  private readonly token: string;
  constructor(private readonly options: { repository: string; env: NodeJS.ProcessEnv; apiBase?: string }) {
    if (!options.env.AGENT_GITHUB_WRITE_TOKEN) throw new Error('AGENT_GITHUB_WRITE_TOKEN is required for controller publication.');
    this.token = options.env.AGENT_GITHUB_WRITE_TOKEN;
    if (options.env.AGENT_TRUSTED_AUTOMATION !== 'enabled' || options.env.AGENT_TRUSTED_REPOSITORY !== options.repository) {
      throw new Error('GitHub writes require the exact trusted repository.');
    }
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.options.apiBase ?? 'https://api.github.com'}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`GitHub controller request failed with status ${response.status}. Rerun to reconcile before writing.`);
    return response.json();
  }
  get = (path: string) => this.request(`/repos/${this.options.repository}${path}`);
  private async pages(path: string): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = z.array(z.unknown()).parse(await this.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error('GitHub reconciliation exceeded its bounded page limit. No write is safe.');
  }
  async comment({ issue, marker, text }: { issue: number; marker: string; text: string }) {
    const me = userSchema.parse(await this.request('/user'));
    const comments = z.array(commentSchema).parse(await this.pages(`/issues/${issue}/comments`));
    const found = comments.filter((comment) => comment.body.startsWith(`${marker}\n`));
    if (found.length > 1 || found.some((comment) => comment.user.id !== me.id)) throw new PublicationConflict('Issue comment marker ownership conflict.');
    const body = `${marker}\n${text}`;
    if (body.length > 30_000) throw new Error('Controller comment exceeds its bounded size.');
    const existing = found[0];
    if (existing?.body === body) return { kind: 'reused', url: existing.html_url };
    const written = commentSchema.parse(await this.request(`/repos/${this.options.repository}${existing ? `/issues/comments/${existing.id}` : `/issues/${issue}/comments`}`,
      existing ? 'PATCH' : 'POST', { body }));
    if (written.body !== body || written.user.id !== me.id) throw new Error('Comment write receipt mismatch.');
    return { kind: existing ? 'updated' : 'created', url: written.html_url };
  }
  async pullRequest({ acceptance, branch, candidate, create = true }: { acceptance: Acceptance; branch: string; candidate: string; create?: boolean }) {
    const repository = this.options.repository;
    const head = `${repository.split('/')[0]}:${branch}`;
    const prs = z.array(prSchema).parse(await this.pages(`/pulls?state=all&head=${encodeURIComponent(head)}`));
    const marker = acceptanceMarker(acceptance);
    if (prs.length > 1) throw new PublicationConflict('Multiple PRs already use the issue branch. No write is safe.');
    const existing = prs[0];
    const valid = (pr: z.infer<typeof prSchema>) => pr.state === 'open' && pr.head.ref === branch && pr.head.sha === candidate &&
      pr.head.repo.full_name === repository && pr.base.repo.full_name === repository && pr.base.ref === acceptance.target.ref &&
      pr.base.sha === acceptance.target.sha && pr.body?.startsWith(`${marker}\n`);
    if (existing) {
      if (!valid(existing)) throw new PublicationConflict('Existing PR conflicts with the frozen issue candidate or target.');
      return { kind: 'reused', url: existing.html_url, number: existing.number };
    }
    if (!create) return null;
    const body = `${marker}\n\nRepair demo issue #${acceptance.issue.number}.\n\nOriginal criteria: demo/issues/player-label.md at ${acceptance.target.sha}, SHA-256 ${acceptance.criteriaSha256}.\nIssue input SHA-256 ${acceptance.issue.sha256}.\nCandidate ${candidate}. Target ${acceptance.target.ref} at ${acceptance.target.sha}.\n\nController typecheck and application tests passed. Native issue acceptance remains pending downstream Agentic CI. No merge or deployment is authorized.`;
    const pr = prSchema.parse(await this.request(`/repos/${repository}/pulls`, 'POST', {
      title: `Fix Jordan Vale stat labels for demo issue #${acceptance.issue.number}`, head: branch, base: acceptance.target.ref, body,
    }));
    if (pr.base.sha !== acceptance.target.sha) throw new PublicationConflict(`Created PR target differs from the frozen SHA. Preserve and reconcile ${pr.html_url}.`);
    if (!valid(pr)) throw new Error('PR write receipt mismatch.');
    return { kind: 'created', url: pr.html_url, number: pr.number };
  }
}

export async function publishTriage({ result: input, env, cwd, outputRoot, apiBase }: {
  result: Result; env: NodeJS.ProcessEnv; cwd: string; outputRoot: string; apiBase?: string;
}) {
  const result = resultSchema.parse(input);
  if (!result.target || result.target.kind !== 'triage' || !result.target.issue) throw new Error('No validated triage target to publish.');
  const target = result.target;
  const issueIdentity = result.target.issue;
  const github = new GitHub({ repository: target.repository, env, apiBase });
  const issue = await freezeIssue({ env: { ...env, AGENT_REPOSITORY: target.repository, AGENT_ISSUE_NUMBER: String(issueIdentity.number),
    AGENT_ISSUE_DIGEST: issueIdentity.sha256, AGENT_CRITERIA_SHA256: target.criteria.sha256 }, cwd, get: github.get });
  const acceptance = acceptanceFor({ issue, target: target.source, repository: target.repository });
  const marker = `<!-- lob-agent:triage:${changeBranch(issue, target.source)} -->`;
  const text = [`Triage ${result.state} for issue #${issue.identity.number}.`,
    `Source ${target.source.ref} at ${target.source.sha}. Build ${target.native.installed}.`,
    `Issue input SHA-256 ${acceptance.issue.sha256}. Original criteria SHA-256 ${acceptance.criteriaSha256}.`,
    `Fixture SHA-256 ${target.fixture.sha256}. Cleanup ${result.cleanup.state}. Subscription ${result.auth}.`,
    result.runUrl ? `[Workflow evidence and report](${result.runUrl}) in attempt ${result.attemptId}.` : 'No cloud artifact link was provided.',
    result.session ? `[Owned simulator session](${result.session.url}).` : 'No simulator session was established.',
    ...(result.state === 'INCONCLUSIVE' ? [`No definitive reproduction verdict. ${result.reason}`] : [
      ...result.evidence.screenshots.map((file) => `Screenshot ${file.path}, SHA-256 ${file.sha256}.`),
      `Recording ${result.evidence.recording.path}, SHA-256 ${result.evidence.recording.sha256}.`,
      `Observed identity ${result.evidence.identity.path}, SHA-256 ${result.evidence.identity.sha256}.`,
    ]),
    'This result is bounded to the selected artifact and frozen criteria. The controller does not close or relabel the issue.',
  ].join('\n\n');
  if (!result.runUrl) throw new Error('A cloud evidence link is required before GitHub publication.');
  const receipt = await github.comment({ issue: issue.identity.number, marker, text });
  await publishFile({ directory: join(outputRoot, 'public', result.attemptId), name: 'publication.json', bytes: JSON.stringify(receipt, null, 2) });
  return receipt;
}
