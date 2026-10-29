import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { digest, digestSchema, issueRefSchema, sourceSchema, type Source } from './result';

export const criteriaPath = 'demo/issues/player-label.md';
export const demoIssueMarker = '<!-- lob-demo:player-label -->';
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
  criteria: z.strictObject({ path: z.literal(criteriaPath), sha256: digestSchema, text: z.string().min(1) }),
});
export type IssueSnapshot = z.infer<typeof issueSnapshotSchema>;
export const acceptanceSchema = z.strictObject({
  version: z.literal(1), repository: z.string(), target: sourceSchema,
  issue: issueRefSchema, criteriaSha256: digestSchema,
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
export function acceptanceFor({ issue, target, repository }: { issue: IssueSnapshot; target: Source; repository: string }): Acceptance {
  return { version: 1, repository, target, issue: issue.identity, criteriaSha256: issue.criteria.sha256 };
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
  if (raw.pull_request !== undefined || raw.number !== number ||
    raw.html_url !== `https://github.com/${env.AGENT_REPOSITORY}/issues/${number}` ||
    !raw.body.includes(demoIssueMarker)) throw new Error('Unknown demo issue or mismatched issue identity.');
  const { pull_request: _, ...input } = raw;
  const identity = issueRefSchema.parse({ number, id: raw.id, nodeId: raw.node_id, sha256: issueDigest(input) });
  const text = await readFile(join(cwd, criteriaPath), 'utf8');
  const criteria = { path: criteriaPath, text, sha256: digest(text) };
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
