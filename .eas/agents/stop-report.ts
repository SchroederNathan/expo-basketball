import { plain } from './evidence';

// The PR report for a run that stopped in preflight, before any device work.
// Known preflight errors map to a fixed explanation. Anything else gets a
// generic one, so no raw error text reaches the PR.
const explanations: readonly (readonly [string, string])[] = [
  ['PR target branch lacks the audited workflow baseline.',
    "This PR's target branch does not contain the reviewed agent workflows, so the check did not run. Agentic CI runs on PRs that target `release/prizepicks-demo`."],
  ['Audited workflow baseline is absent or modified.',
    'This PR does not contain the reviewed agent workflows, or it changes them or the demo fixture. Merge its target branch into it, and keep agent and fixture changes in a reviewed baseline.'],
  ['PR source/ref disagreement.', 'The PR head moved while the run started. A newer run checks the latest commit.'],
  ['Requested branch/source disagreement.', 'The branch moved while the run started. A newer run checks the latest commit.'],
  ['Workflow checkout differs from the candidate. Dispatch at the exact SHA.', 'The checked-out source differs from the PR head, so the check did not run.'],
  ['Enable trusted automation for this exact repository before dispatch.', 'Trusted automation is not enabled for this repository in the EAS preview environment.'],
];

export function stopReport(message: string, env: NodeJS.ProcessEnv) {
  const explanation = explanations.find(([known]) => message.includes(known))?.[1]
    ?? 'The source or setup checks did not pass, so the check did not run. Open the workflow for details.';
  const sha = /^[a-f0-9]{40}$/.test(env.AGENT_SOURCE_SHA ?? '') ? env.AGENT_SOURCE_SHA! : null;
  const repository = /^[\w.-]+\/[\w.-]+$/.test(env.AGENT_REPOSITORY ?? '') ? env.AGENT_REPOSITORY! : null;
  const run = /^https:\/\/expo\.dev\/accounts\/exponathan\/projects\/expo-basketball\/workflows\/[a-f0-9-]{36}$/.test(env.AGENT_RUN_URL ?? '') ? env.AGENT_RUN_URL! : null;
  const source = [sha && repository ? `[\`${sha.slice(0, 7)}\`](https://github.com/${repository}/commit/${sha})${env.AGENT_SOURCE_REF ? ` on ${plain(env.AGENT_SOURCE_REF)}` : ''}` : null,
    run ? `[Workflow](${run})` : null].filter(Boolean).join(' · ');
  return [`### ⚪ Agentic CI iOS: not run`, ...(source ? [source] : []), '', `**${explanation}**`].join('\n');
}
