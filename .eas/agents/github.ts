import { z } from 'zod';
import { acceptanceMarker, type Acceptance } from './issue';
import { shaSchema } from './result';

const userSchema = z.object({ id: z.number().int().positive() });
export const commentSchema = z.object({ id: z.number().int().positive(), body: z.string(), body_html: z.string().optional(), html_url: z.url(), user: userSchema });
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
  private async request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.options.apiBase ?? 'https://api.github.com'}${path}`, {
      method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.full+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`GitHub controller request failed with status ${response.status}. Rerun to reconcile before writing.`);
    return response.json();
  }
  get = (path: string, signal?: AbortSignal) => this.request(`/repos/${this.options.repository}${path}`, 'GET', undefined, signal);
  private async pages(path: string, signal?: AbortSignal): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = z.array(z.unknown()).parse(await this.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, signal));
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error('GitHub reconciliation exceeded its bounded page limit. No write is safe.');
  }
  async writer(signal?: AbortSignal) {
    const me = userSchema.parse(await this.request('/user', 'GET', undefined, signal));
    const repository = z.object({ full_name: z.string(), private: z.literal(false), permissions: z.object({ push: z.literal(true) }) }).parse(await this.get('', signal));
    if (repository.full_name !== this.options.repository) throw new PublicationConflict('Writer repository mismatch.');
    return me.id;
  }
  async comments(issue: number, signal?: AbortSignal) { return z.array(commentSchema).parse(await this.pages(`/issues/${issue}/comments`, signal)); }
  async exactComment(id: number, signal?: AbortSignal) { return commentSchema.parse(await this.get(`/issues/comments/${id}`, signal)); }
  async patchComment(id: number, body: string, actor: number, expectedBody: string, signal?: AbortSignal, beforeWrite?: () => Promise<void>) {
    if (body.length > 30_000) throw new Error('Controller comment exceeds its bounded size.');
    const before = await this.exactComment(id, signal);
    if (before.user.id !== actor || before.body !== expectedBody) throw new PublicationConflict('Exact comment ownership or content conflict.');
    await beforeWrite?.();
    signal?.throwIfAborted();
    const written = commentSchema.parse(await this.request(`/repos/${this.options.repository}/issues/comments/${id}`, 'PATCH', { body }, signal));
    if (written.id !== id || written.user.id !== actor || written.body !== body) throw new PublicationConflict('Exact comment write receipt mismatch.');
    return written;
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
