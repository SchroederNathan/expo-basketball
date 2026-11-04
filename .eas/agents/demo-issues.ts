// The trusted demo issues. Each issue body names one entry with its marker.
// An entry pins the original criteria bytes, the device checks, the e2e test,
// and the repair notes. Issue text never chooses any of these.
export const demoIssues = {
  'player-label': {
    criteria: 'demo/issues/player-label.md',
    criteriaSha256: 'bc07275e877ac808b8067c3dba4696b96a8a27a14408914d455e8d0747464145',
    devicePrompt: '.eas/agents/issue-ios.md',
    deviceChecks: ['historical-points', 'unknown-stat', 'current-player', 'search-back'],
    e2e: { file: 'tests/jordan.e2e.ts', title: 'Jordan original acceptance', checks: ['historical-points', 'unknown-stat', 'search-back', 'current-player'] },
    pullRequestTitle: 'Fix Jordan Vale stat labels',
    commitTitle: 'Repair Jordan Vale demo issue',
    repair: [
      'Reproduce the original Jordan label problem with a local failing behavioral test, then make the smallest source fix and preserve current player behavior.',
      'The existing seed assertion in src/api/demo.test.ts may become the repaired expectation in this candidate, with meaningful historical, unknown, and current-stat assertions.',
      'Add a regression test that observes the label and safe unknown-stat behavior, including unique keys where the rendering data chooses them.',
    ],
  },
  'scores-title': {
    criteria: 'demo/issues/scores-title.md',
    criteriaSha256: '96862b99ebe98524fb272d7caff941154a3332a4b80ddce0a3a4ff4656c253c6',
    devicePrompt: '.eas/agents/issue-scores-title-ios.md',
    deviceChecks: ['scores-title', 'other-day', 'today-scores'],
    e2e: { file: 'tests/scores-title.e2e.ts', title: 'Scores title acceptance', checks: ['scores-title', 'other-day', 'today-scores'] },
    pullRequestTitle: 'Show Scores as the Scores screen title',
    commitTitle: 'Repair the Scores title demo issue',
    repair: [
      'Make the Scores screen navigation title read Scores on every platform, for every selected date. Keep the date strip, the Today control, and the other header controls.',
      'Put the title choice in a small pure function or constant that a bun test can import without rendering React Native, and add a regression test for it.',
      'Remove helpers that the fix leaves unused. Keep date formatting that other screens still use.',
    ],
  },
} as const;

export type DemoIssueKey = keyof typeof demoIssues;
export type DemoIssue = (typeof demoIssues)[DemoIssueKey];
export const demoIssueKeys = Object.keys(demoIssues) as [DemoIssueKey, ...DemoIssueKey[]];
export const criteriaPaths = demoIssueKeys.map((key) => demoIssues[key].criteria) as [DemoIssue['criteria'], ...DemoIssue['criteria'][]];
export const demoMarker = (key: DemoIssueKey) => `<!-- lob-demo:${key} -->`;

// Exactly one known marker selects the issue. None, an unknown one, or two
// different ones reject the issue.
export function demoIssueKey(body: string): DemoIssueKey | null {
  const named = new Set([...body.matchAll(/<!-- lob-demo:([a-z0-9-]+) -->/g)].map((match) => match[1]));
  if (named.size !== 1) return null;
  const [key] = named;
  return demoIssueKeys.find((known) => known === key) ?? null;
}

export function demoIssueByCriteria(path: string): DemoIssue {
  const issue = demoIssueKeys.map((key) => demoIssues[key]).find((entry) => entry.criteria === path);
  if (!issue) throw new Error('Unknown demo issue criteria.');
  return issue;
}

// An open issue has no registry entry. Its criteria are the issue title and body,
// and its acceptance test is generated before the fix and frozen by SHA-256.
export const openCriteriaPath = 'github-issue' as const;
export const allCriteriaPaths = [...criteriaPaths, openCriteriaPath] as [DemoIssue['criteria'] | typeof openCriteriaPath, ...(DemoIssue['criteria'] | typeof openCriteriaPath)[]];
export const isOpenCriteria = (path: string) => path === openCriteriaPath;
export const hasDemoMarker = (body: string) => /<!-- lob-demo:[a-z0-9-]+ -->/.test(body);
export function openCriteriaText(input: { number: number; title: string; body: string }) {
  return `# ${input.title}\n\nGitHub issue #${input.number}\n\n${input.body.trim()}\n`;
}
