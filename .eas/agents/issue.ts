import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { allCriteriaPaths, demoIssueKey, demoIssues, demoMarker, hasDemoMarker, openCriteriaPath, openCriteriaText } from './demo-issues';
import { generatedTestPattern } from './generated-test';
import { digest, digestSchema, issueRefSchema, sourceSchema, type Source } from './result';

export const criteriaPath = demoIssues['player-label'].criteria;
export const demoIssueMarker = demoMarker('player-label');

const issueInputSchema = z.object({
  id: z.number().int().positive(), node_id: z.string().min(1), number: z.number().int().positive(),
  state: z.literal('open'), title: z.string().min(1).max(500), body: z.string().min(1).max(20_000),
  updated_at: z.iso.datetime(), html_url: z.url(),
  author_association: z.enum(['OWNER', 'MEMBER', 'COLLABORATOR']),
  pull_request: z.unknown().optional(),
});
export const issueSnapshotSchema = z.strictObject({
  identity: issueRefSchema,
  input: issueInputSchema.omit({ pull_request: true }),
  criteria: z.strictObject({ path: z.enum(allCriteriaPaths), sha256: digestSchema, text: z.string().min(1) }),
});
export type IssueSnapshot = z.infer<typeof issueSnapshotSchema>;
export const frozenTestSchema = z.strictObject({ path: z.string().regex(generatedTestPattern), sha256: digestSchema });
export const acceptanceSchema = z.strictObject({
  version: z.literal(1), repository: z.string(), target: sourceSchema,
  issue: issueRefSchema, criteriaSha256: digestSchema,
  // Only an open issue carries a test. A demo issue uses its pinned registry test.
  test: frozenTestSchema.optional(),
});
export type Acceptance = z.infer<typeof acceptanceSchema>;
const receiptPrefix = '<!-- lob-agent-acceptance:v1 ';

export function acceptanceMarker(receipt: Acceptance) {
  return `${receiptPrefix}${Buffer.from(JSON.stringify(acceptanceSchema.parse(receipt))).toString('base64url')} -->`;
}
export function readAcceptance(body: string): Acceptance | null {
  const matches = [...body.matchAll(/<!-- lob-agent-acceptance:v1 ([A-Za-z0-9_-]+) -->/g)];
  if (!body.includes(receiptPrefix)) return null;
  if (matches.length !== 1 || matches[0]?.[1] === undefined) throw new Error('Invalid or duplicate acceptance receipt.');
  return acceptanceSchema.parse(JSON.parse(Buffer.from(matches[0][1], 'base64url').toString('utf8')));
}
export function changeBranch(issue: IssueSnapshot, target: Source) {
  return `agent/issue-${issue.identity.number}-${digest(target.ref).slice(0, 12)}`;
}
export function acceptanceFor({ issue, target, repository, test }: {
  issue: IssueSnapshot; target: Source; repository: string; test?: z.infer<typeof frozenTestSchema>;
}): Acceptance {
  if ((issue.criteria.path === openCriteriaPath) !== Boolean(test)) throw new Error('Only an open issue carries a generated acceptance test.');
  return { version: 1, repository, target, issue: issue.identity, criteriaSha256: issue.criteria.sha256, ...(test ? { test } : {}) };
}

export function issueDigest(input: z.infer<typeof issueInputSchema>) {
  // Comment activity changes updated_at without changing the reported issue.
  const { updated_at: _, pull_request: __, ...content } = input;
  return digest(JSON.stringify(content));
}

export async function freezeIssue({ env, cwd, get, expected }: {
  env: NodeJS.ProcessEnv; cwd: string; get: (path: string) => Promise<unknown>;
  expected?: Acceptance;
}): Promise<IssueSnapshot> {
  const number = z.coerce.number().int().positive().parse(env.AGENT_ISSUE_NUMBER || expected?.issue.number);
  if (expected && expected.issue.number !== number) throw new Error('Issue number differs from the frozen acceptance receipt.');
  const raw = issueInputSchema.parse(await get(`/issues/${number}`));
  // A marker names a pinned demo issue. An issue with no marker is an open issue.
  // An unknown marker is still rejected, so a typo never falls back to open mode.
  const key = demoIssueKey(raw.body);
  if (raw.pull_request !== undefined || raw.number !== number ||
    raw.html_url !== `https://github.com/${env.AGENT_REPOSITORY}/issues/${number}` ||
    (key === null && hasDemoMarker(raw.body))) throw new Error('Unknown demo issue or mismatched issue identity.');
  const { pull_request: _, ...input } = raw;
  const identity = issueRefSchema.parse({ number, id: raw.id, nodeId: raw.node_id, sha256: issueDigest(input) });
  let criteria: { path: (typeof allCriteriaPaths)[number]; text: string; sha256: string };
  if (key) {
    const entry = demoIssues[key];
    const text = await readFile(join(cwd, entry.criteria), 'utf8');
    criteria = { path: entry.criteria, text, sha256: digest(text) };
    if (criteria.sha256 !== entry.criteriaSha256) throw new Error('Issue input or original acceptance criteria changed. Dispatch a newly reviewed input.');
  } else {
    const text = openCriteriaText(raw);
    criteria = { path: openCriteriaPath, text, sha256: digest(text) };
  }
  if (expected && (criteria.path === openCriteriaPath) !== Boolean(expected.test)) {
    throw new Error('The acceptance receipt and the issue kind disagree.');
  }
  const wantedIssue = expected?.issue.sha256 ?? env.AGENT_ISSUE_DIGEST;
  const wantedCriteria = expected?.criteriaSha256 ?? env.AGENT_CRITERIA_SHA256;
  if ((wantedIssue && identity.sha256 !== wantedIssue) || (wantedCriteria && criteria.sha256 !== wantedCriteria)) {
    throw new Error('Issue input or original acceptance criteria changed. Dispatch a newly reviewed input.');
  }
  if (expected && (expected.repository !== env.AGENT_REPOSITORY || expected.issue.id !== identity.id || expected.issue.nodeId !== identity.nodeId)) {
    throw new Error('Acceptance receipt identifies another repository or issue.');
  }
  return issueSnapshotSchema.parse({ identity, input, criteria });
}
