import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generatedRunnerFile, generatedTestPath, generatedTestPattern, parseGeneratedTest } from './generated-test';

const valid = `import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { runtimeContext, identityLabel } from '../context';

const identity = identityLabel(runtimeContext().target);
const actOptions = { maxSteps: 20, maxModelCalls: 20, timeout: 180_000 };

test('Issue #21 acceptance', async ({ app, agent, device, screen }) => {
  await app.open();
  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await app.screenshot('controller-start');
  try { await expect.soft(device.locator('role=navigation-bar id=Scores')).toBeVisible(); }
  finally { await app.screenshot('scores-title'); }
  await agent.act('Tap the Today control.', actOptions);
  try { await expect.soft(screen.getByText('Back to today', { exact: true })).toBeVisible(); }
  finally { await app.screenshot('today-label'); }
  await expect(screen.getByLabel(identity, { exact: true })).toBeVisible();
  await app.screenshot('controller-end');
});
`;

describe('generated acceptance tests', () => {
  test('paths stay in the hidden folder and map to the runner file', () => {
    assert.equal(generatedTestPath(21), '.agent-tests/issue-21.e2e.ts');
    assert.equal(generatedTestPattern.test(generatedTestPath(21)), true);
    assert.equal(generatedTestPattern.test('src/issue-21.e2e.ts'), false);
    assert.equal(generatedTestPattern.test('.agent-tests/../src/x.e2e.ts'), false);
    assert.equal(generatedRunnerFile(21), 'tests/issue-21.e2e.ts');
  });

  test('a valid test yields its title and the checks between start and end', () => {
    assert.deepEqual(parseGeneratedTest(valid, 21), { file: 'tests/issue-21.e2e.ts', title: 'Issue #21 acceptance', checks: ['scores-title', 'today-label'] });
  });

  for (const [name, source] of [
    ['a wrong title', valid.replace('Issue #21 acceptance', 'Issue #22 acceptance')],
    ['a second test', `${valid}\ntest('Issue #21 acceptance', async () => {});\n`],
    ['an extra import', valid.replace("import { expect } from 'e2e';", "import { expect } from 'e2e';\nimport { readFileSync } from 'node:fs';")],
    ['host access', valid.replace('await app.open();', 'await app.open(); process.exit(0);')],
    ['network access', valid.replace('await app.open();', "await app.open(); await fetch('https://example.com');")],
    ['a model judgment', valid.replace("await agent.act('Tap the Today control.', actOptions);", "await agent.assert('looks right');")],
    ['a skipped test', valid.replace("test('Issue", "test.skip('Issue")],
    ['no start screenshot', valid.replace("app.screenshot('controller-start')", "app.screenshot('opened')")],
    ['no checks', valid.replace("await app.screenshot('scores-title');", '').replace("await app.screenshot('today-label');", '')],
    ['a duplicate check', valid.replace("app.screenshot('today-label')", "app.screenshot('scores-title')")],
    ['a computed screenshot name', valid.replace("app.screenshot('today-label')", 'app.screenshot(`today-${1}`)')],
    ['another app', valid.replace('await app.open();', "await device.openApp('com.apple.Preferences');")],
    ['no identity read', valid.replace('identityLabel(runtimeContext().target)', "'Demo'")],
  ] as const) {
    test(`rejects ${name}`, () => assert.throws(() => parseGeneratedTest(source, 21)));
  }
});
