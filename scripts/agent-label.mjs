import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const repository = 'SchroederNathan/expo-basketball';
export const defaultTargetRef = 'release/prizepicks-demo';
export const operations = Object.freeze({
  'issue-to-pr': Object.freeze({ label: 'agent', workflow: '.eas/workflows/issue-to-pr.yml' }),
  'bug-triage': Object.freeze({ label: 'agent-triage', workflow: '.eas/workflows/bug-triage.yml' }),
});
const marker = '<!-- lob-demo:player-label -->';
const shaPattern = /^[a-f0-9]{40}$/;
const actorPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/;
const trustedAuthors = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const writePermissions = new Set(['write', 'maintain', 'admin']);
const ignored = reason => ({ status: 'ignored', reason });
const spawnEas = (file, args, options) => {
  const result = spawnSync(file, args, options);
  return { status: result.status, signal: result.signal, error: result.error };
};

function validBranch(ref) {
  return typeof ref === 'string' && ref.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) && !ref.includes('..') &&
    ref.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}

function issueNumber(value) {
  const text = String(value ?? '');
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

function validIssue(issue, number, label) {
  return issue?.number === number && Number.isSafeInteger(issue.id) && issue.id > 0 &&
    typeof issue.node_id === 'string' && issue.node_id.length > 0 && issue.state === 'open' &&
    !Object.hasOwn(issue, 'pull_request') && trustedAuthors.has(issue.author_association) &&
    issue.html_url === `https://github.com/${repository}/issues/${number}` &&
    issue.repository_url === `https://api.github.com/repos/${repository}` &&
    typeof issue.title === 'string' && issue.title.length > 0 && issue.title.length <= 500 &&
    typeof issue.body === 'string' && issue.body.length <= 20_000 && issue.body.includes(marker) &&
    (!label || (Array.isArray(issue.labels) && issue.labels.some(item => item?.name === label)));
}

export async function runBridge({
  env, event, dryRun = false, apiBase = 'https://api.github.com', fetchImpl = fetch, spawnImpl = spawnEas,
}) {
  if (env.GITHUB_REPOSITORY !== repository || event?.repository?.full_name !== repository ||
    event.repository.fork !== false || Object.hasOwn(event, 'pull_request') ||
    (event.issue && Object.hasOwn(event.issue, 'pull_request'))) return ignored('Untrusted repository or PR payload.');
  const defaultBranch = event.repository.default_branch;
  if (!validBranch(defaultBranch) || env.GITHUB_REF !== `refs/heads/${defaultBranch}` ||
    env.GITHUB_WORKFLOW_REF !== `${repository}/.github/workflows/agent-label.yml@refs/heads/${defaultBranch}` ||
    !shaPattern.test(env.GITHUB_SHA ?? '')) return ignored('Controller must run from the default branch.');
  const actor = env.GITHUB_ACTOR;
  const triggeringActor = env.GITHUB_TRIGGERING_ACTOR || actor;
  if (!actorPattern.test(actor ?? '') || !actorPattern.test(triggeringActor ?? '') ||
    event.sender?.login !== actor) return ignored('Invalid dispatch actor.');

  let operation;
  let number;
  let targetRef = env.AGENT_DEMO_TARGET_REF || defaultTargetRef;
  let label;
  if (env.GITHUB_EVENT_NAME === 'issues' && event.action === 'labeled') {
    operation = Object.keys(operations).find(key => operations[key].label === event.label?.name);
    label = event.label?.name;
    number = issueNumber(event.issue?.number);
  } else if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const inputs = event.inputs;
    if (!inputs || Object.keys(inputs).some(key => !['operation', 'issue_number', 'target_ref'].includes(key)) ||
      (inputs.target_ref !== undefined && typeof inputs.target_ref !== 'string')) return ignored('Invalid manual inputs.');
    operation = inputs.operation;
    number = issueNumber(inputs.issue_number);
    targetRef = inputs.target_ref || targetRef;
  } else return ignored('Unsupported event.');
  if (typeof operation !== 'string' || !Object.hasOwn(operations, operation) || number === null ||
    !validBranch(targetRef)) return ignored('Unsupported operation, issue number, or target branch.');
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required for GitHub API reads.');

  const get = async path => {
    let response;
    try {
      response = await fetchImpl(`${apiBase}/repos/${repository}${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new Error('GitHub verification request failed.');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub verification failed with HTTP ${response.status}.`);
    try { return await response.json(); }
    catch { throw new Error('GitHub verification returned invalid JSON.'); }
  };

  const currentRepository = await get('');
  if (currentRepository?.full_name !== repository || currentRepository.fork !== false ||
    currentRepository.default_branch !== defaultBranch || !Number.isSafeInteger(currentRepository.id) ||
    currentRepository.id <= 0 || currentRepository.id !== event.repository.id) {
    return ignored('Repository identity or default branch changed.');
  }
  for (const login of new Set([actor, triggeringActor])) {
    const permission = await get(`/collaborators/${encodeURIComponent(login)}/permission`);
    if (permission?.user?.login?.toLowerCase() !== login.toLowerCase() ||
      !writePermissions.has(permission?.permission)) return ignored('Actor lacks repository write permission.');
  }
  const issue = await get(`/issues/${number}`);
  if (!validIssue(issue, number, label)) return ignored('Issue is not an open trusted demo issue with the requested label.');
  const refPath = `/git/ref/heads/${targetRef.split('/').map(encodeURIComponent).join('/')}`;
  const resolve = async () => {
    const ref = await get(refPath);
    return ref?.ref === `refs/heads/${targetRef}` && ref.object?.type === 'commit' &&
      shaPattern.test(ref.object?.sha ?? '') ? ref.object.sha : null;
  };
  const candidateSha = await resolve();
  if (!candidateSha) return ignored('Target branch does not resolve to an exact commit.');
  if (await resolve() !== candidateSha) return ignored('Target branch moved during verification.');

  const plan = { repository, operation, workflow: operations[operation].workflow, targetRef, candidateSha, issueNumber: number };
  if (dryRun) return { status: 'dry-run', ...plan };
  if (!env.EXPO_AGENT_TOKEN) throw new Error('EXPO_AGENT_TOKEN is required to dispatch EAS.');
  const childEnv = { CI: '1', EXPO_NO_DOTENV: '1', EXPO_TOKEN: env.EXPO_AGENT_TOKEN };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'BUN_INSTALL', 'XDG_CACHE_HOME']) {
    if (env[key]) childEnv[key] = env[key];
  }
  const args = [
    'eas-cli@25.3.0', 'workflow:run', plan.workflow, '--ref', candidateSha,
    '-F', `repository=${repository}`, '-F', `target_ref=${targetRef}`,
    '-F', `candidate_sha=${candidateSha}`, '-F', `issue_number=${number}`,
    '--non-interactive', '--no-wait', '--json',
  ];
  let dispatched;
  try {
    dispatched = spawnImpl('bunx', args, {
      cwd: env.GITHUB_WORKSPACE || process.cwd(), env: childEnv, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error('EAS dispatch failed. Acceptance is unknown. Inspect EAS before retrying.');
  }
  if (dispatched.error || dispatched.signal || dispatched.status !== 0) {
    throw new Error('EAS dispatch failed. Acceptance is unknown. Inspect EAS before retrying.');
  }
  return { status: 'dispatched', ...plan };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported.');
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is required.');
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await runBridge({ env: process.env, event, dryRun: process.argv.includes('--dry-run') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'failed', reason: error instanceof Error ? error.message : 'Bridge failed.' })}\n`);
    process.exitCode = 1;
  }
}
